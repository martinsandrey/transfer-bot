import {
  ARQUIVO_DURACOES,
  ARQUIVO_SEM_MENSAGEM,
  NOME_ARQUIVO,
} from "../registro/registro-arquivo.js";
import { chaveDaTransferencia } from "./callbacks-manuais.js";
import { ARQUIVO_TRANSFERENCIAS_MANUAIS } from "./transferencias-manuais.js";

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
/**
 * Transferência adicionada à mão não tem o código da ligação: conta para a ligação de 5 min do MESMO cliente (telefone) que
 * começou até tanto tempo antes dela (a ligação de 5 min tem de ter sido antes da transferência).
 */
export const JANELA_MANUAL_5MIN_MS = 2 * 3_600_000;

/** Mesmo telefone, com ou sem DDI/DDD na frente (compara o final; pelo menos 8 números). */
function mesmoTelefone(a: string | null, b: string | null): boolean {
  const x = soDigitos(a);
  const y = soDigitos(b);
  return Math.min(x.length, y.length) >= 8 && (x.endsWith(y) || y.endsWith(x));
}

const CABECALHO = /^===== (\d{4})-(\d\d)-(\d\d) (\d\d):(\d\d):(\d\d) \| ([^\n]*?) =====$/;
const CAMPO = (nome: string): RegExp => new RegExp(`\\|\\s*${nome}:\\s*(\\S+)`);
const RE_FUNC = CAMPO("Funcionário");
const RE_CLIENTE = CAMPO("Cliente");
const RE_LIGACAO = CAMPO("Ligação");
const RE_TIPO = /\|\s*Tipo:\s*(transferencia|callback|longa)\b/;
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
      tipo:
        (RE_TIPO.exec(resto)?.[1] as TipoEntrada | undefined) ??
        (resto.includes("CALLBACK") ? "callback" : padrao),
      quando: new Date(Number(a), Number(mes) - 1, Number(d), Number(h), Number(mi), Number(s)),
      // "SEM MENSAGEM (fora do filtro)": o evento aconteceu de verdade, só não gerou mensagem (conta como real, não como prévia).
      enviada: resto.startsWith("ENVIADA") || resto.startsWith("SEM MENSAGEM"),
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

/** Lê `duracoes.txt`: código da ligação → duração em segundos (se houver repetição, vale a última). */
export function lerDuracoes(texto: string): Map<string, number> {
  const mapa = new Map<string, number>();
  for (const linha of texto.replace(/\r\n?/g, "\n").split("\n")) {
    const m = /\|\s*Ligação:\s*(\S+)\s*\|\s*Duração:\s*(\d+)\s*s/.exec(linha);
    if (m) mapa.set(m[1] as string, Number(m[2]));
  }
  return mapa;
}

/** Duração (s) que cada ligação já tinha quando foi transferida (campo "Até a transferência" de duracoes.txt; só registros novos). */
export function lerDuracoesAteTransferencia(texto: string): Map<string, number> {
  const mapa = new Map<string, number>();
  for (const linha of texto.replace(/\r\n?/g, "\n").split("\n")) {
    const m = /\|\s*Ligação:\s*(\S+)\s*\|.*\|\s*Até a transferência:\s*(\d+)\s*s/.exec(linha);
    if (m) mapa.set(m[1] as string, Number(m[2]));
  }
  return mapa;
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
  /** Duração (s) da ligação atendida no Stage 3; `null` se não foi registrada (ligações antigas) ou se foi CALLBACK (exceto o marcado à mão). */
  duracaoSeg: number | null;
  /**
   * Quanto a ligação já durava quando foi transferida para o Stage 3 (é a que entra na duração média); `null` se não foi
   * registrada (registros anteriores a esta versão) ou se foi CALLBACK. Como `duracaoSeg`, é guardada na marcação manual.
   */
  duracaoAteTransfSeg: number | null;
  /** Identifica a transferência para marcá-la como callback no relatório (ver `callbacks-manuais.ts`); ausente no CALLBACK sem transferência. */
  chave?: string;
  /** CALLBACK marcado à mão no relatório (o bot tinha registrado como atendida). */
  manual?: boolean;
  /** CALLBACK do bot: quando ele foi registrado. */
  quandoCallback?: Date;
  /**
   * CALLBACK do bot desfeito porque o MESMO cliente foi transferido de novo (por qualquer funcionário) e dessa vez foi atendido
   * por tempo suficiente, dentro da janela (ver `OpcoesMontagem.religacao`). A ligação deixa de contar: ela e a nova viram UMA
   * transferência normal, contada na nova.
   */
  callbackRemovido?: { quando: Date; funcionario: string };
  /** Nova transferência atendida que absorveu tantos CALLBACKs anteriores do mesmo cliente. */
  substituiu?: number;
}

export interface OpcoesMontagem {
  /**
   * Religação: CALLBACK do bot é desfeito se o mesmo cliente for transferido de novo até `janelaMs` depois do CALLBACK e essa nova
   * transferência tiver sido atendida e durado pelo menos `duracaoMinSeg` (duração registrada em duracoes.txt). Ausente ou
   * `janelaMs` 0 = desligado.
   */
  religacao?: { janelaMs: number; duracaoMinSeg: number };
  /** Duração até a transferência por código de ligação (ver `lerDuracoesAteTransferencia`). */
  ateTransferencia?: ReadonlyMap<string, number>;
}

const soDigitos = (s: string | null): string => (s ?? "").replace(/\D+/g, "");

/** Aplica a regra da religação (ver `OpcoesMontagem.religacao`) na lista já montada. */
function aplicarReligacao(
  ligacoes: Ligacao[],
  op: { janelaMs: number; duracaoMinSeg: number },
): void {
  // Candidatas a "nova transferência": atendidas (nem CALLBACK do bot nem marcadas à mão) com duração registrada suficiente.
  const atendidas = ligacoes.filter(
    (l) =>
      !l.semTransferencia &&
      l.resultado === "atendida" &&
      l.duracaoSeg !== null &&
      l.duracaoSeg >= op.duracaoMinSeg &&
      soDigitos(l.cliente) !== "",
  );
  for (const l of ligacoes) {
    // Só o CALLBACK do bot (o marcado à mão no relatório é decisão do usuário e fica como está).
    if (l.resultado !== "callback" || l.manual || !l.quandoCallback) continue;
    const cliente = soDigitos(l.cliente);
    if (cliente === "") continue;
    const ate = l.quandoCallback.getTime() + op.janelaMs;
    const nova = atendidas
      .filter(
        (o) =>
          o !== l &&
          o.observacao === l.observacao &&
          soDigitos(o.cliente) === cliente &&
          o.quando.getTime() > l.quando.getTime() &&
          o.quando.getTime() <= ate,
      )
      .sort((a, b) => a.quando.getTime() - b.quando.getTime())[0];
    if (!nova) continue;
    l.callbackRemovido = { quando: nova.quando, funcionario: nova.funcionario };
    nova.substituiu = (nova.substituiu ?? 0) + 1;
  }
}

export interface LigacaoLonga {
  quando: Date;
  funcionario: string;
  cliente: string | null;
  observacao: boolean;
  /** A ligação de 5 min depois foi transferida (mesmo código da ligação); `null` = registro antigo, sem código (fora do cálculo). */
  transferida: boolean | null;
}

/** Liga cada CALLBACK à transferência da mesma ligação e devolve as ligações transferidas e as de 5 min. */
export function montarLigacoes(
  entradas: readonly Entrada[],
  duracoes: ReadonlyMap<string, number> = new Map(),
  /** Marcações feitas no relatório (chave → marcada como callback). */
  manuais: ReadonlyMap<string, boolean> = new Map(),
  op: OpcoesMontagem = {},
): {
  ligacoes: Ligacao[];
  longas: LigacaoLonga[];
} {
  const ordenadas = [...entradas].sort(
    (a, b) => a.quando.getTime() - b.quando.getTime() || a.ordem - b.ordem,
  );
  // Uma ligação com código aparece uma vez por tipo: repetições do mesmo código (mensagem reenviada após reinício) não contam de novo.
  const vistos = new Set<string>();
  const unicas = ordenadas.filter((e) => {
    if (!e.ligacao || e.tipo === "callback") return true;
    const chave = `${e.tipo}|${e.ligacao}|${e.enviada}`;
    if (vistos.has(chave)) return false;
    vistos.add(chave);
    return true;
  });
  const transf = unicas.filter((e) => e.tipo === "transferencia");
  const codigosTransferidos = new Set(transf.flatMap((t) => (t.ligacao ? [t.ligacao] : [])));
  const calls = ordenadas.filter((e) => e.tipo === "callback");
  /** Transferência → o CALLBACK ligado a ela. */
  const comCallback = new Map<Entrada, Entrada>();
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
    if (alvo) comCallback.set(alvo, c);
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
    if (alvo) comCallback.set(alvo, c);
    else orfaos.push(c);
  }

  const ligacoes: Ligacao[] = [
    ...transf.map((t): Ligacao => {
      const chave = chaveDaTransferencia(t);
      const doBot = comCallback.get(t);
      const manual = !doBot && manuais.get(chave) === true;
      const callback = !!doBot || manual;
      return {
        quando: t.quando,
        funcionario: t.funcionario,
        cliente: t.cliente,
        resultado: callback ? "callback" : "atendida",
        observacao: !t.enviada,
        semTransferencia: false,
        // A marcação manual guarda a duração medida: "Desfazer" no relatório volta a mostrá-la (callbacks nunca entram na média).
        duracaoSeg: comCallback.has(t) || !t.ligacao ? null : (duracoes.get(t.ligacao) ?? null),
        duracaoAteTransfSeg:
          comCallback.has(t) || !t.ligacao ? null : (op.ateTransferencia?.get(t.ligacao) ?? null),
        chave,
        manual,
        ...(doBot ? { quandoCallback: doBot.quando } : {}),
      };
    }),
    ...orfaos.map((c): Ligacao => ({
      quando: c.quando,
      funcionario: c.funcionario,
      cliente: c.cliente,
      resultado: "callback",
      observacao: !c.enviada,
      semTransferencia: true,
      duracaoSeg: null,
      duracaoAteTransfSeg: null,
      quandoCallback: c.quando,
    })),
  ].sort((a, b) => a.quando.getTime() - b.quando.getTime());
  if (op.religacao && op.religacao.janelaMs > 0) aplicarReligacao(ligacoes, op.religacao);

  const entradasLongas = unicas.filter((e) => e.tipo === "longa");
  // Transferências adicionadas à mão: cada uma "transfere" a ligação de 5 min mais recente do mesmo cliente (antes dela).
  const transferidasAMao = new Set<Entrada>();
  for (const t of transf) {
    if (!t.ligacao?.startsWith("manual-")) continue;
    const alvo = [...entradasLongas]
      .reverse()
      .find(
        (l) =>
          !transferidasAMao.has(l) &&
          !(l.ligacao && codigosTransferidos.has(l.ligacao)) &&
          l.enviada === t.enviada &&
          mesmoTelefone(l.cliente, t.cliente) &&
          l.quando.getTime() <= t.quando.getTime() + 5 * 60_000 &&
          t.quando.getTime() - l.quando.getTime() <= JANELA_MANUAL_5MIN_MS,
      );
    if (alvo) transferidasAMao.add(alvo);
  }
  const longas = entradasLongas.map((e): LigacaoLonga => ({
    quando: e.quando,
    funcionario: e.funcionario,
    cliente: e.cliente,
    observacao: !e.enviada,
    transferida: transferidasAMao.has(e)
      ? true
      : e.ligacao
        ? codigosTransferidos.has(e.ligacao)
        : null,
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
  /** Duração média (s) das transferências SEM callback que têm duração registrada; `null` se nenhuma. */
  mediaSeg: number | null;
  /** Quantas transferências sem callback entraram na média. */
  comDuracao: number;
  /** Ligações de 5 min (com código) que depois foram transferidas, e quantas ligações de 5 min entram nesse cálculo. */
  longasTransferidas: number;
  longasAvaliadas: number;
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
      por.set(
        f,
        (l = {
          funcionario: f,
          comCallback: 0,
          semCallback: 0,
          callbacks: 0,
          longas: 0,
          mediaSeg: null,
          comDuracao: 0,
          longasTransferidas: 0,
          longasAvaliadas: 0,
        }),
      );
    return l;
  };
  const somas = new Map<string, number>();
  for (const c of dados.ligacoes) {
    if (c.callbackRemovido || !dentro(c.quando, c.observacao)) continue;
    const l = linha(c.funcionario);
    l.comCallback++;
    if (c.resultado === "callback") l.callbacks++;
    else {
      l.semCallback++;
      if (c.duracaoAteTransfSeg !== null) {
        l.comDuracao++;
        somas.set(c.funcionario, (somas.get(c.funcionario) ?? 0) + c.duracaoAteTransfSeg);
      }
    }
  }
  for (const l of por.values())
    l.mediaSeg = l.comDuracao > 0 ? (somas.get(l.funcionario) ?? 0) / l.comDuracao : null;
  for (const c of dados.longas) {
    if (!dentro(c.quando, c.observacao)) continue;
    const l = linha(c.funcionario);
    l.longas++;
    if (c.transferida !== null) {
      l.longasAvaliadas++;
      if (c.transferida) l.longasTransferidas++;
    }
  }
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
    mediaSeg: null,
    comDuracao: 0,
    longasTransferidas: 0,
    longasAvaliadas: 0,
  };
  let soma = 0;
  for (const l of linhas) {
    soma += (l.mediaSeg ?? 0) * l.comDuracao;
    t.comDuracao += l.comDuracao;
    t.comCallback += l.comCallback;
    t.semCallback += l.semCallback;
    t.callbacks += l.callbacks;
    t.longas += l.longas;
    t.longasTransferidas += l.longasTransferidas;
    t.longasAvaliadas += l.longasAvaliadas;
  }
  t.mediaSeg = t.comDuracao > 0 ? soma / t.comDuracao : null;
  return t;
}

export const ARQUIVOS_DO_RELATORIO: ReadonlyArray<{
  arquivo: string;
  padrao: "transferencia" | "longa";
}> = [
  { arquivo: NOME_ARQUIVO.transferencia, padrao: "transferencia" },
  { arquivo: NOME_ARQUIVO.longa, padrao: "longa" },
  { arquivo: ARQUIVO_SEM_MENSAGEM, padrao: "transferencia" },
  { arquivo: ARQUIVO_TRANSFERENCIAS_MANUAIS, padrao: "transferencia" },
];

export { ARQUIVO_DURACOES };
