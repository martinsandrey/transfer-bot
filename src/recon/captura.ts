import type { Frame, Page } from "playwright";
import type { Anonimizador } from "./anonimizador.js";
import { normalizarCabecalho, politicaDaColuna, formaDoValor } from "./anonimizador.js";
import {
  extrairNoNavegador,
  lerContadorMutacoes,
  diagnosticarNoNavegador,
  type OpcoesExtracao,
  type PaginaBruta,
  type TabelaBruta,
} from "./pagina-dom.js";
import { padraoCaminho } from "./forma-json.js";

export type TipoCaptura = "login" | "tabela" | "clientes" | "resultado" | "edicao" | "menu";

/** Nas telas que mostram dados de cliente, títulos/ cabeçalhos livres viram apenas "forma". */
const TIPOS_SENSIVEIS: ReadonlySet<TipoCaptura> = new Set(["resultado", "edicao"]);

function limparAtributos(
  anon: Anonimizador,
  atributos: Record<string, string>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(atributos).map(([k, v]) => [k, anon.limparAtributo(k, v)]),
  );
}

export function sanearTabela(anon: Anonimizador, t: TabelaBruta, maxLinhas: number): unknown {
  const politicas = t.cabecalhos.map(politicaDaColuna);
  return {
    indice: t.indice,
    tipo: t.tipo,
    atributos: limparAtributos(anon, t.atributos),
    cabecalhos: t.cabecalhos,
    totalLinhas: t.totalLinhas,
    linhasAmostra: t.linhas.slice(0, maxLinhas).map((l) => ({
      atributos: limparAtributos(anon, l.atributos),
      celulas: l.celulas.map((c, i) => ({
        valor: anon.celula(politicas[i] ?? "generica", i, c.texto),
        ...(c.textoOculto !== null
          ? { textoOcultoDiferente: anon.marcador("OCULTO", c.textoOculto) }
          : {}),
        atributos: limparAtributos(anon, c.atributos),
        esqueleto: c.esqueleto,
      })),
    })),
  };
}

export function sanearPagina(anon: Anonimizador, bruta: PaginaBruta, tipo: TipoCaptura): unknown {
  const sensivel = TIPOS_SENSIVEIS.has(tipo);
  const texto = (t: string): string => (sensivel ? formaDoValor(t) : anon.limparTexto(t));
  const menus = bruta.controles.filter((c) => c.dentroDe !== null && !c.dentroDeTabela);
  return {
    tipo,
    caminho: padraoCaminho(bruta.caminho),
    titulo: texto(bruta.titulo),
    titulosNaPagina: bruta.titulos.map(texto),
    captcha: {
      detectado: bruta.captcha.hostsDeIframe.length > 0 || bruta.captcha.elementos > 0,
      ...bruta.captcha,
    },
    formularios: bruta.formularios.map((f) => ({
      ...f,
      atributos: limparAtributos(anon, f.atributos),
    })),
    controles: bruta.controles
      .filter((c) => !c.dentroDeTabela)
      .map((c) => ({
        tag: c.tag,
        tipo: c.tipo,
        visivel: c.visivel,
        rotulo: c.rotulo === null ? null : anon.limparTexto(c.rotulo),
        texto: c.texto === null ? null : anon.limparTexto(c.texto),
        dentroDe: c.dentroDe,
        atributos: limparAtributos(anon, c.atributos),
      })),
    controlesDentroDeTabela: bruta.controles.filter((c) => c.dentroDeTabela).length,
    itensDeMenu: menus.length,
    folhasDeMenu: bruta.folhasDeMenu.map((f) => ({
      tag: f.tag,
      texto: anon.limparTexto(f.texto),
      atributos: limparAtributos(anon, f.atributos),
    })),
    tabelas: bruta.tabelas.map((t) => sanearTabela(anon, t, 5)),
  };
}

/** Cabeçalhos informados pelo usuário; usados só para localizar a tabela (não são dados de clientes). */
export const CABECALHOS_CONHECIDOS = [
  "Callback Number",
  "Callee Number",
  "Call Status",
  "Start Time",
  "Call Duration",
];

export function opcoesExtracao(
  parcial: Pick<OpcoesExtracao, "maxLinhas" | "indice">,
): OpcoesExtracao {
  return { ...parcial, heuristicas: true, cabecalhosConhecidos: CABECALHOS_CONHECIDOS };
}

export async function capturarPagina(
  page: Page,
  anon: Anonimizador,
  tipo: TipoCaptura,
): Promise<unknown> {
  const principal = await page
    .mainFrame()
    .evaluate(extrairNoNavegador, opcoesExtracao({ maxLinhas: 8, indice: null }));
  const saida = sanearPagina(anon, principal, tipo) as Record<string, unknown>;
  const outros: unknown[] = [];
  for (const f of page.frames()) {
    if (f === page.mainFrame()) continue;
    try {
      const bruta = await f.evaluate(
        extrairNoNavegador,
        opcoesExtracao({ maxLinhas: 8, indice: null }),
      );
      outros.push(sanearPagina(anon, bruta, tipo));
    } catch {
      outros.push({ erro: "frame_inacessivel" });
    }
  }
  return { ...saida, frames: outros };
}

/** Diz ONDE aparecem os cabeçalhos conhecidos (frames, Shadow DOM, ancestrais). Sem valores de células. */
export async function diagnosticarPagina(page: Page, anon: Anonimizador): Promise<unknown> {
  const resultados: unknown[] = [];
  for (const [i, f] of page.frames().entries()) {
    try {
      const d = await f.evaluate(diagnosticarNoNavegador, CABECALHOS_CONHECIDOS);
      resultados.push({
        frame: i === 0 ? "principal" : `subframe ${i}`,
        caminho: padraoCaminho(d.frame),
        totais: d.totais,
        achados: d.achados.map((a) => ({
          ...a,
          frame: i === 0 ? "principal" : `subframe ${i}`,
          cadeia: a.cadeia.map((c) => ({
            tag: c.tag,
            id: anon.limparAtributo("id", c.id),
            classes: anon.limparAtributo("class", c.classes),
            role: c.role,
          })),
        })),
      });
    } catch {
      resultados.push({ frame: `subframe ${i}`, erro: "frame_inacessivel" });
    }
  }
  return { frames: resultados };
}

// ------------------------------------------------------------------ série temporal

export interface SnapshotSerie {
  i: number;
  tMs: number;
  mutacoes: number;
  visibilidade: string;
  foco: boolean;
  linhas: string[][]; // valores já anonimizados, alinhados a `cabecalhos`
}

export interface SerieCapturada {
  cabecalhos: string[];
  snapshots: SnapshotSerie[];
}

export interface OpcoesSerie {
  duracaoMs: number;
  intervaloMs: number;
  /** Índice da tabela a observar; `null` escolhe a que tem o cabeçalho "Callback Number". */
  indiceTabela: number | null;
  pausar?: (ms: number) => Promise<void>;
  agora?: () => number;
}

export interface TabelaLocalizada {
  frame: Frame;
  indice: number;
}

/** Procura (em todos os frames) a tabela que tem o cabeçalho "Callback Number". */
export async function escolherTabelaDeChamadas(page: Page): Promise<TabelaLocalizada | null> {
  for (const frame of page.frames()) {
    try {
      const bruta = await frame.evaluate(
        extrairNoNavegador,
        opcoesExtracao({ maxLinhas: 0, indice: null }),
      );
      const alvo = bruta.tabelas.find((t) =>
        t.cabecalhos.some((h) => normalizarCabecalho(h) === "callback number"),
      );
      if (alvo) return { frame, indice: alvo.indice };
    } catch {
      /* frame fechado/navegando: tenta o próximo */
    }
  }
  return null;
}

export async function capturarSerie(
  page: Page,
  anon: Anonimizador,
  op: OpcoesSerie,
): Promise<SerieCapturada> {
  const pausar = op.pausar ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const agora = op.agora ?? Date.now;
  const alvo =
    op.indiceTabela !== null
      ? { frame: page.mainFrame(), indice: op.indiceTabela }
      : await escolherTabelaDeChamadas(page);
  if (alvo === null)
    throw new Error(
      'Não encontrei uma tabela com a coluna "Callback Number" nesta aba. Rode o comando "diagnostico" e me envie o resultado.',
    );
  const { frame, indice } = alvo;

  const snapshots: SnapshotSerie[] = [];
  let cabecalhos: string[] = [];
  const t0 = agora();
  await frame.evaluate(lerContadorMutacoes); // instala o contador
  for (let i = 0; agora() - t0 < op.duracaoMs; i++) {
    const inicioLeitura = agora();
    const bruta = await frame.evaluate(
      extrairNoNavegador,
      opcoesExtracao({ maxLinhas: 5000, indice }),
    );
    const mut = await frame.evaluate(lerContadorMutacoes);
    const tabela = bruta.tabelas[0];
    if (tabela) {
      cabecalhos = tabela.cabecalhos;
      const politicas = cabecalhos.map(politicaDaColuna);
      snapshots.push({
        i,
        tMs: inicioLeitura - t0,
        mutacoes: mut.mutacoes,
        visibilidade: mut.visibilidade,
        foco: mut.foco,
        linhas: tabela.linhas.map((l) =>
          l.celulas.map((c, k) => anon.celula(politicas[k] ?? "generica", k, c.texto)),
        ),
      });
    }
    await pausar(Math.max(0, op.intervaloMs - (agora() - inicioLeitura)));
  }
  return { cabecalhos, snapshots };
}

// ------------------------------------------------------------------ análise (pura, sem navegador)

export interface EventoFuncionario {
  i: number;
  tipo: "apareceu" | "sumiu" | "status" | "inicio_mudou" | "callee_mudou";
  de?: string;
  para?: string;
}

export interface AnaliseSerie {
  colunasEncontradas: Record<string, number | null>;
  snapshots: number;
  linhasMinMax: [number, number];
  intervaloMedianoMs: number | null;
  snapshotsComMutacao: number;
  statusDistintos: string[];
  transicoesDeStatus: Record<string, number>;
  statusAntesDeSumir: Record<string, number>;
  snapshotsComCallbackDuplicado: number;
  pares_com_ordem_diferente: number;
  mudancasDeInicioSemSumir: number;
  mudancasDeCalleeSemSumir: number;
  reaparecimentosComInicioDiferente: number;
  funcionarios: Record<string, EventoFuncionario[]>;
}

function mediana(v: number[]): number | null {
  if (!v.length) return null;
  const o = [...v].sort((a, b) => a - b);
  return o[Math.floor(o.length / 2)] ?? null;
}

export function analisarSerie(serie: SerieCapturada): AnaliseSerie {
  const idx = (nome: string): number | null => {
    const i = serie.cabecalhos.findIndex((h) => normalizarCabecalho(h) === nome);
    return i >= 0 ? i : null;
  };
  const cCb = idx("callback number");
  const cCe = idx("callee number");
  const cSt = idx("call status");
  const cIn = idx("start time");

  const a: AnaliseSerie = {
    colunasEncontradas: {
      "Callback Number": cCb,
      "Callee Number": cCe,
      "Call Status": cSt,
      "Start Time": cIn,
    },
    snapshots: serie.snapshots.length,
    linhasMinMax: [0, 0],
    intervaloMedianoMs: mediana(
      serie.snapshots.slice(1).map((s, k) => s.tMs - (serie.snapshots[k]?.tMs ?? s.tMs)),
    ),
    snapshotsComMutacao: serie.snapshots.filter((s) => s.mutacoes > 0).length,
    statusDistintos: [],
    transicoesDeStatus: {},
    statusAntesDeSumir: {},
    snapshotsComCallbackDuplicado: 0,
    pares_com_ordem_diferente: 0,
    mudancasDeInicioSemSumir: 0,
    mudancasDeCalleeSemSumir: 0,
    reaparecimentosComInicioDiferente: 0,
    funcionarios: {},
  };
  const tamanhos = serie.snapshots.map((s) => s.linhas.length);
  if (tamanhos.length) a.linhasMinMax = [Math.min(...tamanhos), Math.max(...tamanhos)];
  if (cCb === null) return a;

  const status = new Set<string>();
  const conta = (m: Record<string, number>, k: string): void => void (m[k] = (m[k] ?? 0) + 1);
  type Estado = { st: string; ini: string; ce: string };
  let anterior = new Map<string, Estado>();
  const ultimoVisto = new Map<string, Estado>(); // para detectar reaparecimento
  let ordemAnterior: string[] = [];
  const eventos = (f: string): EventoFuncionario[] => (a.funcionarios[f] ??= []);

  for (const s of serie.snapshots) {
    const atual = new Map<string, Estado>();
    const ordem: string[] = [];
    const vistos = new Set<string>();
    let duplicado = false;
    for (const l of s.linhas) {
      const f = l[cCb] ?? "";
      if (!f) continue;
      if (vistos.has(f)) duplicado = true;
      vistos.add(f);
      ordem.push(f);
      const est: Estado = {
        st: cSt === null ? "" : (l[cSt] ?? ""),
        ini: cIn === null ? "" : (l[cIn] ?? ""),
        ce: cCe === null ? "" : (l[cCe] ?? ""),
      };
      atual.set(f, est);
      if (est.st) status.add(est.st);
    }
    if (duplicado) a.snapshotsComCallbackDuplicado++;

    for (const [f, est] of atual) {
      const antes = anterior.get(f);
      if (!antes) {
        eventos(f).push({ i: s.i, tipo: "apareceu", para: `${est.st}|${est.ini}|${est.ce}` });
        const visto = ultimoVisto.get(f);
        if (visto && visto.ini !== est.ini) a.reaparecimentosComInicioDiferente++;
      } else {
        if (antes.st !== est.st) {
          eventos(f).push({ i: s.i, tipo: "status", de: antes.st, para: est.st });
          conta(a.transicoesDeStatus, `${antes.st} → ${est.st}`);
        }
        if (antes.ini !== est.ini) {
          eventos(f).push({ i: s.i, tipo: "inicio_mudou", de: antes.ini, para: est.ini });
          a.mudancasDeInicioSemSumir++;
        }
        if (antes.ce !== est.ce) {
          eventos(f).push({ i: s.i, tipo: "callee_mudou", de: antes.ce, para: est.ce });
          a.mudancasDeCalleeSemSumir++;
        }
      }
      ultimoVisto.set(f, est);
    }
    for (const [f, antes] of anterior) {
      if (!atual.has(f)) {
        eventos(f).push({ i: s.i, tipo: "sumiu", de: antes.st });
        conta(a.statusAntesDeSumir, antes.st);
      }
    }
    // reordenação: compara a ordem relativa dos funcionários presentes nos dois snapshots
    const comuns = ordem.filter((f) => ordemAnterior.includes(f));
    const comunsAnt = ordemAnterior.filter((f) => ordem.includes(f));
    if (comuns.join("|") !== comunsAnt.join("|")) a.pares_com_ordem_diferente++;
    ordemAnterior = ordem;
    anterior = atual;
  }
  a.statusDistintos = [...status].sort();
  return a;
}

// ------------------------------------------------------------------ monitor de abas

export interface AmostraAba {
  tSeg: number;
  aba: number;
  caminho: string;
  visibilidade: string;
  foco: boolean;
  mutacoes: number;
  linhasEmTabelas: number;
}

export async function amostrarAbas(
  paginas: () => Page[],
  duracaoMs: number,
  pausar: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  agora: () => number = Date.now,
): Promise<AmostraAba[]> {
  const saida: AmostraAba[] = [];
  const t0 = agora();
  while (agora() - t0 < duracaoMs) {
    const lista = paginas();
    for (const [aba, p] of lista.entries()) {
      try {
        const m = await p.evaluate(lerContadorMutacoes);
        const info = await p.evaluate(() => ({
          caminho: location.pathname,
          linhas: document.querySelectorAll("tbody tr, [role=row]").length,
        }));
        saida.push({
          tSeg: Math.round((agora() - t0) / 1000),
          aba,
          caminho: padraoCaminho(info.caminho),
          visibilidade: m.visibilidade,
          foco: m.foco,
          mutacoes: m.mutacoes,
          linhasEmTabelas: info.linhas,
        });
      } catch {
        saida.push({
          tSeg: Math.round((agora() - t0) / 1000),
          aba,
          caminho: "<erro de leitura>",
          visibilidade: "?",
          foco: false,
          mutacoes: 0,
          linhasEmTabelas: 0,
        });
      }
    }
    await pausar(1000);
  }
  return saida;
}
