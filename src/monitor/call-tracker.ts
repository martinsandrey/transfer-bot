import { createHash } from "node:crypto";
import { mascararTelefone } from "../util/mascara.js";
import type { CallRow, TableSnapshot } from "../dominio/tipos.js";

export type Stage = "stage1" | "stage2" | "stage3" | "stage4" | "desconhecido";

export interface StatusInterpretado {
  /** Número do Stage (1, 2, 3, 4...) ou `null` se o texto não segue o padrão "Stage N ...". */
  numero: number | null;
  /** Complemento em minúsculas: "agent", "ringing", "manual call"... (evidência do recon, 2026-10-16). */
  sub: string;
  /** Chave de comparação entre leituras. */
  chave: string;
}

/**
 * Interpreta o texto de Call Status. Evidência do recon: "Stage 1 Ringing", "Stage 1 Agent", "Stage 1 Manual Call",
 * "Stage 3 Agent"; os contadores do site mostram também Stage 2 e Stage 4. TODO(confirmar) (P4): significado de cada um.
 */
export function interpretarStatusDetalhado(texto: string): StatusInterpretado {
  const t = texto.trim().replace(/\s+/g, " ").toLowerCase();
  const m = /^stage (\d+)(?: (.*))?$/.exec(t);
  if (!m) return { numero: null, sub: t, chave: `?|${t}` };
  const numero = Number(m[1]);
  const sub = m[2] ?? "";
  return { numero, sub, chave: `${numero}|${sub}` };
}

/** Família do Stage (ignora o complemento). */
export function interpretarStatus(texto: string): Stage {
  switch (interpretarStatusDetalhado(texto).numero) {
    case 1:
      return "stage1";
    case 2:
      return "stage2";
    case 3:
      return "stage3";
    case 4:
      return "stage4";
    default:
      return "desconhecido";
  }
}

export type CodigoAviso =
  | "visto_primeira_vez_stage3"
  | "sequencia_inesperada"
  | "status_desconhecido"
  | "transferencia_duplicada";

export type EventoTracker =
  | { tipo: "transferencia"; ocorrencia: string; chave: string; callback: string; callee: string }
  | { tipo: "aviso"; codigo: CodigoAviso; ocorrencia: string; callbackMascarado: string }
  | { tipo: "anomalia"; codigo: "callback_duplicado"; callbackMascarado: string };

export interface OpcoesTracker {
  /** Leituras válidas consecutivas com o novo status antes de confirmá-lo (N). */
  leiturasConfirmacao: number;
  /** Leituras válidas consecutivas sem a linha antes de encerrar a ocorrência. */
  ausenciaMaxLeituras: number;
  /** Quanto tempo lembrar das transferências já emitidas (dedup em memória). */
  ttlOcorrenciasMs: number;
  /**
   * Discriminador de ligações sucessivas do mesmo Callback Number.
   * TODO(confirmar) (P5): padrão provisório = Start Time + Callee Number (texto cru); ajustar com a evidência do recon.
   */
  discriminador?: (row: CallRow) => string;
}

interface Ocorrencia {
  id: string;
  callback: string;
  discriminador: string;
  confirmado: StatusInterpretado;
  candidato: { status: StatusInterpretado; contagem: number } | null;
  baseline: boolean;
  ausencias: number;
  /** Já esteve (confirmada) em "Stage 1 Agent": pré-requisito para uma transferência. */
  viuStage1Agent: boolean;
  /** Passou de Stage 1 Agent para um Stage 3 que ainda não é "Agent" (ex.: Ringing): a transferência sai quando chegar a Agent. */
  aguardaStage3Agent: boolean;
}

export const discriminadorPadrao = (r: CallRow): string => `${r.startTime}|${r.calleeNumber}`;

/**
 * Lógica pura (sem navegador, sem relógio próprio): identifica ocorrências de chamada por
 * Callback Number + discriminador, aplica linha de base, confirmação de N leituras e detecta Stage 1 → Stage 3.
 * Estado só em memória.
 */
export class CallTracker {
  private readonly ativas = new Map<string, Ocorrencia>();
  /** chave (callback|discriminador) → instante em que a transferência foi emitida. */
  private readonly emitidas = new Map<string, number>();
  private anomaliasAtivas = new Set<string>();
  private precisaBaseline = true;
  private janelaCega = false;
  private sequencia = 0;
  private readonly discriminador: (r: CallRow) => string;

  constructor(private readonly op: OpcoesTracker) {
    this.discriminador = op.discriminador ?? discriminadorPadrao;
  }

  /** Esquece as ocorrências ativas e exige nova linha de base (ex.: após sessão expirada). */
  reiniciarBaseline(): void {
    this.ativas.clear();
    this.anomaliasAtivas = new Set();
    this.precisaBaseline = true;
  }

  /**
   * Houve um período sem leituras (ex.: consulta em aba única) mas as ocorrências continuam válidas:
   * a próxima leitura não conta ausências nem avança confirmações.
   */
  marcarJanelaSemLeitura(): void {
    this.janelaCega = true;
  }

  get ocorrenciasAtivas(): number {
    return this.ativas.size;
  }
  get transferenciasLembradas(): number {
    return this.emitidas.size;
  }

  /** Remove da memória as transferências emitidas há mais que o TTL. */
  sweep(agora: number): void {
    for (const [k, t] of this.emitidas)
      if (agora - t > this.op.ttlOcorrenciasMs) this.emitidas.delete(k);
  }

  ingest(s: TableSnapshot): EventoTracker[] {
    if (!s.valid) return [];
    const eventos: EventoTracker[] = [];

    // 1) agrupar por Callback Number; duplicados = anomalia (linhas ignoradas neste snapshot)
    const porCallback = new Map<string, CallRow[]>();
    for (const r of s.rows) {
      if (!r.callbackNumber) continue;
      const l = porCallback.get(r.callbackNumber);
      if (l) l.push(r);
      else porCallback.set(r.callbackNumber, [r]);
    }
    const congelados = new Set<string>();
    const anomaliasAgora = new Set<string>();
    for (const [cb, linhas] of porCallback) {
      if (linhas.length > 1) {
        congelados.add(cb);
        anomaliasAgora.add(cb);
        if (!this.anomaliasAtivas.has(cb)) {
          eventos.push({
            tipo: "anomalia",
            codigo: "callback_duplicado",
            callbackMascarado: mascararTelefone(cb),
          });
        }
      }
    }
    this.anomaliasAtivas = anomaliasAgora;

    const baseline = this.precisaBaseline;
    const cega = this.janelaCega;
    this.precisaBaseline = false;
    this.janelaCega = false;

    // 2) linhas presentes
    for (const [cb, linhas] of porCallback) {
      if (congelados.has(cb)) continue;
      const row = linhas[0] as CallRow;
      const disc = this.discriminador(row);
      const status = interpretarStatusDetalhado(row.callStatus);
      let oc = this.ativas.get(cb);

      if (oc && oc.discriminador !== disc) {
        this.ativas.delete(cb); // nova ligação do mesmo funcionário
        oc = undefined;
      }
      if (!oc) {
        oc = {
          id: `o${++this.sequencia}`,
          callback: cb,
          discriminador: disc,
          confirmado: status,
          candidato: null,
          baseline,
          ausencias: 0,
          viuStage1Agent: status.numero === 1 && status.sub === "agent",
          aguardaStage3Agent: false,
        };
        this.ativas.set(cb, oc);
        if (!baseline) {
          if (status.numero === 3) eventos.push(this.aviso("visto_primeira_vez_stage3", oc));
          else if (status.numero === null) eventos.push(this.aviso("status_desconhecido", oc));
        }
        continue;
      }

      oc.ausencias = 0;
      if (cega) {
        oc.candidato = null;
      }
      if (status.chave === oc.confirmado.chave) {
        oc.candidato = null;
        continue;
      }
      if (oc.candidato && oc.candidato.status.chave === status.chave) oc.candidato.contagem++;
      else oc.candidato = { status, contagem: 1 };
      if (oc.candidato.contagem < this.op.leiturasConfirmacao) continue;

      const de = oc.confirmado;
      oc.confirmado = status;
      oc.candidato = null;
      if (status.numero === 1 && status.sub === "agent") oc.viuStage1Agent = true;
      this.aplicarTransicao(oc, de, status, row, s.readAt, eventos);
    }

    // 3) ausências (não valem em linha de base nem em janela sem leitura, nem para chamadas cuja linha veio incompleta)
    const incompletos = new Set(s.incompleteCallbacks ?? []);
    if (!baseline && !cega) {
      for (const [cb, oc] of this.ativas) {
        if (porCallback.has(cb) || incompletos.has(cb)) continue;
        oc.ausencias++;
        if (oc.ausencias > this.op.ausenciaMaxLeituras) this.ativas.delete(cb);
      }
    }
    return eventos;
  }

  /**
   * Regras (usuário + evidência): só "Stage 1 Agent" → "Stage 3 Agent" é transferência. Mudanças de complemento dentro do
   * mesmo Stage (Ringing → Agent) são normais. Stage 1 → Stage 2 é ignorado. O resto é inesperado (aviso, sem tarefa).
   * Se o Stage 3 passar antes por outro complemento (ex.: "Stage 3 Ringing"), a transferência sai ao chegar em "Stage 3 Agent".
   */
  private aplicarTransicao(
    oc: Ocorrencia,
    de: StatusInterpretado,
    para: StatusInterpretado,
    row: CallRow,
    agora: number,
    eventos: EventoTracker[],
  ): void {
    if (para.numero === null) {
      eventos.push(this.aviso("status_desconhecido", oc));
      return;
    }
    if (de.numero === null) {
      // vindo de um status desconhecido (já avisado): só alerta se for direto para Stage 3
      if (para.numero === 3) eventos.push(this.aviso("sequencia_inesperada", oc));
      return;
    }
    if (de.numero === para.numero) {
      if (para.numero === 3 && para.sub === "agent" && oc.aguardaStage3Agent) {
        oc.aguardaStage3Agent = false;
        this.emitirTransferencia(oc, row, agora, eventos);
      }
      return; // Ringing → Agent etc.: normal
    }
    if (de.numero === 1 && para.numero === 2) return; // não é do interesse
    if (de.numero === 1 && para.numero === 3) {
      if (!(de.sub === "agent" || oc.viuStage1Agent)) {
        eventos.push(this.aviso("sequencia_inesperada", oc)); // nunca foi "Stage 1 Agent"
        return;
      }
      if (para.sub === "agent") this.emitirTransferencia(oc, row, agora, eventos);
      else oc.aguardaStage3Agent = true;
      return;
    }
    eventos.push(this.aviso("sequencia_inesperada", oc));
  }

  private emitirTransferencia(
    oc: Ocorrencia,
    row: CallRow,
    agora: number,
    eventos: EventoTracker[],
  ): void {
    const chave = `${oc.callback}|${oc.discriminador}`;
    if (this.emitidas.has(chave)) {
      eventos.push(this.aviso("transferencia_duplicada", oc));
      return;
    }
    this.emitidas.set(chave, agora);
    // `chave` é um resumo (sem telefone) para logs e idempotência do envio.
    const resumo = createHash("sha256").update(chave).digest("hex").slice(0, 12);
    eventos.push({
      tipo: "transferencia",
      ocorrencia: oc.id,
      chave: resumo,
      callback: oc.callback,
      callee: row.calleeNumber,
    });
  }

  private aviso(codigo: CodigoAviso, oc: Ocorrencia): EventoTracker {
    return {
      tipo: "aviso",
      codigo,
      ocorrencia: oc.id,
      callbackMascarado: mascararTelefone(oc.callback),
    };
  }
}
