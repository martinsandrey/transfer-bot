import { NOME_ARQUIVO } from "../registro/registro-arquivo.js";

/**
 * Relatório por funcionário, calculado a partir dos .txt de registro (nenhum histórico estruturado é criado).
 *
 * Cada LIGAÇÃO transferida gera uma mensagem de transferência (quando o Stage 3 toca) e, se ninguém atender, um CALLBACK. O
 * registro grava um código da ligação no cabeçalho de cada bloco; o relatório liga o CALLBACK à transferência pelo código.
 * Registros antigos (sem código) são ligados por proximidade: o CALLBACK vai para a transferência mais recente ainda sem
 * CALLBACK, do mesmo funcionário (quando o funcionário é conhecido), dentro de `JANELA_PAREAMENTO_MS`.
 */

export type TipoEntrada = "transferencia" | "callback" | "longa";

export interface Entrada {
  tipo: TipoEntrada;
  quando: Date;
  enviada: boolean;
  funcionario: string;
  cliente: string | null;
  /** Código da ligação (registros novos). */
  ligacao: string | null;
  /** Ordem do bloco no arquivo (desempate). */
  ordem: number;
}

export const SEM_FUNCIONARIO = "(não identificado)";
export const JANELA_PAREAMENTO_MS = 30 * 60_000;

const CABECALHO = /^===== (\d{4})-(\d\d)-(\d\d) (\d\d):(\d\d):(\d\d) \| ([^\n]*?) =====$/;
const CAMPO = (nome: string): RegExp => new RegExp(`\\|\\s*${nome}:\\s*(\\S+)`);
const RE_FUNC = CAMPO("Funcionário");
const RE_CLIENTE = CAMPO("Cliente");
const RE_LIGACAO = CAMPO("Ligação");
const LINHA_CORPO = /^Line 1 number:\s*(\S+)/im;
const LINHA_PH = /^Ph:\s*(\S+)/im;

/** Lê os blocos de um arquivo de registro. `padrao` = tipo das mensagens do arquivo (callbacks são detectados pela marca). */
export function lerRegistro(texto: string, padrao: "transferencia" | "longa"): Entrada[] {
  const linhas = texto.replace(/\r\n?/g, "\n").split("\n");
  const saida: Entrada[] = [];
  let atual: { cab: RegExpExecArray; corpo: string[] } | null = null;
  const fechar = (): void => {
    if (!atual) return;
    const [, a, mes, d, h, mi, s, resto = ""] = atual.cab;
    const corpo = atual.corpo.join("\n");
    saida.push({
      tipo: resto.includes("CALLBACK") ? "callback" : padrao,
      quando: new Date(Number(a), Number(mes) - 1, Number(d), Number(h), Number(mi), Number(s)),
      enviada: resto.startsWith("ENVIADA"),
      funcionario:
        RE_FUNC.exec(resto)?.[1] ?? LINHA_CORPO.exec(corpo)?.[1]?.trim() ?? SEM_FUNCIONARIO,
      cliente: RE_CLIENTE.exec(resto)?.[1] ?? LINHA_PH.exec(corpo)?.[1]?.trim() ?? null,
      ligacao: RE_LIGACAO.exec(resto)?.[1] ?? null,
      ordem: saida.length,
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

export interface Ligacao {
  /** Momento da transferência (para CALLBACK sem transferência registrada: o momento do CALLBACK). */
  quando: Date;
  funcionario: string;
  cliente: string | null;
  /** `callback` = ninguém atendeu; `atendida` = não houve CALLBACK. */
  resultado: "atendida" | "callback";
  /** Foi só prévia do modo observação (nada enviado). */
  observacao: boolean;
  /** O CALLBACK não tem a transferência correspondente no registro. */
  semTransferencia: boolean;
}

export interface LigacaoLonga {
  quando: Date;
  funcionario: string;
  cliente: string | null;
  observacao: boolean;
}

/** Liga cada CALLBACK à transferência da mesma ligação e devolve as ligações transferidas e as de 5 min. */
export function montarLigacoes(entradas: readonly Entrada[]): {
  ligacoes: Ligacao[];
  longas: LigacaoLonga[];
} {
  const ordenadas = [...entradas].sort(
    (a, b) => a.quando.getTime() - b.quando.getTime() || a.ordem - b.ordem,
  );
  const transf = ordenadas.filter((e) => e.tipo === "transferencia");
  const calls = ordenadas.filter((e) => e.tipo === "callback");
  const comCallback = new Set<Entrada>();
  const orfaos: Entrada[] = [];

  // 1) Registros novos: o código da ligação liga os dois.
  const porCodigo = new Map<string, Entrada[]>();
  for (const t of transf)
    if (t.ligacao) porCodigo.set(t.ligacao, [...(porCodigo.get(t.ligacao) ?? []), t]);
  const semCodigo: Entrada[] = [];
  for (const c of calls) {
    if (!c.ligacao) {
      semCodigo.push(c);
      continue;
    }
    const alvo = (porCodigo.get(c.ligacao) ?? []).find(
      (t) => t.enviada === c.enviada && !comCallback.has(t),
    );
    if (alvo) comCallback.add(alvo);
    else orfaos.push(c);
  }
  // 2) Registros antigos: a transferência mais recente, ainda sem CALLBACK, do mesmo funcionário, antes do CALLBACK.
  for (const c of semCodigo) {
    const alvo = [...transf]
      .reverse()
      .find(
        (t) =>
          !comCallback.has(t) &&
          t.enviada === c.enviada &&
          t.quando <= c.quando &&
          c.quando.getTime() - t.quando.getTime() <= JANELA_PAREAMENTO_MS &&
          (c.funcionario === SEM_FUNCIONARIO || t.funcionario === c.funcionario) &&
          (c.cliente === null || t.cliente === null || c.cliente === t.cliente),
      );
    if (alvo) comCallback.add(alvo);
    else orfaos.push(c);
  }

  const ligacoes: Ligacao[] = [
    ...transf.map((t): Ligacao => ({
      quando: t.quando,
      funcionario: t.funcionario,
      cliente: t.cliente,
      resultado: comCallback.has(t) ? "callback" : "atendida",
      observacao: !t.enviada,
      semTransferencia: false,
    })),
    ...orfaos.map((c): Ligacao => ({
      quando: c.quando,
      funcionario: c.funcionario,
      cliente: c.cliente,
      resultado: "callback",
      observacao: !c.enviada,
      semTransferencia: true,
    })),
  ].sort((a, b) => a.quando.getTime() - b.quando.getTime());

  const longas = ordenadas
    .filter((e) => e.tipo === "longa")
    .map((e): LigacaoLonga => ({
      quando: e.quando,
      funcionario: e.funcionario,
      cliente: e.cliente,
      observacao: !e.enviada,
    }));
  return { ligacoes, longas };
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

export const NOMES_DE_PERIODO = ["hoje", "ontem", "semana", "7dias", "mes", "tudo"] as const;

/** `ate` é exclusivo. Nomes: hoje, ontem, semana (desde segunda-feira), 7dias, mes (desde o dia 1), tudo. */
export function periodoNomeado(nome: string, agora: Date): Periodo | null {
  const hoje = inicioDoDia(agora);
  switch (nome) {
    case "hoje":
      return { de: hoje, ate: somarDias(hoje, 1), rotulo: `Hoje (${fmtData(hoje)})` };
    case "ontem": {
      const o = somarDias(hoje, -1);
      return { de: o, ate: hoje, rotulo: `Ontem (${fmtData(o)})` };
    }
    case "semana": {
      const dias = (hoje.getDay() + 6) % 7; // segunda = 0
      const seg = somarDias(hoje, -dias);
      return { de: seg, ate: somarDias(hoje, 1), rotulo: `Esta semana (desde ${fmtData(seg)})` };
    }
    case "7dias": {
      const ini = somarDias(hoje, -6);
      return { de: ini, ate: somarDias(hoje, 1), rotulo: `Últimos 7 dias (desde ${fmtData(ini)})` };
    }
    case "mes": {
      const ini = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
      return { de: ini, ate: somarDias(hoje, 1), rotulo: `Este mês (desde ${fmtData(ini)})` };
    }
    case "tudo":
      return { de: null, ate: null, rotulo: "Todo o período registrado" };
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
  /** Todas as transferências do funcionário (inclui as que deram CALLBACK). */
  comCallback: number;
  /** Transferências atendidas (sem CALLBACK). */
  semCallback: number;
  /** Transferências em que ninguém atendeu. */
  callbacks: number;
  longas: number;
}

export function resumir(
  dados: { ligacoes: readonly Ligacao[]; longas: readonly LigacaoLonga[] },
  periodo: Periodo,
  incluirObservacao = false,
): LinhaRelatorio[] {
  const dentro = (q: Date, obs: boolean): boolean =>
    (incluirObservacao || !obs) &&
    !(periodo.de && q < periodo.de) &&
    !(periodo.ate && q >= periodo.ate);
  const por = new Map<string, LinhaRelatorio>();
  const linha = (f: string): LinhaRelatorio => {
    let l = por.get(f);
    if (!l)
      por.set(f, (l = { funcionario: f, comCallback: 0, semCallback: 0, callbacks: 0, longas: 0 }));
    return l;
  };
  for (const c of dados.ligacoes) {
    if (!dentro(c.quando, c.observacao)) continue;
    const l = linha(c.funcionario);
    l.comCallback++;
    if (c.resultado === "callback") l.callbacks++;
    else l.semCallback++;
  }
  for (const c of dados.longas) if (dentro(c.quando, c.observacao)) linha(c.funcionario).longas++;
  return [...por.values()].sort(
    (a, b) => b.comCallback - a.comCallback || a.funcionario.localeCompare(b.funcionario),
  );
}

export function totalDe(linhas: readonly LinhaRelatorio[]): LinhaRelatorio {
  const t: LinhaRelatorio = {
    funcionario: "TOTAL",
    comCallback: 0,
    semCallback: 0,
    callbacks: 0,
    longas: 0,
  };
  for (const l of linhas) {
    t.comCallback += l.comCallback;
    t.semCallback += l.semCallback;
    t.callbacks += l.callbacks;
    t.longas += l.longas;
  }
  return t;
}

export const ARQUIVOS_DO_RELATORIO: ReadonlyArray<{
  arquivo: string;
  padrao: "transferencia" | "longa";
}> = [
  { arquivo: NOME_ARQUIVO.transferencia, padrao: "transferencia" },
  { arquivo: NOME_ARQUIVO.longa, padrao: "longa" },
];
