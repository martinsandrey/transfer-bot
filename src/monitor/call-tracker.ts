import { createHash } from "node:crypto";
import { mascararTelefone } from "../util/mascara.js";
import type { CallRow, TableSnapshot } from "../dominio/tipos.js";

export type Stage = "stage1" | "stage2" | "stage3" | "desconhecido";

/** Interpreta o texto de Call Status. TODO(confirmar): lista completa de status (P4); por ora só os 3 informados. */
export function interpretarStatus(texto: string): Stage {
  switch (texto.trim().replace(/\s+/g, " ").toLowerCase()) {
    case "stage 1 agent":
      return "stage1";
    case "stage 2 agent":
      return "stage2";
    case "stage 3 agent":
      return "stage3";
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
  confirmado: Stage;
  candidato: { stage: Stage; contagem: number } | null;
  baseline: boolean;
  ausencias: number;
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
      const stage = interpretarStatus(row.callStatus);
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
          confirmado: stage,
          candidato: null,
          baseline,
          ausencias: 0,
        };
        this.ativas.set(cb, oc);
        if (!baseline) {
          if (stage === "stage3") eventos.push(this.aviso("visto_primeira_vez_stage3", oc));
          else if (stage === "desconhecido") eventos.push(this.aviso("status_desconhecido", oc));
        }
        continue;
      }

      oc.ausencias = 0;
      if (cega) {
        oc.candidato = null;
      }
      if (stage === oc.confirmado) {
        oc.candidato = null;
        continue;
      }
      if (oc.candidato && oc.candidato.stage === stage) oc.candidato.contagem++;
      else oc.candidato = { stage, contagem: 1 };
      if (oc.candidato.contagem < this.op.leiturasConfirmacao) continue;

      const de = oc.confirmado;
      oc.confirmado = stage;
      oc.candidato = null;
      this.aplicarTransicao(oc, de, stage, row, s.readAt, eventos);
    }

    // 3) ausências (não valem em linha de base nem em janela sem leitura, nem para callbacks congelados)
    if (!baseline && !cega) {
      for (const [cb, oc] of this.ativas) {
        if (porCallback.has(cb)) continue;
        oc.ausencias++;
        if (oc.ausencias > this.op.ausenciaMaxLeituras) this.ativas.delete(cb);
      }
    }
    return eventos;
  }

  private aplicarTransicao(
    oc: Ocorrencia,
    de: Stage,
    para: Stage,
    row: CallRow,
    agora: number,
    eventos: EventoTracker[],
  ): void {
    if (de === "stage1" && para === "stage2") return; // não é do interesse
    if (de === "stage1" && para === "stage3") {
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
      return;
    }
    eventos.push(
      this.aviso(para === "desconhecido" ? "status_desconhecido" : "sequencia_inesperada", oc),
    );
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
