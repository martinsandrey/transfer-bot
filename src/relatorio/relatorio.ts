import { NOME_ARQUIVO } from "../registro/registro-arquivo.js";

/**
 * Relatório por funcionário, calculado a partir dos .txt de registro (nenhum histórico estruturado é criado).
 * Uma mensagem de transferência é enviada assim que o Stage 3 toca; o CALLBACK é o aviso de que ninguém atendeu. Portanto:
 *  - "com callback" = todas as transferências (mensagens de transferência);
 *  - "callbacks" = quantas delas ninguém atendeu;
 *  - "sem callback" = com callback − callbacks (as atendidas).
 */

export type TipoEntrada = "transferencia" | "callback" | "longa";

export interface Entrada {
  tipo: TipoEntrada;
  quando: Date;
  enviada: boolean;
  funcionario: string;
}

export const SEM_FUNCIONARIO = "(não identificado)";

const CABECALHO = /^===== (\d{4})-(\d\d)-(\d\d) (\d\d):(\d\d):(\d\d) \| ([^\n]*?) =====$/;
const LINHA_FUNC = /\|\s*Funcionário:\s*(\S+)/;
const LINHA_CORPO = /^Line 1 number:\s*(\S+)/im;

/** Lê os blocos de um arquivo de registro. `padrao` = tipo das mensagens do arquivo (callbacks são detectados pela marca). */
export function lerRegistro(texto: string, padrao: "transferencia" | "longa"): Entrada[] {
  const linhas = texto.replace(/\r\n?/g, "\n").split("\n");
  const saida: Entrada[] = [];
  let atual: { cab: RegExpExecArray; corpo: string[] } | null = null;
  const fechar = (): void => {
    if (!atual) return;
    const [, a, mes, d, h, mi, s, resto = ""] = atual.cab;
    const corpo = atual.corpo.join("\n");
    const funcionario =
      LINHA_FUNC.exec(resto)?.[1] ?? LINHA_CORPO.exec(corpo)?.[1]?.trim() ?? SEM_FUNCIONARIO;
    saida.push({
      tipo: resto.includes("CALLBACK") ? "callback" : padrao,
      quando: new Date(Number(a), Number(mes) - 1, Number(d), Number(h), Number(mi), Number(s)),
      enviada: resto.startsWith("ENVIADA"),
      funcionario,
    });
  };
  for (const linha of linhas) {
    const cab = CABECALHO.exec(linha);
    if (cab) {
      fechar();
      atual = { cab, corpo: [] };
    } else atual?.corpo.push(linha);
  }
  fechar();
  return saida;
}

export interface Periodo {
  de: Date | null;
  ate: Date | null;
  rotulo: string;
}

const inicioDoDia = (d: Date): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const somarDias = (d: Date, n: number): Date =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const fmtData = (d: Date): string =>
  `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;

/** `ate` é exclusivo. Nomes: hoje, ontem, semana (desde segunda-feira), 7dias, mes (desde o dia 1), tudo. */
export function periodoNomeado(nome: string, agora: Date): Periodo | null {
  const hoje = inicioDoDia(agora);
  switch (nome) {
    case "hoje":
      return { de: hoje, ate: somarDias(hoje, 1), rotulo: `hoje (${fmtData(hoje)})` };
    case "ontem": {
      const o = somarDias(hoje, -1);
      return { de: o, ate: hoje, rotulo: `ontem (${fmtData(o)})` };
    }
    case "semana": {
      const dias = (hoje.getDay() + 6) % 7; // segunda = 0
      const seg = somarDias(hoje, -dias);
      return { de: seg, ate: somarDias(hoje, 1), rotulo: `esta semana (desde ${fmtData(seg)})` };
    }
    case "7dias": {
      const ini = somarDias(hoje, -6);
      return { de: ini, ate: somarDias(hoje, 1), rotulo: `últimos 7 dias (desde ${fmtData(ini)})` };
    }
    case "mes": {
      const ini = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
      return { de: ini, ate: somarDias(hoje, 1), rotulo: `este mês (desde ${fmtData(ini)})` };
    }
    case "tudo":
      return { de: null, ate: null, rotulo: "todo o período registrado" };
    default:
      return null;
  }
}

/** Intervalo por datas AAAA-MM-DD (inclusive nas duas pontas). `null` se alguma data for inválida. */
export function periodoPorDatas(de: string, ate: string | undefined): Periodo | null {
  const ler = (t: string): Date | null => {
    const m = /^(\d{4})-(\d\d)-(\d\d)$/.exec(t.trim());
    if (!m) return null;
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return d.getMonth() === Number(m[2]) - 1 ? d : null;
  };
  const a = ler(de);
  const b = ate === undefined ? a : ler(ate);
  if (!a || !b || b < a) return null;
  return {
    de: a,
    ate: somarDias(b, 1),
    rotulo: a.getTime() === b.getTime() ? fmtData(a) : `${fmtData(a)} a ${fmtData(b)}`,
  };
}

export interface LinhaRelatorio {
  funcionario: string;
  semCallback: number;
  callbacks: number;
  comCallback: number;
  longas: number;
}

export function resumir(
  entradas: readonly Entrada[],
  periodo: Periodo,
  incluirObservacao = false,
): LinhaRelatorio[] {
  const por = new Map<string, { t: number; c: number; l: number }>();
  for (const e of entradas) {
    if (!e.enviada && !incluirObservacao) continue;
    if (periodo.de && e.quando < periodo.de) continue;
    if (periodo.ate && e.quando >= periodo.ate) continue;
    const x = por.get(e.funcionario) ?? { t: 0, c: 0, l: 0 };
    if (e.tipo === "transferencia") x.t++;
    else if (e.tipo === "callback") x.c++;
    else x.l++;
    por.set(e.funcionario, x);
  }
  return [...por.entries()]
    .map(([funcionario, x]) => ({
      funcionario,
      comCallback: x.t,
      callbacks: x.c,
      semCallback: Math.max(0, x.t - x.c),
      longas: x.l,
    }))
    .sort((a, b) => b.comCallback - a.comCallback || a.funcionario.localeCompare(b.funcionario));
}

const COLUNAS = [
  "Funcionário (Callback Number)",
  "Transferências sem callback",
  "Callbacks",
  "Transferências com callback",
  "Ligações de 5 min",
] as const;

const valores = (l: LinhaRelatorio): string[] => [
  l.funcionario,
  String(l.semCallback),
  String(l.callbacks),
  String(l.comCallback),
  String(l.longas),
];

export function totalDe(linhas: readonly LinhaRelatorio[]): LinhaRelatorio {
  const t: LinhaRelatorio = {
    funcionario: "TOTAL",
    semCallback: 0,
    callbacks: 0,
    comCallback: 0,
    longas: 0,
  };
  for (const l of linhas) {
    t.semCallback += l.semCallback;
    t.callbacks += l.callbacks;
    t.comCallback += l.comCallback;
    t.longas += l.longas;
  }
  return t;
}

/** Tabela de texto para o console. */
export function formatarTabela(linhas: readonly LinhaRelatorio[], periodo: Periodo): string {
  const corpo = [...linhas, totalDe(linhas)].map(valores);
  const larguras = COLUNAS.map((c, i) =>
    Math.max(c.length, ...corpo.map((l) => (l[i] ?? "").length)),
  );
  const fmt = (cel: readonly string[]): string =>
    cel
      .map((c, i) => (i === 0 ? c.padEnd(larguras[i] ?? 0) : c.padStart(larguras[i] ?? 0)))
      .join(" | ");
  const sep = larguras.map((n) => "-".repeat(n)).join("-+-");
  const linhasTxt = corpo.map(fmt);
  const total = linhasTxt.pop() ?? "";
  return [
    `Relatório de transferências — ${periodo.rotulo}`,
    "",
    fmt([...COLUNAS]),
    sep,
    ...(linhasTxt.length ? linhasTxt : ["(nenhuma mensagem registrada neste período)"]),
    sep,
    total,
  ].join("\n");
}

/** CSV para abrir no Excel em português (separador `;`, UTF-8 com BOM). */
export function formatarCsv(linhas: readonly LinhaRelatorio[]): string {
  const esc = (v: string): string => (/[;"\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const todas = [[...COLUNAS], ...[...linhas, totalDe(linhas)].map(valores)];
  return "﻿" + todas.map((l) => l.map(esc).join(";")).join("\r\n") + "\r\n";
}

export const ARQUIVOS_DO_RELATORIO: ReadonlyArray<{
  arquivo: string;
  padrao: "transferencia" | "longa";
}> = [
  { arquivo: NOME_ARQUIVO.transferencia, padrao: "transferencia" },
  { arquivo: NOME_ARQUIVO.longa, padrao: "longa" },
];
