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

/**
 * Status de Stage 1 de onde uma transferência pode sair: "Stage 1 Agent" (evidência do recon) e "Stage 1 Manual Call" (ligação
 * feita à mão pelo funcionário; evidência do usuário em 2026-10-20: uma ligação manual transferida ao Stage 3 não gerou mensagem
 * porque só o Agent era aceito como origem). "Stage 1 Ringing" continua não sendo origem.
 */
export function ehOrigemDeTransferencia(s: Pick<StatusInterpretado, "numero" | "sub">): boolean {
  return s.numero === 1 && (s.sub === "agent" || s.sub === "manual call");
}

/** Antepenúltimo dígito do número do funcionário (ex.: 908213 → "2"): diz em que linha ele trabalha. `""` se tiver menos de 3 dígitos. */
export function digitoDaLinha(callback: string): string {
  const d = callback.replace(/\D+/g, "");
  return d.length >= 3 ? d.charAt(d.length - 3) : "";
}

export type CodigoAviso =
  | "visto_primeira_vez_stage3"
  | "destino_fora_da_linha"
  | "sequencia_inesperada"
  | "status_desconhecido"
  | "transferencia_duplicada";

export type EventoTracker =
  | {
      tipo: "transferencia";
      ocorrencia: string;
      chave: string;
      callback: string;
      callee: string;
      /** Identifica a ligação de origem (Stage 1); igual ao `vinculo` da `ligacao_longa` da MESMA ligação. Só em memória (tem telefone). */
      vinculo: string;
      /** `ringing`: o Stage 3 ainda está tocando (ninguém atendeu ainda); `agent`: já foi atendido. */
      fase: "ringing" | "agent";
    }
  /** O Stage 3 tocou e a ligação sumiu sem ninguém atender (Stage 3 Agent nunca apareceu para o mesmo Callee). */
  | {
      tipo: "callback";
      ocorrencia: string;
      chave: string;
      callback: string;
      callee: string;
      vinculo: string;
      /** `sem_atendimento`: tocou e sumiu sem ninguém atender; `ligacao_curta`: foi atendida, mas durou menos que o mínimo. */
      motivo: "sem_atendimento" | "ligacao_curta";
      /** Duração (s) da ligação do Stage 3 quando `ligacao_curta`. */
      duracaoSeg?: number;
    }
  /** Ligação que atingiu o tempo mínimo (ex.: 5 min) AINDA em Stage 1 (nunca depois de transferida). */
  | {
      tipo: "ligacao_longa";
      ocorrencia: string;
      chave: string;
      callback: string;
      callee: string;
      vinculo: string;
    }
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
  /** Quanto tempo (ms) sem nenhuma linha de Stage 3 do mesmo Callee, depois de ter tocado sem atender, antes de emitir `callback` (padrão 3000). */
  esperaCallbackMs?: number;
  /**
   * Uma ligação atendida no Stage 3 que dure MENOS que isto (segundos) também conta como CALLBACK. A duração é a do "Call Duration"
   * da linha do Stage 3 (maior valor visto antes de ela sumir); se a coluna não for legível, conta-se desde que o Stage 3 Agent
   * apareceu. Ausente/0 = só conta CALLBACK quando ninguém atendeu.
   */
  duracaoCallbackSeg?: number;
  /** Duração (segundos) que uma ligação em Stage 1 precisa atingir para gerar `ligacao_longa`. Ausente/0 = desligado. */
  duracaoLongaSeg?: number;
  /** Diário de status (só para diagnóstico, sem telefones): chamado quando uma ocorrência surge, muda de status confirmado ou some. */
  aoMudarStatus?: (info: { id: string; de: string; para: string }) => void;
  /**
   * Chamado uma vez quando uma ligação transferida que FOI ATENDIDA no Stage 3 termina (a linha some da tabela) e NÃO é CALLBACK
   * por duração curta: `duracaoSeg` é o maior "Call Duration" visto (ou o tempo contado desde o atendimento, se a coluna for
   * ilegível). Alimenta a duração média do relatório. `vinculo` tem telefone: não pode ir para o log.
   */
  aoEncerrarLigacao?: (info: {
    vinculo: string;
    callback: string;
    callee: string;
    duracaoSeg: number;
    /** Duração (s) que a ligação já tinha quando foi transferida para o Stage 3; `null` se a coluna não estava legível. */
    ateTransferenciaSeg: number | null;
  }) => void;
  /**
   * Evidência real (2026-10-16): na transferência a linha do Stage 1 SOME e aparece OUTRA linha em "Stage 3 Agent", com outro
   * Callback Number (o do agente do Stage 3) e o MESMO Callee Number. A transferência é detectada ligando as duas pelo Callee.
   * Esta é a janela máxima entre a última vez que a linha do Stage 1 Agent foi vista e o surgimento da linha do Stage 3 (padrão 60 s).
   */
  janelaTransferenciaMs?: number;
  /**
   * Stage para onde a transferência vai (padrão 3 = fluxo antigo, Stage 1 → Stage 3). Pedido do usuário (2026-10-21): o fluxo
   * passou a ser linha 1 → linha 2 → linha 3 e a transferência que interessa é a 1 → 2 (a linha 3 é ignorada); `main.ts` passa 2.
   * Nos comentários deste arquivo, "Stage 3" = este Stage de destino.
   */
  destinoStage?: number;
  /**
   * Antepenúltimo dígito exigido no número do funcionário da linha NOVA de destino (ex.: "2" = funcionários ***2**).
   * Ausente = não confere. A mesma linha mudando de Stage 1 para o destino conta sem conferir (pedido do usuário).
   */
  destinoDigito?: string;
}

/** Última linha "Stage 1 Agent" vista para um Callee Number: é de onde sai o "Line 1 number" da transferência. */
interface OrigemStage1 {
  callback: string;
  discriminador: string;
  ocId: string;
  ultimaVez: number;
  /** Último "Call Duration" (s) lido nesta linha de origem: quanto a ligação já tinha de duração quando foi transferida. */
  duracaoSeg: number | null;
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
  callee: string;
  /** Linha nova em Stage 3 ligada (pelo Callee) a uma linha de Stage 1 Agent: aguarda N leituras para virar transferência. */
  origemPendente: OrigemStage1 | null;
  /** Último "Call Duration" (s) visto enquanto a linha estava num status de origem (Stage 1 Agent / Manual Call). */
  duracaoOrigemSeg: number | null;
  /** Leituras seguidas com o status confirmado atual. */
  leiturasNoStatus: number;
  /** `ligacao_longa` já emitida (ou ocorrência que já nasceu longa na linha de base: não conta). */
  longaEmitida: boolean;
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
  /** Callee Number → última linha "Stage 1 Agent" vista (origem provável de uma transferência). */
  private readonly origens = new Map<string, OrigemStage1>();
  /** Callee Number → instante em que já vimos uma chamada em Stage 3 (evita avisos repetidos para a mesma chamada). */
  private readonly stage3Conhecidos = new Map<string, number>();
  /** Stage 3 já transferidos (por Callee) cujo atendimento está sendo acompanhado. */
  private readonly seguimentos = new Map<
    string,
    {
      vinculo: string;
      callback: string;
      ocId: string;
      atendida: boolean;
      ultimoStage3: number;
      /** Instante (ms) em que o Stage 3 Agent apareceu pela primeira vez. */
      inicioAtendimento: number | null;
      /** Maior "Call Duration" (s) visto nas linhas de Stage 3/4 desse Callee. */
      maiorDuracaoSeg: number | null;
      /** "Call Duration" (s) que a ligação já tinha no Stage 1 quando foi transferida (última leitura da linha de origem). */
      duracaoAteTransferenciaSeg: number | null;
      /** Fluxo novo: a ligação já apareceu na linha 3 (seguiu adiante depois da linha 2). */
      foiAdiante?: boolean;
    }
  >();
  private anomaliasAtivas = new Set<string>();
  private precisaBaseline = true;
  private janelaCega = false;
  private sequencia = 0;
  private readonly discriminador: (r: CallRow) => string;
  /** Stage de destino da transferência (ver `OpcoesTracker.destinoStage`). */
  private readonly destino: number;

  constructor(private readonly op: OpcoesTracker) {
    this.discriminador = op.discriminador ?? discriminadorPadrao;
    this.destino = op.destinoStage ?? 3;
  }

  /** No fluxo novo (destino 2), o Stage seguinte (3) é a linha 3: ignorada por completo (pedido do usuário). */
  private ehLinhaSeguinte(numero: number | null): boolean {
    return this.destino === 2 && numero === 3;
  }

  /** Esquece as ocorrências ativas e exige nova linha de base (ex.: após sessão expirada). */
  reiniciarBaseline(): void {
    this.ativas.clear();
    this.origens.clear();
    this.stage3Conhecidos.clear();
    this.seguimentos.clear();
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
    for (const [k, t] of this.stage3Conhecidos)
      if (agora - t > this.op.ttlOcorrenciasMs) this.stage3Conhecidos.delete(k);
    for (const [k, o] of this.origens)
      if (agora - o.ultimaVez > this.op.ttlOcorrenciasMs) this.origens.delete(k);
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
    // Voltamos de uma janela sem leitura (ex.: consulta ao cadastro): o tempo parado não pode esgotar a janela de transferência.
    if (cega && !baseline) for (const o of this.origens.values()) o.ultimaVez = s.readAt;

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
          viuStage1Agent: ehOrigemDeTransferencia(status),
          callee: row.calleeNumber,
          duracaoOrigemSeg: ehOrigemDeTransferencia(status) ? row.callDurationSec : null,
          origemPendente: null,
          leiturasNoStatus: 1,
          longaEmitida: baseline && this.longa(row.callDurationSec),
        };
        this.ativas.set(cb, oc);
        this.op.aoMudarStatus?.({ id: oc.id, de: "(novo)", para: status.chave });
        this.aoSurgir(oc, status, s.readAt, baseline, eventos);
        if (!baseline) this.aposLeitura(oc, row, s.readAt, eventos);
        continue;
      }
      oc.callee = row.calleeNumber;
      if (ehOrigemDeTransferencia(status) && row.callDurationSec !== null)
        oc.duracaoOrigemSeg = row.callDurationSec;

      oc.ausencias = 0;
      if (cega) {
        oc.candidato = null;
      }
      if (status.chave === oc.confirmado.chave) {
        oc.candidato = null;
        oc.leiturasNoStatus++;
        this.aposLeitura(oc, row, s.readAt, eventos);
        continue;
      }
      if (oc.candidato && oc.candidato.status.chave === status.chave) oc.candidato.contagem++;
      else oc.candidato = { status, contagem: 1 };
      if (oc.candidato.contagem < this.op.leiturasConfirmacao) continue;

      const de = oc.confirmado;
      oc.confirmado = status;
      oc.candidato = null;
      oc.leiturasNoStatus = this.op.leiturasConfirmacao;
      if (ehOrigemDeTransferencia(status)) oc.viuStage1Agent = true;
      this.op.aoMudarStatus?.({ id: oc.id, de: de.chave, para: status.chave });
      this.aplicarTransicao(oc, de, status, row, s.readAt, eventos);
      this.aposLeitura(oc, row, s.readAt, eventos);
    }

    // 3) ausências (não valem em linha de base nem em janela sem leitura, nem para chamadas cuja linha veio incompleta)
    const incompletos = new Set(s.incompleteCallbacks ?? []);
    if (!baseline && !cega) {
      for (const [cb, oc] of this.ativas) {
        if (porCallback.has(cb) || incompletos.has(cb)) continue;
        oc.ausencias++;
        if (oc.ausencias > this.op.ausenciaMaxLeituras) {
          this.op.aoMudarStatus?.({ id: oc.id, de: oc.confirmado.chave, para: "(sumiu)" });
          this.ativas.delete(cb);
        }
      }
    }
    if (!baseline) this.acompanharAtendimento(s, cega, eventos);
    return eventos;
  }

  /** Primeira vez que esta ocorrência é vista (nova linha, ou nova ligação do mesmo Callback Number). */
  private aoSurgir(
    oc: Ocorrencia,
    status: StatusInterpretado,
    agora: number,
    baseline: boolean,
    eventos: EventoTracker[],
  ): void {
    if (ehOrigemDeTransferencia(status)) this.registrarOrigem(oc, agora);
    if (baseline) {
      if (status.numero === this.destino) this.stage3Conhecidos.set(oc.callee, agora);
      return;
    }
    if (status.numero === null) {
      eventos.push(this.aviso("status_desconhecido", oc));
      return;
    }
    if (status.numero !== this.destino) return;
    // Linha nova em Stage 3: é a transferência de uma chamada que estava em "Stage 1 Agent" com o mesmo Callee?
    if (this.stage3Conhecidos.has(oc.callee)) {
      this.stage3Conhecidos.set(oc.callee, agora); // já tratada: não repete aviso
      return;
    }
    const origem = this.origens.get(oc.callee);
    const janela = this.op.janelaTransferenciaMs ?? 60_000;
    if (
      origem &&
      agora - origem.ultimaVez <= janela &&
      !this.emitidas.has(`${origem.callback}|${origem.discriminador}`)
    ) {
      const exigido = this.op.destinoDigito;
      if (exigido !== undefined && digitoDaLinha(oc.callback) !== exigido) {
        // veio do Stage 1, mas o funcionário que pegou não é da linha esperada: não é a transferência que interessa
        this.stage3Conhecidos.set(oc.callee, agora);
        eventos.push(this.aviso("destino_fora_da_linha", oc));
        return;
      }
      oc.origemPendente = origem;
      return; // sai em aposLeitura, depois de N leituras em "Stage 3 Agent"
    }
    this.stage3Conhecidos.set(oc.callee, agora);
    eventos.push(this.aviso("visto_primeira_vez_stage3", oc));
  }

  private registrarOrigem(oc: Ocorrencia, agora: number): void {
    this.origens.set(oc.callee, {
      callback: oc.callback,
      discriminador: oc.discriminador,
      ocId: oc.id,
      ultimaVez: agora,
      duracaoSeg: oc.duracaoOrigemSeg,
    });
  }

  /** Mantém origens/Stage 3 conhecidos atualizados e confirma a transferência por Callee depois de N leituras. */
  private longa(duracaoSeg: number | null | undefined): boolean {
    const limite = this.op.duracaoLongaSeg ?? 0;
    return limite > 0 && duracaoSeg != null && Number.isFinite(duracaoSeg) && duracaoSeg >= limite;
  }

  private aposLeitura(oc: Ocorrencia, row: CallRow, agora: number, eventos: EventoTracker[]): void {
    const st = oc.confirmado;
    if (!oc.longaEmitida && st.numero === 1 && this.longa(row.callDurationSec)) {
      oc.longaEmitida = true;
      const chave = `L|${oc.callback}|${oc.discriminador}`;
      if (!this.emitidas.has(chave)) {
        this.emitidas.set(chave, agora);
        eventos.push({
          tipo: "ligacao_longa",
          ocorrencia: oc.id,
          chave: createHash("sha256").update(chave).digest("hex").slice(0, 12),
          callback: oc.callback,
          callee: row.calleeNumber,
          vinculo: `${oc.callback}|${oc.discriminador}`,
        });
      }
    }
    if (ehOrigemDeTransferencia(st)) this.registrarOrigem(oc, agora);
    if (st.numero === this.destino && !oc.origemPendente)
      this.stage3Conhecidos.set(oc.callee, agora);
    if (
      oc.origemPendente &&
      st.numero === this.destino &&
      oc.leiturasNoStatus >= this.op.leiturasConfirmacao
    ) {
      // O Stage 3 já está tocando (Ringing) ou atendido (Agent): a mensagem de transferência sai agora.
      const o = oc.origemPendente;
      oc.origemPendente = null;
      this.stage3Conhecidos.set(oc.callee, agora);
      this.emitirTransferencia(
        o.callback,
        o.discriminador,
        o.ocId,
        row.calleeNumber,
        oc,
        agora,
        eventos,
        st.sub === "agent" ? "agent" : "ringing",
        o.duracaoSeg,
      );
    }
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
      if (para.numero === this.destino) eventos.push(this.aviso("sequencia_inesperada", oc));
      return;
    }
    if (de.numero === para.numero) return; // Ringing → Agent etc.: normal
    if (de.numero === 4 || para.numero === 4) return; // Stage 4: o usuário pediu para não fazer nada (sem tarefa, sem aviso)
    if (this.ehLinhaSeguinte(de.numero) || this.ehLinhaSeguinte(para.numero)) return; // linha 3 (fluxo novo): ignorada
    if (this.destino === 3 && de.numero === 1 && para.numero === 2) return; // fluxo antigo: não é do interesse
    if (de.numero === 1 && para.numero === this.destino) {
      if (!(ehOrigemDeTransferencia(de) || oc.viuStage1Agent)) {
        eventos.push(this.aviso("sequencia_inesperada", oc)); // nunca foi "Stage 1 Agent"
        return;
      }
      this.emitirTransferencia(
        oc.callback,
        oc.discriminador,
        oc.id,
        row.calleeNumber,
        oc,
        agora,
        eventos,
        para.sub === "agent" ? "agent" : "ringing",
        oc.duracaoOrigemSeg,
      );
      return;
    }
    eventos.push(this.aviso("sequencia_inesperada", oc));
  }

  private emitirTransferencia(
    callbackOrigem: string,
    discriminadorOrigem: string,
    ocId: string,
    callee: string,
    ocAviso: Ocorrencia,
    agora: number,
    eventos: EventoTracker[],
    fase: "ringing" | "agent",
    duracaoOrigemSeg: number | null,
  ): void {
    const chave = `${callbackOrigem}|${discriminadorOrigem}`;
    if (this.emitidas.has(chave)) {
      eventos.push(this.aviso("transferencia_duplicada", ocAviso));
      return;
    }
    this.emitidas.set(chave, agora);
    // `chave` é um resumo (sem telefone) para logs e idempotência do envio.
    const resumo = createHash("sha256").update(chave).digest("hex").slice(0, 12);
    eventos.push({
      tipo: "transferencia",
      ocorrencia: ocId,
      chave: resumo,
      callback: callbackOrigem,
      callee,
      vinculo: chave,
      fase,
    });
    // A partir daqui acompanha se alguém atende esse Stage 3 (senão, sai o CALLBACK).
    this.seguimentos.set(callee, {
      vinculo: chave,
      callback: callbackOrigem,
      ocId,
      atendida: fase === "agent",
      ultimoStage3: agora,
      inicioAtendimento: fase === "agent" ? agora : null,
      maiorDuracaoSeg: null,
      duracaoAteTransferenciaSeg: duracaoOrigemSeg,
    });
  }

  /** Atualiza o acompanhamento dos Stage 3 já transferidos e emite `callback` quando tocou e sumiu sem atender. */
  private acompanharAtendimento(s: TableSnapshot, cega: boolean, eventos: EventoTracker[]): void {
    if (this.seguimentos.size === 0) return;
    const comStage3 = new Set<string>();
    const comAgent = new Set<string>();
    /**
     * Callees que continuam na tabela em QUALQUER status (ex.: Stage 3 → Stage 4 não é fim de ligação). No fluxo novo, a linha 3
     * não conta: passar para ela encerra a parte da linha 2.
     */
    const naTabela = new Set<string>();
    /** Fluxo novo: callees que já estão na linha 3 (a ligação seguiu adiante depois da linha 2). */
    const adiante = new Set<string>();
    const duracoes = new Map<string, number>();
    const contaDuracao = (n: number | null): boolean =>
      n === this.destino || (this.destino === 3 && n === 4);
    for (const r of s.rows) {
      const st = interpretarStatusDetalhado(r.callStatus);
      if (this.ehLinhaSeguinte(st.numero)) {
        adiante.add(r.calleeNumber);
        continue;
      }
      naTabela.add(r.calleeNumber);
      if (contaDuracao(st.numero) && r.callDurationSec !== null)
        duracoes.set(
          r.calleeNumber,
          Math.max(duracoes.get(r.calleeNumber) ?? 0, r.callDurationSec),
        );
      if (st.numero !== this.destino) continue;
      comStage3.add(r.calleeNumber);
      if (st.sub === "agent") comAgent.add(r.calleeNumber);
    }
    // Linhas de Stage 3 incompletas (dado faltando) também provam que o Stage 3 continua na tabela.
    for (const p of s.stage3Parciais ?? []) {
      const n = p.stage ?? 3;
      if (this.ehLinhaSeguinte(n)) {
        adiante.add(p.calleeNumber);
        continue;
      }
      naTabela.add(p.calleeNumber);
      if (n !== this.destino) continue;
      comStage3.add(p.calleeNumber);
      if (p.agent) comAgent.add(p.calleeNumber);
    }
    const espera = this.op.esperaCallbackMs ?? 3000;
    const minimoSeg = this.op.duracaoCallbackSeg ?? 0;
    for (const [callee, sg] of this.seguimentos) {
      if (comAgent.has(callee)) {
        sg.atendida = true;
        sg.inicioAtendimento ??= s.readAt;
      }
      if (comStage3.has(callee) || cega) sg.ultimoStage3 = s.readAt;
      if (adiante.has(callee)) sg.foiAdiante = true;
      const d = duracoes.get(callee);
      if (d !== undefined && d > (sg.maiorDuracaoSeg ?? 0)) sg.maiorDuracaoSeg = d;
      if (sg.atendida) {
        const sumiu = !naTabela.has(callee) && !cega;
        if (sumiu && s.readAt - sg.ultimoStage3 >= espera) {
          // Atendida e a linha sumiu: se durou menos que o mínimo, conta como CALLBACK; senão registra a duração (relatório).
          const duracao =
            sg.maiorDuracaoSeg ??
            (sg.inicioAtendimento === null
              ? null
              : Math.round((sg.ultimoStage3 - sg.inicioAtendimento) / 1000));
          this.seguimentos.delete(callee);
          // Passou para a linha 3: a ligação seguiu em frente, nunca é CALLBACK por ser curta (pedido do usuário).
          if (!sg.foiAdiante && minimoSeg > 0 && duracao !== null && duracao < minimoSeg)
            this.emitirCallback(sg, callee, "ligacao_curta", duracao, s.readAt, eventos);
          else if (duracao !== null)
            this.op.aoEncerrarLigacao?.({
              vinculo: sg.vinculo,
              callback: sg.callback,
              callee,
              duracaoSeg: duracao,
              ateTransferenciaSeg: sg.duracaoAteTransferenciaSeg,
            });
          continue;
        }
        // atendida e sem regra de duração: nada mais a fazer; esquece quando a linha some
        if (!comStage3.has(callee) && s.readAt - sg.ultimoStage3 > 60_000)
          this.seguimentos.delete(callee);
        continue;
      }
      if (!comStage3.has(callee) && s.readAt - sg.ultimoStage3 >= espera) {
        this.seguimentos.delete(callee);
        // Não vimos o atendimento na linha 2, mas a ligação chegou à linha 3 (só chega lá passando pela 2): não é CALLBACK.
        if (sg.foiAdiante) continue;
        this.emitirCallback(sg, callee, "sem_atendimento", undefined, s.readAt, eventos);
      }
    }
  }

  private emitirCallback(
    sg: { vinculo: string; callback: string; ocId: string },
    callee: string,
    motivo: "sem_atendimento" | "ligacao_curta",
    duracaoSeg: number | undefined,
    agora: number,
    eventos: EventoTracker[],
  ): void {
    const chave = `C|${sg.vinculo}`;
    if (this.emitidas.has(chave)) return;
    this.emitidas.set(chave, agora);
    eventos.push({
      tipo: "callback",
      ocorrencia: sg.ocId,
      chave: createHash("sha256").update(chave).digest("hex").slice(0, 12),
      callback: sg.callback,
      callee,
      vinculo: sg.vinculo,
      motivo,
      ...(duracaoSeg !== undefined ? { duracaoSeg } : {}),
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
