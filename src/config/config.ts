import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { parseEnv } from "node:util";
import { z } from "zod";
import { interpretarDigitos, type FiltroFuncionarios } from "../monitor/filtro-funcionario.js";

export type ModoEnvio = "observacao" | "live";
export type NavegadorEscolhido = "chromium" | "msedge";

export interface AppConfig {
  site: {
    url: string;
    usuario: string | undefined;
    senha: string | undefined;
    loginAutomatico: boolean;
  };
  modo: ModoEnvio;
  monitor: {
    intervaloMs: number;
    leiturasConfirmacao: number;
    ausenciaMaxLeituras: number;
    ttlOcorrenciasMin: number;
    janelaTransferenciaMs: number;
    /** Segundos sem nenhuma linha de Stage 3 (depois de tocar sem atender) antes do CALLBACK. */
    callbackEsperaMs: number;
    /** Ligação atendida no Stage 3 com menos que isto (segundos) também conta como CALLBACK. 0 = desligado. */
    callbackDuracaoSeg: number;
  };
  timeouts: { navegacaoMs: number; consultaMs: number };
  recargaOciosaMin: number;
  navegador: NavegadorEscolhido;
  pastas: { dados: string; perfilNavegador: string; logs: string };
  arquivoMensagem: string;
  /** Notificações do Windows (toast) para erros e avisos relevantes. */
  notificacoes: {
    windows: boolean;
    informativas: boolean;
    longas: boolean;
  };
  /** Pasta dos .txt com as mensagens (transferências concluídas e ligações de 5 min). `undefined` = não registrar. */
  pastaRegistros: string | undefined;
  telegram: {
    apiId: number | undefined;
    apiHash: string | undefined;
    /** "me" (Mensagens Salvas, padrão seguro), @usuario ou ID numérico do chat. */
    destino: string;
    /** Segundo grupo (ligações que atingem `duracaoLongaMin` ainda em Stage 1). Vazio = função desligada. */
    destinoLonga: string | undefined;
    timeoutEnvioMs: number;
    arquivoSessao: string;
  };
  /** Quais funcionários (pelo penúltimo dígito do Callback Number do Stage 1) vão para cada grupo. */
  filtroFuncionarios: FiltroFuncionarios;
  /** Minutos de duração (em Stage 1) que disparam a mensagem do segundo grupo. */
  duracaoLongaMin: number;
  /** Minutos; 0 = a mensagem nunca expira. */
  validadeMensagemMin: number;
  nivelLog: "debug" | "info" | "warn" | "error";
}

export class ErroDeConfiguracao extends Error {
  constructor(public readonly problemas: string[]) {
    super(`Configuração inválida:\n - ${problemas.join("\n - ")}`);
    this.name = "ErroDeConfiguracao";
  }
}

/** Texto vazio (ou só espaços) conta como "não informado". */
const vazioParaUndefined = (v: unknown): unknown =>
  typeof v === "string" && v.trim() === "" ? undefined : typeof v === "string" ? v.trim() : v;

function booleano(nome: string, padrao: boolean) {
  return z.preprocess(
    (v) => {
      const t = vazioParaUndefined(v);
      if (t === undefined) return padrao;
      const s = String(t).toLowerCase();
      if (["true", "1", "sim", "s", "yes"].includes(s)) return true;
      if (["false", "0", "nao", "não", "n", "no"].includes(s)) return false;
      return t;
    },
    z.boolean({ error: `${nome}: use "true" ou "false".` }),
  );
}

function inteiro(nome: string, padrao: number, min: number, max: number) {
  return z.preprocess(
    (v) => {
      const t = vazioParaUndefined(v);
      if (t === undefined) return padrao;
      return /^-?\d+$/.test(String(t)) ? Number(t) : t;
    },
    z
      .number({ error: `${nome}: informe um número inteiro.` })
      .int({ error: `${nome}: informe um número inteiro.` })
      .min(min, { error: `${nome}: o mínimo é ${min}.` })
      .max(max, { error: `${nome}: o máximo é ${max}.` }),
  );
}

const textoOpcional = z.preprocess(vazioParaUndefined, z.string().optional());

const esquema = z.object({
  SITE_URL: z.preprocess(
    vazioParaUndefined,
    z.string({ error: "SITE_URL: informe o endereço do sistema (ex.: https://...)." }).refine(
      (v) => {
        try {
          const u = new URL(v);
          return u.protocol === "http:" || u.protocol === "https:";
        } catch {
          return false;
        }
      },
      { error: "SITE_URL: endereço inválido; use algo como https://endereco-do-sistema/" },
    ),
  ),
  SITE_USUARIO: textoOpcional,
  SITE_SENHA: textoOpcional,
  LOGIN_AUTOMATICO: booleano("LOGIN_AUTOMATICO", false),
  SEND_MODE: z.preprocess(
    (v) => vazioParaUndefined(v) ?? "observacao",
    z.enum(["observacao", "live"], { error: 'SEND_MODE: use "observacao" ou "live".' }),
  ),
  INTERVALO_LEITURA_MS: inteiro("INTERVALO_LEITURA_MS", 1000, 200, 60000),
  LEITURAS_CONFIRMACAO: inteiro("LEITURAS_CONFIRMACAO", 2, 1, 20),
  AUSENCIA_MAX_LEITURAS: inteiro("AUSENCIA_MAX_LEITURAS", 3, 1, 100),
  TTL_OCORRENCIAS_MIN: inteiro("TTL_OCORRENCIAS_MIN", 720, 1, 100000),
  CALLBACK_ESPERA_SEG: inteiro("CALLBACK_ESPERA_SEG", 3, 1, 120),
  CALLBACK_DURACAO_SEG: inteiro("CALLBACK_DURACAO_SEG", 20, 0, 3600),
  JANELA_TRANSFERENCIA_SEG: inteiro("JANELA_TRANSFERENCIA_SEG", 60, 5, 600),
  TIMEOUT_NAVEGACAO_MS: inteiro("TIMEOUT_NAVEGACAO_MS", 30000, 1000, 600000),
  TIMEOUT_CONSULTA_MS: inteiro("TIMEOUT_CONSULTA_MS", 60000, 1000, 600000),
  RECARGA_OCIOSA_MINUTOS: inteiro("RECARGA_OCIOSA_MINUTOS", 0, 0, 100000),
  NAVEGADOR: z.preprocess(
    (v) => vazioParaUndefined(v) ?? "msedge",
    z.enum(["chromium", "msedge"], { error: 'NAVEGADOR: use "msedge" ou "chromium".' }),
  ),
  PASTA_DADOS: textoOpcional,
  ARQUIVO_MENSAGEM: z.preprocess(vazioParaUndefined, z.string().default("config/mensagem.txt")),
  NOTIFICAR_WINDOWS: booleano("NOTIFICAR_WINDOWS", true),
  NOTIFICAR_TRANSFERENCIAS: booleano("NOTIFICAR_TRANSFERENCIAS", false),
  NOTIFICAR_5MIN: booleano("NOTIFICAR_5MIN", false),
  REGISTRAR_MENSAGENS: booleano("REGISTRAR_MENSAGENS", true),
  PASTA_REGISTROS: z.preprocess(vazioParaUndefined, z.string().default("registros")),
  TELEGRAM_API_ID: z.preprocess(
    (v) => {
      const t = vazioParaUndefined(v);
      return t !== undefined && /^\d+$/.test(String(t)) ? Number(t) : t;
    },
    z
      .number({ error: "TELEGRAM_API_ID: informe só números (vem de my.telegram.org)." })
      .int()
      .positive()
      .optional(),
  ),
  TELEGRAM_API_HASH: textoOpcional,
  TELEGRAM_DESTINO: z.preprocess(vazioParaUndefined, z.string().default("me")),
  TELEGRAM_DESTINO_5MIN: textoOpcional,
  DURACAO_LONGA_MIN: inteiro("DURACAO_LONGA_MIN", 5, 1, 600),
  PENULTIMO_DIGITO_TRANSFERENCIA: textoOpcional,
  PENULTIMO_DIGITO_5MIN: textoOpcional,
  TIMEOUT_ENVIO_TELEGRAM_MS: inteiro("TIMEOUT_ENVIO_TELEGRAM_MS", 30000, 1000, 600000),
  VALIDADE_MENSAGEM_MIN: inteiro("VALIDADE_MENSAGEM_MIN", 15, 0, 100000),
  NIVEL_LOG: z.preprocess(
    (v) => vazioParaUndefined(v) ?? "info",
    z.enum(["debug", "info", "warn", "error"], {
      error: "NIVEL_LOG: use debug, info, warn ou error.",
    }),
  ),
});

/** Expande `%VAR%` (estilo Windows) e `~` no início. */
export function expandirCaminho(caminho: string, env: Record<string, string | undefined>): string {
  const semPercent = caminho.replace(/%([^%]+)%/g, (_m, nome: string) => env[nome] ?? `%${nome}%`);
  return semPercent.startsWith("~") ? join(homedir(), semPercent.slice(1)) : semPercent;
}

function pastaDadosPadrao(env: Record<string, string | undefined>): string {
  if (process.platform === "win32") {
    return join(env["LOCALAPPDATA"] ?? join(homedir(), "AppData", "Local"), "TransferBot");
  }
  return join(env["XDG_DATA_HOME"] ?? join(homedir(), ".local", "share"), "transfer-bot");
}

/**
 * Valida variáveis (já mescladas) e devolve a configuração tipada.
 * As mensagens de erro nunca incluem o valor de SITE_SENHA.
 */
export function validarConfig(bruto: Record<string, string | undefined>): AppConfig {
  const r = esquema.safeParse(bruto);
  if (!r.success) {
    const problemas = r.error.issues.map((i) => i.message);
    throw new ErroDeConfiguracao(problemas);
  }
  const c = r.data;
  const problemas: string[] = [];
  if (c.LOGIN_AUTOMATICO && (!c.SITE_USUARIO || !c.SITE_SENHA)) {
    problemas.push(
      "LOGIN_AUTOMATICO=true exige SITE_USUARIO e SITE_SENHA preenchidos (ou use LOGIN_AUTOMATICO=false para entrar manualmente).",
    );
  }
  if (c.SEND_MODE === "live" && (c.TELEGRAM_API_ID === undefined || !c.TELEGRAM_API_HASH)) {
    problemas.push(
      'SEND_MODE=live exige TELEGRAM_API_ID e TELEGRAM_API_HASH (crie em https://my.telegram.org, "API development tools").',
    );
  }
  // Transferências: por padrão só os funcionários com penúltimo dígito 1 (equipe do usuário). 5 min: todos. "*" = todos.
  const digitosTransferencia = interpretarDigitos(c.PENULTIMO_DIGITO_TRANSFERENCIA ?? "1");
  const digitos5min = interpretarDigitos(c.PENULTIMO_DIGITO_5MIN ?? "*");
  if (digitosTransferencia === undefined)
    problemas.push(
      'PENULTIMO_DIGITO_TRANSFERENCIA: use dígitos de 0 a 9 separados por vírgula (ex.: "1" ou "0,1") ou "*" para todos.',
    );
  if (digitos5min === undefined)
    problemas.push(
      'PENULTIMO_DIGITO_5MIN: use dígitos de 0 a 9 separados por vírgula (ex.: "1" ou "0,1") ou "*" para todos.',
    );
  if (problemas.length) throw new ErroDeConfiguracao(problemas);

  const dados = resolve(expandirCaminho(c.PASTA_DADOS ?? pastaDadosPadrao(bruto), bruto));
  return {
    site: {
      url: c.SITE_URL,
      usuario: c.SITE_USUARIO,
      senha: c.SITE_SENHA,
      loginAutomatico: c.LOGIN_AUTOMATICO,
    },
    modo: c.SEND_MODE,
    monitor: {
      intervaloMs: c.INTERVALO_LEITURA_MS,
      leiturasConfirmacao: c.LEITURAS_CONFIRMACAO,
      ausenciaMaxLeituras: c.AUSENCIA_MAX_LEITURAS,
      ttlOcorrenciasMin: c.TTL_OCORRENCIAS_MIN,
      janelaTransferenciaMs: c.JANELA_TRANSFERENCIA_SEG * 1000,
      callbackEsperaMs: c.CALLBACK_ESPERA_SEG * 1000,
      callbackDuracaoSeg: c.CALLBACK_DURACAO_SEG,
    },
    timeouts: { navegacaoMs: c.TIMEOUT_NAVEGACAO_MS, consultaMs: c.TIMEOUT_CONSULTA_MS },
    recargaOciosaMin: c.RECARGA_OCIOSA_MINUTOS,
    navegador: c.NAVEGADOR,
    pastas: { dados, perfilNavegador: join(dados, "perfil-navegador"), logs: join(dados, "logs") },
    arquivoMensagem: c.ARQUIVO_MENSAGEM,
    notificacoes: {
      windows: c.NOTIFICAR_WINDOWS,
      informativas: c.NOTIFICAR_TRANSFERENCIAS,
      longas: c.NOTIFICAR_5MIN,
    },
    pastaRegistros: c.REGISTRAR_MENSAGENS
      ? resolve(expandirCaminho(c.PASTA_REGISTROS, bruto))
      : undefined,
    telegram: {
      apiId: c.TELEGRAM_API_ID,
      apiHash: c.TELEGRAM_API_HASH,
      destino: c.TELEGRAM_DESTINO,
      destinoLonga: c.TELEGRAM_DESTINO_5MIN,
      timeoutEnvioMs: c.TIMEOUT_ENVIO_TELEGRAM_MS,
      arquivoSessao: join(dados, "telegram", "sessao.txt"),
    },
    filtroFuncionarios: {
      transferencia: digitosTransferencia ?? null,
      longa: digitos5min ?? null,
    },
    duracaoLongaMin: c.DURACAO_LONGA_MIN,
    validadeMensagemMin: c.VALIDADE_MENSAGEM_MIN,
    nivelLog: c.NIVEL_LOG,
  };
}

/** Lê o `.env` (se existir) e mescla com `process.env` (variáveis do sistema têm prioridade). */
export function carregarConfig(
  caminhoEnv = ".env",
  env: Record<string, string | undefined> = process.env,
): AppConfig {
  if (!existsSync(caminhoEnv)) {
    throw new ErroDeConfiguracao([
      `Arquivo "${caminhoEnv}" não encontrado. Copie ".env.example" para ".env" e preencha SITE_URL.`,
    ]);
  }
  const doArquivo = parseEnv(readFileSync(caminhoEnv, "utf8").replace(/^\uFEFF/, ""));
  return validarConfig({ ...doArquivo, ...env });
}
