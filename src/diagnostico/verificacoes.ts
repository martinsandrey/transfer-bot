import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { parseEnv } from "node:util";
import { ErroDeConfiguracao, validarConfig, type AppConfig } from "../config/config.js";
import { criarConstrutor, ErroDeModelo } from "../mensagem/construtor.js";

/**
 * Diagnóstico (`diagnostico.bat`): confere a instalação e a configuração e explica em português o que está errado.
 * Só lê/testa; nunca altera o `.env`, nunca faz login no site e nunca envia mensagem.
 * As partes que dependem do Windows, do navegador ou do Telegram entram por `DepsDiagnostico` (testáveis no Linux).
 */
export type Situacao = "ok" | "aviso" | "erro" | "pulado";

export interface Resultado {
  item: string;
  situacao: Situacao;
  detalhe: string;
}

export interface DepsDiagnostico {
  caminhoEnv: string;
  caminhoExemplo: string;
  /** Variáveis do sistema (têm prioridade sobre o `.env`, como no programa). */
  env: Record<string, string | undefined>;
  versaoNode: string;
  plataforma: NodeJS.Platform;
  agora: () => number;
  /** Fuso do computador (IANA), ex.: "Europe/Lisbon". */
  fusoLocal: string;
  /** `true` se existe um processo vivo com esse PID. */
  processoVivo: (pid: number) => boolean;
  /** Abre o navegador escolhido (sem janela, perfil temporário) e carrega `url`. Devolve o status HTTP (null se não houver). */
  abrirSite: (cfg: AppConfig) => Promise<number | null>;
  /** Conecta com a sessão salva e confere cada destino; devolve um erro já em português por destino, ou null se achou. */
  testarTelegram: (cfg: AppConfig) => Promise<{ destino: string; erro: string | null }[]>;
  /** Windows: `false` se as notificações estão desligadas no sistema; `null` se não deu para saber. */
  notificacoesDoSistemaLigadas: () => Promise<boolean | null>;
}

export const NODE_MINIMO = "22.13.0";
export const FUSO_BRASILIA = "America/Sao_Paulo";

function comparar(a: string, b: string): number {
  const pa = a.replace(/^v/, "").split(".").map(Number);
  const pb = b.replace(/^v/, "").split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

export function verificarNode(versao: string): Resultado {
  return comparar(versao, NODE_MINIMO) >= 0
    ? { item: "Node.js", situacao: "ok", detalhe: `versão ${versao}` }
    : {
        item: "Node.js",
        situacao: "erro",
        detalhe: `versão ${versao} é antiga (mínimo ${NODE_MINIMO}). Instale a LTS atual em https://nodejs.org e rode instalar.bat.`,
      };
}

/** Nomes das variáveis ativas (sem `#`) de um texto no formato `.env`. */
export function nomesDasVariaveis(texto: string): string[] {
  return Object.keys(parseEnv(texto.replace(/^\uFEFF/, "")));
}

/** Variáveis do `.env.example` que não estão no `.env` (o programa usa o valor padrão delas). */
export function variaveisFaltando(textoEnv: string, textoExemplo: string): string[] {
  const temos = new Set(nomesDasVariaveis(textoEnv));
  return nomesDasVariaveis(textoExemplo).filter((n) => !temos.has(n));
}

/** Diferença (minutos) entre o fuso e o UTC no instante `t`. */
export function deslocamentoMin(fuso: string, t: number): number {
  const partes = new Intl.DateTimeFormat("en-US", {
    timeZone: fuso,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(t));
  const v = (tipo: string): number => Number(partes.find((p) => p.type === tipo)?.value);
  const comoUtc = Date.UTC(
    v("year"),
    v("month") - 1,
    v("day"),
    v("hour"),
    v("minute"),
    v("second"),
  );
  return Math.round((comoUtc - Math.floor(t / 1000) * 1000) / 60_000);
}

function horaEm(fuso: string, t: number): string {
  return new Date(t).toLocaleString("pt-BR", { timeZone: fuso, hour12: false });
}

export function verificarRelogio(fusoLocal: string, t: number): Resultado {
  const dif = (deslocamentoMin(fusoLocal, t) - deslocamentoMin(FUSO_BRASILIA, t)) / 60;
  const brasilia = horaEm(FUSO_BRASILIA, t);
  if (dif === 0)
    return {
      item: "Relógio",
      situacao: "ok",
      detalhe: `o computador está no horário de Brasília (${brasilia}).`,
    };
  const sinal = dif > 0 ? "+" : "−";
  return {
    item: "Relógio",
    situacao: "aviso",
    detalhe: `o computador está em outro fuso (${fusoLocal}, ${horaEm(fusoLocal, t)}; ${sinal}${Math.abs(dif)} h em relação a Brasília, onde são ${brasilia}).`,
  };
}

/** Cria e apaga um arquivo de teste na pasta. */
export function verificarPastaGravavel(item: string, pasta: string): Resultado {
  const teste = join(pasta, `.teste-diagnostico-${process.pid}`);
  try {
    mkdirSync(pasta, { recursive: true });
    writeFileSync(teste, "ok");
    unlinkSync(teste);
    return { item, situacao: "ok", detalhe: pasta };
  } catch (e) {
    return {
      item,
      situacao: "erro",
      detalhe: `não consegui gravar em "${pasta}" (${(e as NodeJS.ErrnoException).code ?? "erro"}). Confira se a pasta existe, se não está só leitura e se o antivírus não bloqueia.`,
    };
  }
}

/** PID guardado em `bot.lock`, se a outra cópia ainda estiver aberta. */
export function botAberto(pastaDados: string, vivo: (pid: number) => boolean): number | null {
  try {
    const pid = Number(readFileSync(join(pastaDados, "bot.lock"), "utf8").trim());
    return Number.isInteger(pid) && pid > 0 && pid !== process.pid && vivo(pid) ? pid : null;
  } catch {
    return null;
  }
}

const NOMES_DE_EVENTO: Record<string, string> = {
  menu_nao_abriu: "menu não abriu",
  sessao_expirada: "sessão do site expirou",
  leitura_falhou: "falha ao ler a tabela",
  leitura_invalida: "tabela ilegível",
  consulta_falhou: "consulta ao cliente falhou",
  envio_falhou: "envio falhou",
  login_auto_falhou: "login automático não entrou",
  login_auto_erro: "erro no login automático",
  janela_sem_monitoramento: "intervalo sem monitorar",
  unhandled_rejection: "erro interno",
};

/** Resumo do log mais recente: quantas vezes o programa foi aberto e os avisos/erros mais frequentes (só códigos, sem dados). */
export function resumirLog(pastaLogs: string): Resultado {
  const item = "Log mais recente";
  let arquivos: string[];
  try {
    arquivos = readdirSync(pastaLogs)
      .filter((f) => /^transfer-bot-\d{4}-\d{2}-\d{2}\.log$/.test(f))
      .sort();
  } catch {
    arquivos = [];
  }
  const ultimo = arquivos.at(-1);
  if (!ultimo)
    return { item, situacao: "pulado", detalhe: "nenhum log ainda (o bot não foi iniciado)." };
  let inicios = 0;
  let avisos = 0;
  let erros = 0;
  const contagem = new Map<string, number>();
  for (const linha of readFileSync(join(pastaLogs, ultimo), "utf8").split("\n")) {
    let r: { level?: number; evento?: string };
    try {
      r = JSON.parse(linha) as { level?: number; evento?: string };
    } catch {
      continue;
    }
    if (r.evento === "programa_iniciado") inicios++;
    if ((r.level ?? 0) < 40) continue;
    if (r.level === 40) avisos++;
    else erros++;
    const ev = r.evento ?? "outro";
    contagem.set(ev, (contagem.get(ev) ?? 0) + 1);
  }
  const top = [...contagem]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([ev, n]) => `${NOMES_DE_EVENTO[ev] ?? ev} ×${n}`)
    .join(", ");
  const partes = [
    ultimo,
    ...(inicios > 0 ? [`programa aberto ${inicios}×`] : []),
    `${avisos} aviso(s), ${erros} erro(s)${top ? `: ${top}` : ""}`,
  ];
  return {
    item,
    situacao: erros > 0 || inicios > 3 ? "aviso" : "ok",
    detalhe:
      partes.join(" · ") +
      (inicios > 3 ? ". Muitos reinícios no dia: cada reinício apaga a memória do bot." : ""),
  };
}

/** Roda todas as verificações, na ordem em que fazem sentido (sem `.env` válido, as que dependem dele são puladas). */
export async function executarDiagnostico(d: DepsDiagnostico): Promise<Resultado[]> {
  const r: Resultado[] = [verificarNode(d.versaoNode)];
  const pular = (item: string, motivo: string): void => {
    r.push({ item, situacao: "pulado", detalhe: motivo });
  };
  r.push(verificarRelogio(d.fusoLocal, d.agora()));

  if (!existsSync(d.caminhoEnv)) {
    r.push({
      item: "Arquivo .env",
      situacao: "erro",
      detalhe:
        "não existe. Abra configurar.bat (ele cria o .env a partir do .env.example) e preencha SITE_URL.",
    });
    return r;
  }
  const textoEnv = readFileSync(d.caminhoEnv, "utf8");
  let cfg: AppConfig;
  try {
    cfg = validarConfig({ ...parseEnv(textoEnv.replace(/^\uFEFF/, "")), ...d.env });
    r.push({
      item: "Configuração (.env)",
      situacao: "ok",
      detalhe: "todos os valores são válidos.",
    });
  } catch (e) {
    if (!(e instanceof ErroDeConfiguracao)) throw e;
    r.push({
      item: "Configuração (.env)",
      situacao: "erro",
      detalhe: `corrija no configurar.bat:\n - ${e.problemas.join("\n - ")}`,
    });
    return r;
  }
  if (existsSync(d.caminhoExemplo)) {
    const faltam = variaveisFaltando(textoEnv, readFileSync(d.caminhoExemplo, "utf8"));
    r.push(
      faltam.length
        ? {
            item: "Variáveis novas",
            situacao: "aviso",
            detalhe: `não estão no seu .env (o programa usa o valor padrão; veja a explicação de cada uma no .env.example): ${faltam.join(", ")}.`,
          }
        : {
            item: "Variáveis novas",
            situacao: "ok",
            detalhe: "o .env tem todas as do .env.example.",
          },
    );
  }

  try {
    criarConstrutor(readFileSync(cfg.arquivoMensagem, "utf8"));
    r.push({ item: "Modelo da mensagem", situacao: "ok", detalhe: cfg.arquivoMensagem });
  } catch (e) {
    r.push({
      item: "Modelo da mensagem",
      situacao: "erro",
      detalhe:
        e instanceof ErroDeModelo
          ? e.message
          : `não consegui ler "${cfg.arquivoMensagem}". Confira ARQUIVO_MENSAGEM.`,
    });
  }

  r.push({
    item: "Modo",
    situacao: "ok",
    detalhe:
      cfg.modo === "live"
        ? "ENVIO REAL (a senha de liberação é pedida ao iniciar)."
        : "observação: nada é enviado (para enviar, SEND_MODE=live).",
  });
  r.push({
    item: "Login no site",
    situacao: "ok",
    detalhe: cfg.site.loginAutomatico
      ? "automático: depois que você clica na verificação, usuário e senha são preenchidos uma vez."
      : "manual (LOGIN_AUTOMATICO=false).",
  });

  r.push(verificarPastaGravavel("Pasta de dados", cfg.pastas.dados));
  if (cfg.pastaRegistros) r.push(verificarPastaGravavel("Pasta de registros", cfg.pastaRegistros));
  else pular("Pasta de registros", "REGISTRAR_MENSAGENS=false (o relatório fica sem dados novos).");

  const pid = botAberto(cfg.pastas.dados, d.processoVivo);
  r.push(
    pid
      ? {
          item: "Bot aberto agora",
          situacao: "aviso",
          detalhe: `sim (processo ${pid}). O teste do Telegram foi pulado para não disputar a sessão com ele.`,
        }
      : { item: "Bot aberto agora", situacao: "ok", detalhe: "não." },
  );

  try {
    const status = await d.abrirSite(cfg);
    r.push({
      item: "Navegador e site",
      situacao: status !== null && status >= 400 ? "aviso" : "ok",
      detalhe: `${cfg.navegador === "msedge" ? "Edge" : "Chromium"} abriu e o site respondeu${status !== null ? ` (HTTP ${status})` : ""}.`,
    });
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    const semNavegador = /executable|channel|não encontrad|not found|install/i.test(m);
    r.push({
      item: "Navegador e site",
      situacao: "erro",
      detalhe: semNavegador
        ? cfg.navegador === "msedge"
          ? "o Microsoft Edge não foi encontrado. Instale/atualize o Edge ou use NAVEGADOR=chromium (e rode: npx playwright install chromium)."
          : "o Chromium do Playwright não está instalado. Rode: npx playwright install chromium (ou use NAVEGADOR=msedge)."
        : `o site não abriu (${m.split("\n")[0]}). Confira SITE_URL, a internet e a VPN.`,
    });
  }

  const t = cfg.telegram;
  if (t.apiId === undefined || !t.apiHash) {
    pular(
      "Telegram",
      "TELEGRAM_API_ID/TELEGRAM_API_HASH vazios (só são necessários para SEND_MODE=live).",
    );
  } else if (pid) {
    pular("Telegram", "o bot está aberto e já usa a sessão.");
  } else {
    try {
      const destinos = await d.testarTelegram(cfg);
      const ruins = destinos.filter((x) => x.erro);
      r.push(
        ruins.length
          ? {
              item: "Telegram",
              situacao: "erro",
              detalhe: ruins.map((x) => `"${x.destino}": ${x.erro}`).join("\n   "),
            }
          : {
              item: "Telegram",
              situacao: "ok",
              detalhe: `sessão ativa; encontrei ${destinos.map((x) => `"${x.destino}"`).join(" e ")}.`,
            },
      );
    } catch (e) {
      r.push({
        item: "Telegram",
        situacao: "erro",
        detalhe: e instanceof Error ? e.message : String(e),
      });
    }
  }

  if (!cfg.notificacoes.windows) pular("Notificações do Windows", "NOTIFICAR_WINDOWS=false.");
  else if (d.plataforma !== "win32") pular("Notificações do Windows", "só no Windows.");
  else {
    const ligadas = await d.notificacoesDoSistemaLigadas().catch(() => null);
    r.push(
      ligadas === false
        ? {
            item: "Notificações do Windows",
            situacao: "aviso",
            detalhe:
              'desligadas no Windows: Configurações > Sistema > Notificações, ligue "Notificações".',
          }
        : {
            item: "Notificações do Windows",
            situacao: "ok",
            detalhe: "ligadas. Para ver uma de exemplo, abra testar-notificacao.bat.",
          },
    );
  }

  r.push(resumirLog(cfg.pastas.logs));
  return r;
}

const ROTULO: Record<Situacao, string> = {
  ok: "[OK]   ",
  aviso: "[AVISO]",
  erro: "[ERRO] ",
  pulado: "[--]   ",
};

export function formatar(resultados: readonly Resultado[]): string {
  const linhas = resultados.map((x) => `${ROTULO[x.situacao]} ${x.item}: ${x.detalhe}`);
  const erros = resultados.filter((x) => x.situacao === "erro").length;
  const avisos = resultados.filter((x) => x.situacao === "aviso").length;
  linhas.push(
    "",
    erros
      ? `Resultado: ${erros} problema(s) para corrigir${avisos ? ` e ${avisos} aviso(s)` : ""}. Corrija os itens [ERRO] e rode o diagnóstico de novo.`
      : avisos
        ? `Resultado: pronto para usar, com ${avisos} aviso(s) para conferir.`
        : "Resultado: tudo certo.",
  );
  return linhas.join("\n");
}
