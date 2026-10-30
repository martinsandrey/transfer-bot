import { describe, expect, it } from "vitest";
import type { CallRow, TableSnapshot } from "../src/dominio/tipos.js";
import { CallTracker, type EventoTracker } from "../src/monitor/call-tracker.js";

const X = "21900000101";
const L1 = "908113";
const L2 = "908213";
const L2B = "908223";
const row = (cb: string, status: string, dur: number, inicio = "T1"): CallRow => ({
  callbackNumber: cb,
  calleeNumber: X,
  callStatus: status,
  startTime: inicio,
  callDurationSec: dur,
});
let relogio = 0;
const snap = (rows: CallRow[], passoMs = 1000): TableSnapshot => {
  relogio += passoMs;
  return { readAt: relogio, rows, valid: true };
};

type Decisao = Parameters<
  NonNullable<ConstructorParameters<typeof CallTracker>[0]["aoDecidirAtendimento"]>
>[0];
function novo() {
  const decisoes: Decisao[] = [];
  const abertos: Array<{ minutos: number; callDurationSeg: number | null }> = [];
  const t = new CallTracker({
    leiturasConfirmacao: 1,
    ausenciaMaxLeituras: 3,
    ttlOcorrenciasMs: 600_000,
    esperaCallbackMs: 3000,
    duracaoCallbackSeg: 20,
    destinoStage: 2,
    destinoDigito: "2",
    aoDecidirAtendimento: (d) => decisoes.push(d),
    aoAcompanhamentoAberto: (a) => abertos.push(a),
  });
  const ev: EventoTracker[] = [];
  const ler = (...s: TableSnapshot[]) => {
    for (const x of s) ev.push(...t.ingest(x));
  };
  ler(snap([]));
  return { ev, ler, decisoes, abertos };
}
const vazias = (n = 6) => Array.from({ length: n }, () => snap([]));

describe("diagnóstico do fim do acompanhamento (vai para o log, sem telefones)", () => {
  it("atendida e longa: motivo 'atendida', com a maior Call Duration e o tempo em Agent pelo relógio", () => {
    const { ler, decisoes } = novo();
    ler(snap([row(L1, "Stage 1 Agent", 60)]), snap([row(L2, "Stage 2 Ringing", 0)]));
    ler(snap([row(L2, "Stage 2 Agent", 5)], 5000), snap([row(L2, "Stage 2 Agent", 95)], 90_000));
    ler(...vazias());
    expect(decisoes).toHaveLength(1);
    expect(decisoes[0]).toMatchObject({
      motivo: "atendida",
      callDurationSeg: 95,
      agentRelogioSeg: 90,
      linhasDestino: 1,
    });
  });

  it("curta (Call Duration < 20 s) vira CALLBACK e o diagnóstico mostra os números", () => {
    const { ev, ler, decisoes } = novo();
    ler(snap([row(L1, "Stage 1 Agent", 60)]), snap([row(L2, "Stage 2 Agent", 4)]));
    ler(snap([row(L2, "Stage 2 Agent", 9)], 5000));
    ler(...vazias());
    expect(ev.map((e) => e.tipo)).toEqual(["transferencia", "callback"]);
    expect(decisoes[0]).toMatchObject({
      motivo: "ligacao_curta",
      callDurationSeg: 9,
      agentRelogioSeg: 5,
    });
  });

  it("uma linha toca e some, outra atende: conta as duas linhas de destino", () => {
    const { ler, decisoes } = novo();
    ler(snap([row(L1, "Stage 1 Agent", 60)]), snap([row(L2, "Stage 2 Ringing", 0)]));
    ler(snap([row(L2B, "Stage 2 Agent", 70)], 15_000));
    ler(...vazias());
    expect(decisoes[0]).toMatchObject({ motivo: "atendida", linhasDestino: 2 });
  });

  it("ninguém atendeu: 'sem_atendimento'", () => {
    const { ler, decisoes } = novo();
    ler(snap([row(L1, "Stage 1 Agent", 60)]), snap([row(L2, "Stage 2 Ringing", 0)]));
    ler(...vazias());
    expect(decisoes).toHaveLength(1);
    expect(decisoes[0]).toMatchObject({
      motivo: "sem_atendimento",
      agentRelogioSeg: null,
      linhasDestino: 1,
    });
  });

  it("linha de destino atendida que não some: avisa nos marcos de 2 e 10 min com o Call Duration atual (para ver se está presa)", () => {
    const { ler, decisoes, abertos } = novo();
    ler(snap([row(L1, "Stage 1 Agent", 60)]), snap([row(L2, "Stage 2 Agent", 3)]));
    ler(snap([row(L2, "Stage 2 Agent", 60)], 60_000)); // 1 min
    expect(abertos).toEqual([]);
    ler(snap([row(L2, "Stage 2 Agent", 125)], 61_000)); // ~2 min
    ler(snap([row(L2, "Stage 2 Agent", 126)], 1000)); // não repete o mesmo marco
    ler(snap([row(L2, "Stage 2 Agent", 640)], 8 * 60_000)); // ~10 min
    expect(abertos).toEqual([
      expect.objectContaining({ minutos: 2, callDurationSeg: 125 }),
      expect.objectContaining({ minutos: 10, callDurationSeg: 640 }),
    ]);
    expect(decisoes).toEqual([]); // ainda não terminou
  });
});
