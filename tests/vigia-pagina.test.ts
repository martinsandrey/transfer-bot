import { describe, expect, it } from "vitest";
import type { CallRow, TableReader, TableSnapshot } from "../src/dominio/tipos.js";
import { CallTracker } from "../src/monitor/call-tracker.js";
import { Monitor, type OpcoesMonitor } from "../src/monitor/monitor.js";
import { criarNotificadorFalso } from "../src/notificador/notificador.js";

const MIN = 60_000;
const linha = (dur: number, cb = "908111"): CallRow => ({
  callbackNumber: cb,
  calleeNumber: "5521900000101",
  callStatus: "Stage 1 Agent",
  startTime: "T1",
  callDurationSec: dur,
});
const snap = (rows: CallRow[]): TableSnapshot => ({ readAt: 0, rows, valid: true });

function montar(op: Partial<OpcoesMonitor>) {
  let proxima: () => TableSnapshot | Error = () => snap([]);
  const reader: TableReader = {
    read: async () => {
      const x = proxima();
      if (x instanceof Error) throw x;
      return x;
    },
  };
  const eventos: string[] = [];
  const notif = criarNotificadorFalso();
  const log = {
    debug() {},
    info() {},
    warn: (_m: string, c?: Record<string, unknown>) => void eventos.push(String(c?.["evento"])),
    error: (_m: string, c?: Record<string, unknown>) => void eventos.push(String(c?.["evento"])),
  };
  let recargas = 0;
  let reinicios = 0;
  const monitor = new Monitor(
    {
      reader,
      tracker: new CallTracker({
        leiturasConfirmacao: 1,
        ausenciaMaxLeituras: 3,
        ttlOcorrenciasMs: 60 * MIN,
      }),
      fila: null,
      log,
      notificador: notif,
      recarregar: async () => void recargas++,
      aoPrecisarReiniciar: () => void reinicios++,
    },
    { intervaloMs: 1000, invalidasParaAlertar: 99, falhasParaAlertar: 99, limpezaMs: 1e9, ...op },
  );
  return {
    monitor,
    notif,
    eventos,
    lerComo: (f: () => TableSnapshot | Error) => void (proxima = f),
    get recargas() {
      return recargas;
    },
    get reinicios() {
      return reinicios;
    },
  };
}

describe("vigia da página", () => {
  it("sem nenhuma ligação por muito tempo: recarrega (sem alarme) e recomeça a contar", async () => {
    const m = montar({ recargaOciosaMs: 30 * MIN });
    let t = 0;
    await m.monitor.passo(() => t);
    t = 29 * MIN;
    await m.monitor.passo(() => t);
    expect(m.recargas).toBe(0);
    t = 30 * MIN;
    await m.monitor.passo(() => t);
    expect(m.recargas).toBe(1);
    expect(m.notif.alertas).toEqual([]); // recarga ociosa é silenciosa
    t = 59 * MIN;
    await m.monitor.passo(() => t);
    expect(m.recargas).toBe(1);
    t = 60 * MIN;
    await m.monitor.passo(() => t);
    expect(m.recargas).toBe(2);
  });

  it("com ligação na tabela, nunca recarrega por ociosidade", async () => {
    const m = montar({ recargaOciosaMs: 30 * MIN });
    let n = 0;
    m.lerComo(() => snap([linha(++n)]));
    for (let t = 0; t <= 120 * MIN; t += 10 * MIN) await m.monitor.passo(() => t);
    expect(m.recargas).toBe(0);
  });

  it("desligado (0): não recarrega nunca", async () => {
    const m = montar({ recargaOciosaMs: 0, tabelaParadaMs: 0 });
    for (let t = 0; t <= 600 * MIN; t += 60 * MIN) await m.monitor.passo(() => t);
    expect(m.recargas).toBe(0);
  });

  it("tabela congelada (duração igual há minutos): avisa e recarrega", async () => {
    const m = montar({ tabelaParadaMs: 5 * MIN });
    m.lerComo(() => snap([linha(42)]));
    await m.monitor.passo(() => 0);
    await m.monitor.passo(() => 4 * MIN);
    expect(m.recargas).toBe(0);
    await m.monitor.passo(() => 5 * MIN);
    expect(m.recargas).toBe(1);
    expect(m.eventos).toContain("pagina_recarregada");
    expect(m.notif.alertas.some((a) => /parou de atualizar/.test(a.mensagem))).toBe(true);
  });

  it("duração que corre (muda a cada leitura) ou duração zero não contam como congelada", async () => {
    const m = montar({ tabelaParadaMs: 5 * MIN });
    let n = 0;
    m.lerComo(() => snap([linha(++n)]));
    for (let t = 0; t <= 30 * MIN; t += MIN) await m.monitor.passo(() => t);
    expect(m.recargas).toBe(0);
    m.lerComo(() => snap([linha(0)])); // tocando: duração ainda 0
    for (let t = 31 * MIN; t <= 60 * MIN; t += MIN) await m.monitor.passo(() => t);
    expect(m.recargas).toBe(0);
  });

  it("leituras falhando por muito tempo: recarrega", async () => {
    const m = montar({ leiturasRuinsParaRecarregar: 5 });
    m.lerComo(() => new Error("falhou"));
    for (let i = 0; i < 4; i++) await m.monitor.passo(() => i * 1000);
    expect(m.recargas).toBe(0);
    await m.monitor.passo(() => 5000);
    expect(m.recargas).toBe(1);
  });

  it("recarregar não resolveu (4 problemas em 10 min): pede para reiniciar o programa, uma vez só", async () => {
    const m = montar({ tabelaParadaMs: MIN, recargasAntesDeReiniciar: 3 });
    m.lerComo(() => snap([linha(42)]));
    let t = 0;
    for (let i = 0; i < 20; i++, t += MIN) await m.monitor.passo(() => t);
    expect(m.recargas).toBe(3);
    expect(m.reinicios).toBe(1);
    expect(m.eventos).toContain("reinicio_necessario");
  });

  it("problemas espaçados (mais de 10 min entre eles) não acumulam para o reinício", async () => {
    const m = montar({ tabelaParadaMs: MIN, recargasAntesDeReiniciar: 1 });
    m.lerComo(() => snap([linha(42)]));
    await m.monitor.passo(() => 0);
    await m.monitor.passo(() => MIN); // 1ª recarga
    await m.monitor.passo(() => 30 * MIN);
    await m.monitor.passo(() => 31 * MIN); // 2ª recarga, mas bem depois da primeira
    expect(m.recargas).toBe(2);
    expect(m.reinicios).toBe(0);
  });

  it("falha ao recarregar não derruba o monitor", async () => {
    const m = montar({ recargaOciosaMs: MIN });
    const antigo = m.monitor as unknown as { deps: { recarregar: () => Promise<void> } };
    antigo.deps.recarregar = async () => {
      throw new Error("sem página");
    };
    await m.monitor.passo(() => 0);
    await expect(m.monitor.passo(() => 2 * MIN)).resolves.toBeUndefined();
    expect(m.eventos).toContain("recarga_falhou");
  });
});
