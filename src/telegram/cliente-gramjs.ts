import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { createInterface } from "node:readline";
import { Api, TelegramClient } from "telegram";
import { FloodWaitError } from "telegram/errors/index.js";
import { StringSession } from "telegram/sessions/index.js";
import {
  FalhaTelegram,
  FloodWaitTelegram,
  destinoEhTitulo,
  escolherPorTitulo,
  normalizarTitulo,
  type ClienteTelegram,
  type Dialogo,
  type MensagemRecente,
} from "./cliente.js";

export interface CredenciaisTelegram {
  apiId: number;
  apiHash: string;
  /** Arquivo da sessão (dá acesso TOTAL à conta: fica fora do repositório, na pasta de dados do usuário). */
  arquivoSessao: string;
}

/** Pergunta no console. Com `oculto`, não ecoa o que é digitado (senha 2FA). Nada digitado aqui é gravado. */
function perguntar(texto: string, oculto = false): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (oculto) {
      const saida = rl as unknown as { _writeToOutput: (s: string) => void };
      saida._writeToOutput = (s: string): void => {
        if (s.includes(texto)) process.stdout.write(s);
      };
    }
    rl.question(texto, (r) => {
      rl.close();
      if (oculto) process.stdout.write("\n");
      resolve(r.trim());
    });
  });
}

export function sessaoExiste(arquivo: string): boolean {
  return existsSync(arquivo) && readFileSync(arquivo, "utf8").trim() !== "";
}

function traduzir(e: unknown): Error {
  if (e instanceof FloodWaitError) return new FloodWaitTelegram(e.seconds);
  const msg = e instanceof Error ? e.message : String(e);
  if (
    /CHAT_WRITE_FORBIDDEN|USER_BANNED|PEER_ID_INVALID|USERNAME_NOT_OCCUPIED|CHANNEL_PRIVATE|Cannot find any entity/i.test(
      msg,
    )
  ) {
    return new FalhaTelegram(`destino_invalido_ou_sem_permissao`);
  }
  if (/AUTH_KEY|SESSION_REVOKED|USER_DEACTIVATED/i.test(msg)) {
    return new FalhaTelegram("sessao_invalida_refaca_o_login");
  }
  return e instanceof Error ? e : new Error(msg);
}

type Dlg = Awaited<ReturnType<TelegramClient["getDialogs"]>>[number];

/** Grupo comum antigo que foi convertido em supergrupo: continua aparecendo na lista, mas não recebe mais mensagens. */
export function ehGrupoAntigo(d: Pick<Dlg, "entity">): boolean {
  const e = d.entity;
  // `migratedTo` pode vir `null`/`undefined` quando não houve migração: só conta se realmente existir.
  return e instanceof Api.Chat && (e.deactivated === true || (e.migratedTo ?? null) !== null);
}

/** Supergrupo é "channel" no Telegram, mas para a pessoa é um grupo; canal de verdade é só o de transmissão. */
function tipoDe(d: Dlg): "privado" | "grupo" | "canal" {
  if (d.isChannel && !d.isGroup) return "canal";
  return d.isGroup || d.isChannel ? "grupo" : "privado";
}

export class ClienteGramJS implements ClienteTelegram {
  private constructor(
    private readonly c: TelegramClient,
    private readonly cred: CredenciaisTelegram,
  ) {}

  /**
   * Conecta com a sessão salva. Se não houver (ou `forcarLogin`), faz o login guiado: telefone, código e senha 2FA digitados
   * no console (nunca gravados); só o texto da sessão é salvo em `arquivoSessao`.
   */
  static async conectar(
    cred: CredenciaisTelegram,
    opcoes: { loginInterativo: boolean },
  ): Promise<ClienteGramJS> {
    const existente = sessaoExiste(cred.arquivoSessao)
      ? readFileSync(cred.arquivoSessao, "utf8").trim()
      : "";
    if (existente === "" && !opcoes.loginInterativo) {
      throw new FalhaTelegram(
        "Telegram sem login. Rode o comando de login do Telegram (telegram.bat login).",
      );
    }
    const c = new TelegramClient(new StringSession(existente), cred.apiId, cred.apiHash, {
      connectionRetries: 5,
      useWSS: false,
    });
    await c.start({
      phoneNumber: () => perguntar("Telefone da conta do Telegram (com +55...): "),
      phoneCode: () => perguntar("Código recebido no Telegram: "),
      password: () => perguntar("Senha de verificação em duas etapas (2FA): ", true),
      onError: (e) => {
        console.error("Erro no login do Telegram:", e.message);
        return Promise.resolve(true); // para o login: sem tentativas em loop
      },
    });
    const cliente = new ClienteGramJS(c, cred);
    cliente.salvarSessao();
    // Carrega as conversas para o destino numérico (ID de grupo/contato) poder ser resolvido.
    await c.getDialogs({ limit: 200 }).catch(() => undefined);
    return cliente;
  }

  private salvarSessao(): void {
    mkdirSync(dirname(this.cred.arquivoSessao), { recursive: true });
    writeFileSync(this.cred.arquivoSessao, String(this.c.session.save()), {
      encoding: "utf8",
      mode: 0o600,
    });
    try {
      chmodSync(this.cred.arquivoSessao, 0o600);
    } catch {
      /* Windows: permissões vêm da pasta do usuário */
    }
  }

  async enviar(destino: string, texto: string): Promise<{ id: number; data: number }> {
    try {
      const m = await this.c.sendMessage(await this.entidade(destino), {
        message: texto,
        parseMode: undefined,
      });
      return { id: m.id, data: m.date };
    } catch (e) {
      throw traduzir(e);
    }
  }

  async mensagensRecentes(destino: string, limite: number): Promise<MensagemRecente[]> {
    const ms = await this.c.getMessages(await this.entidade(destino), { limit: limite });
    return ms.map((m) => ({ id: m.id, texto: m.message, data: m.date }));
  }

  async dialogos(limite: number): Promise<Dialogo[]> {
    const ds = (await this.c.getDialogs({ limit: limite })).filter((x) => !ehGrupoAntigo(x));
    return ds.map((d) => ({
      id: String(d.id),
      titulo: d.title ?? "(sem título)",
      tipo: tipoDe(d),
    }));
  }

  async encerrar(): Promise<void> {
    await this.c.disconnect().catch(() => undefined);
    await this.c.destroy().catch(() => undefined);
  }

  /** "me" = Mensagens Salvas; número = ID; @usuario/telefone/link; senão, o TÍTULO de uma das suas conversas (qualquer idioma). */
  private readonly resolvidos = new Map<string, string | number | Api.TypeEntityLike>();

  /** Resolve o destino já na inicialização (falha cedo e com motivo claro, em vez de só na primeira transferência). */
  async validarDestino(destino: string): Promise<void> {
    await this.entidade(destino);
  }

  private async entidade(destino: string): Promise<string | number | Api.TypeEntityLike> {
    const d = destino.trim();
    const guardado = this.resolvidos.get(d);
    if (guardado !== undefined) return guardado;
    const r = await this.resolver(d);
    this.resolvidos.set(d, r);
    return r;
  }

  private async resolver(d: string): Promise<string | number | Api.TypeEntityLike> {
    if (!destinoEhTitulo(d)) return /^-?\d+$/.test(d) ? Number(d) : d;
    const todos = await this.c.getDialogs({ limit: 500 });
    // O Telegram pode devolver a mesma conversa mais de uma vez (ex.: arquivadas): conta uma só por ID.
    const vistos = new Set<string>();
    const ds = todos.filter((x) => {
      if (ehGrupoAntigo(x)) return false;
      const id = String(x.id);
      if (vistos.has(id)) return false;
      vistos.add(id);
      return true;
    });
    try {
      const i = escolherPorTitulo(
        ds.map((x) => x.title ?? ""),
        d,
      );
      return (ds[i] as (typeof ds)[number]).inputEntity;
    } catch (e) {
      if (e instanceof FalhaTelegram && e.message.includes("ambiguo")) {
        const alvo = normalizarTitulo(d);
        const cand = ds
          .filter((x) => normalizarTitulo(x.title ?? "").includes(alvo))
          .map((x) => `${String(x.id)} (${tipoDe(x)})`);
        throw new FalhaTelegram(`${e.message} [ids: ${cand.join(", ")}]`);
      }
      throw e;
    }
  }
}
