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

export type ResultadoParse = { ok: true; rows: CallRow[] } | { ok: false; motivo: string };

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
  // que as linhas de dados não têm. Por isso o alinhamento é por posição do cabeçalho e aceitamos linhas com MENOS
  // células que cabeçalhos (desde que cubram as colunas necessárias). Linhas com MAIS células que cabeçalhos podem ter
  // colunas deslocadas: leitura inválida (nunca adivinha). Linhas curtas demais (ex.: mensagem de tabela vazia) são ignoradas.
  const necessarias = Math.max(iCb, iCe, iSt, iIn, iDu) + 1;
  const rows: CallRow[] = [];
  for (const l of t.linhas) {
    if (l.celulas.length > cab.length) {
      return {
        ok: false,
        motivo: `linha_com_mais_celulas_que_cabecalhos(cabecalhos=${cab.length},celulas=${l.celulas.length})`,
      };
    }
    if (l.celulas.length < necessarias) continue;
    const c = (i: number): string => l.celulas[i]?.texto ?? "";
    const callback = normalizarTelefone(c(iCb));
    const status = c(iSt).trim();
    if (!callback || !status) return { ok: false, motivo: "linha_incompleta" };
    rows.push({
      callbackNumber: callback,
      calleeNumber: normalizarTelefone(c(iCe)),
      callStatus: status,
      startTime: c(iIn).trim(),
      callDurationSec: iDu === -1 ? null : parseDuracao(c(iDu)),
    });
  }
  return { ok: true, rows };
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
    return r.ok
      ? { readAt, rows: r.rows, valid: true }
      : { readAt, rows: [], valid: false, invalidReason: r.motivo };
  }
}
