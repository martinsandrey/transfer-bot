import { describe, expect, it } from "vitest";
import {
  SessaoExpiradaError,
  type CallRow,
  type TableReader,
  type TableSnapshot,
} from "../src/dominio/tipos.js";
import { CallTracker } from "../src/monitor/call-tracker.js";
import { Monitor } from "../src/monitor/monitor.js";
import { criarNotificadorFalso } from "../src/notificador/notificador.js";

const R = (cb: string, st: string, ce = "C1"): CallRow => ({
  callbackNumber: cb,
  calleeNumber: ce,
  callStatus: st,
  startTime: "T1",
  callDurationSec: 1,
});
const ok = (rows: CallRow[], t: number): TableSnapshot => ({ readAt: t, rows, valid: true });

function leitor(roteiro: Array<TableSnapshot | Error>): TableReader {
  let i = 0;
  return {
    async read() {
      const x = roteiro[Math.min(i++, roteiro.length - 1)] as TableSnapshot | Error;
      if (x instanceof Error) throw x;
      return x;
    },
  };
}
const log = { debug() {}, info() {}, warn() {}, error() {} };
const opcoes = {
  intervaloMs: 1,
  invalidasParaAlertar: 3,
  falhasParaAlertar: 3,
  limpezaMs: 1_000_000,
};

/** Roda o laço de verdade por `passos` leituras e para. */
async function rodar(monitor: Monitor, passos: number, lido: { n: number }): Promise<void> {
  const c = new AbortController();
  const p = monitor.executar(c.signal);
  const t0 = Date.now();
  while (lido.n < passos && Date.now() - t0 < 5000) await new Promise((r) => setTimeout(r, 2));
  c.abort();
  await p;
}

describe("robustez do monitor (o laço nunca morre)", () => {
  it("erro inesperado dentro do passo (ex.: bug no rastreador): registra, avisa uma vez e continua lendo", async () => {
    const lido = { n: 0 };
    const reader: TableReader = { read: async () => (lido.n++, ok([], lido.n)) };
    const tracker = {
      ingest: () => {
        throw new TypeError("bug de teste");
      },
      sweep() {},
    } as unknown as CallTracker;
    const notif = criarNotificadorFalso();
    const m = new Monitor({ reader, tracker, fila: null, log, notificador: notif }, opcoes);
    await rodar(m, 40, lido);
    expect(lido.n).toBeGreaterThanOrEqual(40); // continuou lendo apesar do erro a cada passo
    // sem spam: um aviso no 1º erro e outro a cada 30 seguidos
    expect(
      notif.alertas.filter((a) => /Erro inesperado no monitoramento/.test(a.mensagem)).length,
    ).toBeLessThanOrEqual(3);
  });

  it("o erro some e o monitoramento volta ao normal (contador zera)", async () => {
    const lido = { n: 0 };
    let falhar = true;
    const reader: TableReader = { read: async () => (lido.n++, ok([], lido.n)) };
    const tracker = {
      ingest: () => {
        if (falhar) throw new Error("x");
        return [];
      },
      sweep() {},
    } as unknown as CallTracker;
    const notif = criarNotificadorFalso();
    const m = new Monitor({ reader, tracker, fila: null, log, notificador: notif }, opcoes);
    const c = new AbortController();
    const p = m.executar(c.signal);
    while (lido.n < 5) await new Promise((r) => setTimeout(r, 2));
    falhar = false;
    const n0 = lido.n;
    while (lido.n < n0 + 5) await new Promise((r) => setTimeout(r, 2));
    c.abort();
    await p;
    expect(notif.alertas).toHaveLength(1); // só o aviso do começo
  });

  it("refazer o login que falha (lança erro) não derruba o laço", async () => {
    const lido = { n: 0 };
    const reader: TableReader = {
      read: async () => {
        lido.n++;
        if (lido.n === 3) throw new SessaoExpiradaError("sem tabela");
        return ok([], lido.n);
      },
    };
    const tracker = new CallTracker({
      leiturasConfirmacao: 1,
      ausenciaMaxLeituras: 3,
      ttlOcorrenciasMs: 60_000,
    });
    const m = new Monitor(
      {
        reader,
        tracker,
        fila: null,
        log,
        notificador: criarNotificadorFalso(),
        aoPerderSessao: async () => {
          throw new Error("login quebrou");
        },
      },
      opcoes,
    );
    await rodar(m, 15, lido);
    expect(lido.n).toBeGreaterThanOrEqual(15);
  });

  it("leituras com falha e inválidas em sequência longa: só alertas limitados, nada de exceção", async () => {
    const lido = { n: 0 };
    const roteiro: Array<TableSnapshot | Error> = [];
    for (let i = 0; i < 40; i++)
      roteiro.push(
        i % 3 === 0
          ? new Error("página navegando")
          : { readAt: i, rows: [], valid: false, invalidReason: "x" },
      );
    roteiro.push(ok([R("A", "Stage 1 Agent")], 99));
    const base = leitor(roteiro);
    const reader: TableReader = { read: () => (lido.n++, base.read()) };
    const tracker = new CallTracker({
      leiturasConfirmacao: 1,
      ausenciaMaxLeituras: 3,
      ttlOcorrenciasMs: 60_000,
    });
    const notif = criarNotificadorFalso();
    const m = new Monitor({ reader, tracker, fila: null, log, notificador: notif }, opcoes);
    await rodar(m, 45, lido);
    expect(notif.alertas.length).toBeLessThan(10);
    expect(tracker.ocorrenciasAtivas).toBe(1); // e voltou a enxergar a tabela
  });
});
