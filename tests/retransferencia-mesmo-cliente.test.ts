import { describe, expect, it } from "vitest";
import type { CallRow, TableSnapshot } from "../src/dominio/tipos.js";
import { CallTracker, type EventoTracker } from "../src/monitor/call-tracker.js";

/**
 * Caso real (log de 2026-10-23, ~09:52–09:54): a ligação do cliente foi transferida para a linha 2 e ninguém atendeu (CALLBACK);
 * o funcionário ligou de novo para o mesmo cliente ("Manual Call") e transferiu outra vez. A segunda transferência precisa
 * gerar mensagem, mesmo sendo o mesmo cliente (o mesmo Callee) de uma transferência de minutos antes.
 */
const X = "21900000101";
const L1 = "908113";
const L2 = "908213";
const row = (cb: string, status: string, dur: number, inicio: string, callee = X): CallRow => ({
  callbackNumber: cb,
  calleeNumber: callee,
  callStatus: status,
  startTime: inicio,
  callDurationSec: dur,
});
let t0 = 0;
const snap = (rows: CallRow[], passoMs = 1000): TableSnapshot => {
  t0 += passoMs;
  return { readAt: t0, rows, valid: true };
};

function novo() {
  const t = new CallTracker({
    leiturasConfirmacao: 1,
    ausenciaMaxLeituras: 3,
    ttlOcorrenciasMs: 12 * 3600_000,
    esperaCallbackMs: 3000,
    duracaoCallbackSeg: 20,
    destinoStage: 2,
    destinoDigito: "2",
  });
  const ev: EventoTracker[] = [];
  const ler = (...s: TableSnapshot[]) => {
    for (const x of s) ev.push(...t.ingest(x));
  };
  ler(snap([]));
  return { t, ev, ler };
}
const tipos = (ev: EventoTracker[]) =>
  ev.map((e) => (e.tipo === "aviso" ? `aviso:${e.codigo}` : e.tipo));
const vazias = (n: number) => Array.from({ length: n }, () => snap([], 1000));

describe("o mesmo cliente é transferido de novo depois de um CALLBACK", () => {
  it("1ª transferência sem atendimento (CALLBACK) e, após nova ligação manual, a 2ª transferência também é detectada", () => {
    const { ev, ler } = novo();
    ler(snap([row(L1, "Stage 1 Agent", 60, "T1")]));
    ler(snap([row(L1, "Stage 1 Agent", 61, "T1"), row(L2, "Stage 2 Ringing", 0, "T1")]));
    ler(...vazias(8)); // some sem atender: CALLBACK
    expect(tipos(ev)).toEqual(["transferencia", "callback"]);
    // ligou de novo (Manual Call) e transferiu: o Stage 2 aparece com o mesmo cliente
    ler(snap([row(L1, "Stage 1 Manual Call", 5, "T2")]));
    ler(snap([row(L1, "Stage 1 Manual Call", 36, "T2"), row(L2, "Stage 2 Ringing", 0, "T2")]));
    ler(snap([row(L2, "Stage 2 Agent", 3, "T2")]));
    expect(tipos(ev)).toEqual(["transferencia", "callback", "transferencia"]);
    expect(ev[2]).toMatchObject({ callback: L1, callee: X });
  });

  it("2ª transferência sem CALLBACK antes (mesma pessoa transferida duas vezes no dia)", () => {
    const { ev, ler } = novo();
    ler(snap([row(L1, "Stage 1 Agent", 60, "T1")]), snap([row(L2, "Stage 2 Agent", 90, "T1")]));
    ler(...vazias(8));
    ler(snap([row(L1, "Stage 1 Agent", 10, "T3")]), snap([row(L2, "Stage 2 Agent", 90, "T3")]));
    expect(tipos(ev)).toEqual(["transferencia", "transferencia"]);
  });

  it("não duplica: outras linhas Stage 2 do MESMO cliente durante a mesma transferência não geram mensagem nova", () => {
    const { ev, ler } = novo();
    ler(snap([row(L1, "Stage 1 Agent", 60, "T1")]));
    ler(snap([row(L1, "Stage 1 Agent", 61, "T1"), row(L2, "Stage 2 Ringing", 0, "T1")]));
    ler(snap([row(L1, "Stage 1 Agent", 62, "T1"), row("908223", "Stage 2 Ringing", 0, "T1")]));
    ler(snap([row("908223", "Stage 2 Agent", 2, "T1")]));
    ler(snap([row("908233", "Stage 2 Agent", 4, "T1")]));
    expect(tipos(ev)).toEqual(["transferencia"]);
  });

  it("Stage 2 antigo do cliente (sem nova ligação de Stage 1) continua sem gerar mensagem", () => {
    const { ev, ler } = novo();
    ler(snap([row(L1, "Stage 1 Agent", 60, "T1")]), snap([row(L2, "Stage 2 Agent", 1, "T1")]));
    ler(snap([]), snap([]));
    ler(
      snap([row("908223", "Stage 2 Agent", 1, "T9")]),
      snap([row("908223", "Stage 2 Agent", 5, "T9")]),
    );
    expect(tipos(ev)).toEqual(["transferencia"]);
  });

  it("após reiniciar o programa no meio de uma transferência (linha 1 e linha 2 já na tabela), outra linha 2 do mesmo cliente não gera mensagem", () => {
    const t = new CallTracker({
      leiturasConfirmacao: 1,
      ausenciaMaxLeituras: 3,
      ttlOcorrenciasMs: 12 * 3600_000,
      destinoStage: 2,
      destinoDigito: "2",
    });
    const ev: EventoTracker[] = [];
    // linha de base JÁ com as duas linhas do cliente
    ev.push(
      ...t.ingest(snap([row(L1, "Stage 1 Agent", 60, "T1"), row(L2, "Stage 2 Ringing", 0, "T1")])),
    );
    ev.push(
      ...t.ingest(
        snap([row(L1, "Stage 1 Agent", 61, "T1"), row("908223", "Stage 2 Ringing", 0, "T1")]),
      ),
    );
    expect(tipos(ev)).toEqual([]);
  });

  it("2ª transferência com várias linhas Stage 2 do mesmo cliente: uma mensagem só", () => {
    const { ev, ler } = novo();
    ler(snap([row(L1, "Stage 1 Agent", 60, "T1")]), snap([row(L2, "Stage 2 Agent", 90, "T1")]));
    ler(...vazias(8));
    ler(snap([row(L1, "Stage 1 Manual Call", 10, "T2")]));
    ler(snap([row(L1, "Stage 1 Manual Call", 11, "T2"), row(L2, "Stage 2 Ringing", 0, "T2")]));
    ler(
      snap([row(L1, "Stage 1 Manual Call", 12, "T2"), row("908223", "Stage 2 Ringing", 0, "T2")]),
    );
    ler(snap([row("908223", "Stage 2 Agent", 90, "T2")]));
    expect(tipos(ev)).toEqual(["transferencia", "transferencia"]);
  });
});
