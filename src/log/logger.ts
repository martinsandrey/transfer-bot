import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { pino, type Logger as Pino } from "pino";
import { mascararTelefone, mascararTexto } from "../util/mascara.js";

/**
 * Campos que podem aparecer nos logs. Qualquer outra chave é descartada (e contada em `camposDescartados`)
 * para impedir que linhas da tabela ou dados de clientes cheguem ao arquivo por acidente.
 */
const CAMPOS_PERMITIDOS = new Set([
  "evento",
  "codigo",
  "motivo",
  "estadoTarefa",
  "estadoSessao",
  "idCurto",
  "de",
  "para",
  "callbackMascarado",
  "contagem",
  "grupo",
  "linhas",
  "duracaoMs",
  "tentativa",
  "modo",
  "memoriaMb",
  "inicio",
  "fim",
]);

export type CamposLog = Record<string, string | number | boolean | undefined>;
export type NivelLog = "debug" | "info" | "warn" | "error";

export interface Logger {
  debug(msg: string, campos?: CamposLog): void;
  info(msg: string, campos?: CamposLog): void;
  warn(msg: string, campos?: CamposLog): void;
  error(msg: string, campos?: CamposLog): void;
}

/** Aplica a allow-list e o mascaramento. Exportado para teste. */
export function sanearCampos(campos: CamposLog | undefined): {
  campos: CamposLog;
  descartados: number;
} {
  const saida: CamposLog = {};
  let descartados = 0;
  for (const [chave, valor] of Object.entries(campos ?? {})) {
    if (!CAMPOS_PERMITIDOS.has(chave) || valor === undefined) {
      if (!CAMPOS_PERMITIDOS.has(chave)) descartados++;
      continue;
    }
    saida[chave] = typeof valor === "string" ? mascararTexto(valor) : valor;
  }
  return { campos: saida, descartados };
}

export interface OpcoesLogger {
  pastaLogs: string;
  nivel: NivelLog;
  /** Nível mínimo mostrado no console (o arquivo usa `nivel`). Padrão: o mesmo de `nivel`. */
  nivelConsole?: NivelLog;
  /** Escrita no console; por padrão `console.log`. Injetável em testes. */
  console?: (linha: string) => void;
  /** Destino do pino (stream). Por padrão, arquivo diário na `pastaLogs`. */
  destino?: pino.DestinationStream;
}

const ORDEM: Record<NivelLog, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export function criarLogger(op: OpcoesLogger): Logger {
  let destino: pino.DestinationStream | undefined = op.destino;
  if (!destino) {
    mkdirSync(op.pastaLogs, { recursive: true });
    const dia = new Date().toISOString().slice(0, 10);
    destino = pino.destination({ dest: join(op.pastaLogs, `transfer-bot-${dia}.log`), sync: true });
  }
  const base: Pino = pino({ level: op.nivel, base: null }, destino);
  const escreverConsole = op.console ?? ((l: string) => console.log(l));

  const emitir = (nivel: NivelLog, msg: string, campos?: CamposLog): void => {
    const { campos: ok, descartados } = sanearCampos(campos);
    const extra = descartados > 0 ? { camposDescartados: descartados } : {};
    const texto = mascararTexto(msg);
    base[nivel]({ ...ok, ...extra }, texto);
    if (ORDEM[nivel] < ORDEM[op.nivelConsole ?? op.nivel]) return; // o console respeita o mesmo nível do arquivo
    const hora = new Date().toLocaleTimeString("pt-BR", { hour12: false });
    const detalhes = Object.entries(ok)
      .map(([k, v]) => `${k}=${String(v)}`)
      .join(" ");
    escreverConsole(
      `${hora} ${nivel.toUpperCase().padEnd(5)} ${texto}${detalhes ? ` (${detalhes})` : ""}`,
    );
  };

  return {
    debug: (m, c) => emitir("debug", m, c),
    info: (m, c) => emitir("info", m, c),
    warn: (m, c) => emitir("warn", m, c),
    error: (m, c) => emitir("error", m, c),
  };
}

export { mascararTelefone };
