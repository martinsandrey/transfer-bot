import type { Page } from "playwright";
import {
  SessaoExpiradaError,
  type CallRow,
  type TableReader,
  type TableSnapshot,
} from "../dominio/tipos.js";
import { normalizarCabecalho } from "../recon/anonimizador.js";
import { extrairNoNavegador, type TabelaBruta } from "../recon/pagina-dom.js";
import { somenteDigitos } from "../util/mascara.js";

/**
 * Cabeçalhos informados pelo usuário. A estrutura (tabela HTML/ARIA cujo cabeçalho contém estes textos) é uma
 * SUPOSIÇÃO: TODO(confirmar) com a evidência do `npm run recon` (P3). Nenhum seletor do site é usado.
 */
export const CABECALHOS = {
  callback: "callback number",
  callee: "callee number",
  status: "call status",
  inicio: "start time",
  duracao: "call duration",
} as const;

export function normalizarTelefone(texto: string): string {
  return somenteDigitos(texto);
}

/**
 * Converte Call Duration em segundos. TODO(confirmar) formato real (P6): aceita "SS", "MM:SS", "HH:MM:SS" e "D dia(s) HH:MM:SS"?
 * (somente os três primeiros). Qualquer outra coisa → null (não inventa).
 */
export function parseDuracao(texto: string): number | null {
  const t = texto.trim();
  if (/^\d+$/.test(t)) return Number(t);
  const m = /^(?:(\d+):)?(\d{1,2}):(\d{2})$/.exec(t);
  if (!m) return null;
  return Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

export type ResultadoParse =
  | {
      ok: true;
      rows: CallRow[];
      ignoradas: number;
      callbacksIncompletos: string[];
      stage3Parciais: Array<{ calleeNumber: string; agent: boolean; stage: number }>;
      /**
       * Linhas ignoradas que NÃO se explicam por algo normal (linha-aviso de tabela vazia, ou Stage 2/3/4 com Callee e Status
       * legíveis mas sem outro dado): são as que podem indicar mudança de layout.
       */
      ignoradasInexplicadas: number;
      /** Contagem por motivo, sem dados de cliente (ex.: `sem_start_time: 2`), só para a mensagem de aviso e o log. */
      motivosIgnoradas: Record<string, number>;
    }
  | { ok: false; motivo: string };

/** Converte a tabela bruta em linhas tipadas. Linha incompleta → leitura inválida (nunca "adivinha"). */
export function tabelaParaLinhas(t: TabelaBruta): ResultadoParse {
  const cab = t.cabecalhos.map(normalizarCabecalho);
  const idx = (n: string): number => cab.indexOf(n);
  const iCb = idx(CABECALHOS.callback);
  const iCe = idx(CABECALHOS.callee);
  const iSt = idx(CABECALHOS.status);
  const iIn = idx(CABECALHOS.inicio);
  const iDu = idx(CABECALHOS.duracao);
  const faltando = [
    [iCb, CABECALHOS.callback],
    [iCe, CABECALHOS.callee],
    [iSt, CABECALHOS.status],
    [iIn, CABECALHOS.inicio],
  ].filter(([i]) => i === -1);
  if (faltando.length)
    return {
      ok: false,
      motivo: `cabecalho_ausente:${faltando.map(([, n]) => String(n)).join(",")}`,
    };

  // Evidência (recon 2026-10-16): o cabeçalho tem uma coluna a mais no final (resumo "Manual Call: N Stage 1: N ...")
  // que as linhas de dados não têm; o alinhamento é por posição do cabeçalho.
  // Regra do usuário (2026-10-16): falta de dado numa linha é NORMAL. A linha problemática é simplesmente ignorada,
  // sem invalidar a leitura nem parar o sistema. Só falta de CABEÇALHO obrigatório invalida a leitura.
  // Uma linha só é usada se tiver Callback, Callee, Status e Start Time; Call Duration é opcional.
  const necessarias = Math.max(iCb, iCe, iSt, iIn, iDu) + 1;
  const rows: CallRow[] = [];
  const incompletos = new Set<string>();
  const stage3Parciais: Array<{ calleeNumber: string; agent: boolean; stage: number }> = [];
  let ignoradas = 0;
  let inexplicadas = 0;
  const motivos: Record<string, number> = {};
  const contar = (motivo: string, explicada: boolean): void => {
    ignoradas++;
    if (!explicada) inexplicadas++;
    motivos[motivo] = (motivos[motivo] ?? 0) + 1;
  };
  for (const l of t.linhas) {
    // mais células que cabeçalhos: colunas podem estar deslocadas, nunca adivinhar
    if (l.celulas.length > cab.length || l.celulas.length < necessarias) {
      // Uma linha de UMA célula é a mensagem de tabela vazia ("nenhum registro"): normal quando não há ligações.
      contar(
        l.celulas.length > cab.length
          ? "colunas_a_mais"
          : l.celulas.length <= 1
            ? "tabela_vazia"
            : "colunas_a_menos",
        l.celulas.length <= 1,
      );
      continue;
    }
    const c = (i: number): string => l.celulas[i]?.texto ?? "";
    const callback = normalizarTelefone(c(iCb));
    const callee = normalizarTelefone(c(iCe));
    const status = c(iSt).trim();
    const inicio = c(iIn).trim();
    if (!callback || !callee || !status || !inicio) {
      const m = /^stage\s*([234])\b/i.exec(status);
      const falta = [
        [!callback, "sem_callback"],
        [!callee, "sem_callee"],
        [!status, "sem_status"],
        [!inicio, "sem_start_time"],
      ]
        .filter(([f]) => f)
        .map(([, n]) => n)
        .join("+");
      // Stage 2/3/4 com Callee e Status legíveis: o layout está certo, só falta um dado (normal; ver `stage3Parciais`).
      contar(`${m ? `stage${m[1]}_` : ""}${falta}`, !!callee && !!m);
      if (callback) incompletos.add(callback);
      // Stage 2/3/4 com dado faltando mas Callee e Status legíveis: ainda prova que a ligação está naquele Stage
      // (o rastreador usa o Stage de destino da transferência, que é configurável).
      if (callee && m)
        stage3Parciais.push({
          calleeNumber: callee,
          agent: /\bagent\b/i.test(status),
          stage: Number(m[1]),
        });
      continue;
    }
    rows.push({
      callbackNumber: callback,
      calleeNumber: callee,
      callStatus: status,
      startTime: inicio,
      callDurationSec: iDu === -1 ? null : parseDuracao(c(iDu)),
    });
  }
  return {
    ok: true,
    rows,
    ignoradas,
    callbacksIncompletos: [...incompletos],
    stage3Parciais,
    ignoradasInexplicadas: inexplicadas,
    motivosIgnoradas: motivos,
  };
}

export interface OpcoesLeitor {
  /** Leituras seguidas sem achar a tabela até concluir que a sessão expirou/a página mudou. */
  tolerarSemTabela: number;
  agora?: () => number;
}

/** Leitor atômico (um único `page.evaluate`) que localiza a tabela pelos cabeçalhos informados. */
export class LeitorTabelaHtml implements TableReader {
  private semTabela = 0;

  constructor(
    private readonly page: Page,
    private readonly op: OpcoesLeitor = { tolerarSemTabela: 5 },
  ) {}

  /** `true` se a página mostra a tabela de chamadas (usado como sinal de "logado" até haver evidência do login). */
  async tabelaPresente(): Promise<boolean> {
    try {
      return (await this.localizar()) !== null;
    } catch {
      return false;
    }
  }

  /** `true` depois que a tabela só foi achada pelas heurísticas (grade de div / Shadow DOM): passa a usá-las direto. */
  private usarHeuristicas = false;

  /** Procura a tabela em todos os frames da aba. Primeiro só `<table>`/ARIA (barato); se falhar, tenta as heurísticas. */
  private async localizar(): Promise<TabelaBruta | null> {
    const modos = this.usarHeuristicas ? [true] : [false, true];
    for (const heuristicas of modos) {
      for (const frame of this.page.frames()) {
        let bruta;
        try {
          bruta = await frame.evaluate(extrairNoNavegador, {
            maxLinhas: 5000,
            indice: null,
            heuristicas,
            cabecalhosConhecidos: Object.values(CABECALHOS),
          });
        } catch {
          continue; // frame navegando/fechado
        }
        const alvo = bruta.tabelas.find((t) => {
          const cab = t.cabecalhos.map(normalizarCabecalho);
          return cab.includes(CABECALHOS.callback) && cab.includes(CABECALHOS.status);
        });
        if (alvo) {
          this.usarHeuristicas = heuristicas;
          return alvo;
        }
      }
    }
    return null;
  }

  async read(): Promise<TableSnapshot> {
    const readAt = (this.op.agora ?? Date.now)();
    let tabela: TabelaBruta | null;
    try {
      tabela = await this.localizar();
    } catch {
      // página navegando/recarregando durante a leitura
      return { readAt, rows: [], valid: false, invalidReason: "pagina_indisponivel" };
    }
    if (!tabela) {
      this.semTabela++;
      if (this.semTabela >= this.op.tolerarSemTabela) {
        this.semTabela = 0;
        throw new SessaoExpiradaError("Tabela de chamadas não encontrada na página.");
      }
      return { readAt, rows: [], valid: false, invalidReason: "tabela_nao_encontrada" };
    }
    this.semTabela = 0;
    const r = tabelaParaLinhas(tabela);
    if (!r.ok) return { readAt, rows: [], valid: false, invalidReason: r.motivo };
    return {
      readAt,
      rows: r.rows,
      valid: true,
      ...(r.ignoradas > 0
        ? {
            rowsIgnored: r.ignoradas,
            rowsIgnoredUnexplained: r.ignoradasInexplicadas,
            rowsIgnoredReasons: Object.entries(r.motivosIgnoradas)
              .map(([m, n]) => `${m} x${n}`)
              .join(", "),
          }
        : {}),
      ...(r.callbacksIncompletos.length ? { incompleteCallbacks: r.callbacksIncompletos } : {}),
      ...(r.stage3Parciais.length ? { stage3Parciais: r.stage3Parciais } : {}),
    };
  }
}
