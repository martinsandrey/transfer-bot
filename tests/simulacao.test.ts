import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { TaskQueue } from "../src/fila/task-queue.js";
import { criarConstrutor } from "../src/mensagem/construtor.js";
import { EnviadorFalso } from "../src/mensagem/enviadores.js";
import { CallTracker } from "../src/monitor/call-tracker.js";
import { Monitor } from "../src/monitor/monitor.js";
import { criarNotificadorFalso } from "../src/notificador/notificador.js";
import { BuscaSimulada, LeitorSimulado } from "../src/simulacao/cenario.js";

describe("cenário fictício completo (ponta a ponta sem navegador)", () => {
  it("gera as tarefas esperadas e nenhuma para base, Stage 2 e primeira vez em Stage 3", async () => {
    const notif = criarNotificadorFalso();
    const log = { debug() {}, info() {}, warn() {}, error() {} };
    const sender = new EnviadorFalso();
    const previas: string[] = [];
    const fila = new TaskQueue(
      {
        lookup: new BuscaSimulada(),
        construtor: criarConstrutor(readFileSync("config/mensagem.txt", "utf8")),
        sender,
        log,
        notificador: notif,
      },
      {
        modo: "observacao",
        maxTentativasConsulta: 1,
        maxTentativasEnvio: 1,
        backoffMs: 1,
        ttlTarefasMs: 1e6,
        previa: (t) => previas.push(t),
      },
    );
    const tracker = new CallTracker({
      leiturasConfirmacao: 2,
      ausenciaMaxLeituras: 3,
      ttlOcorrenciasMs: 1e6,
    });
    const monitor = new Monitor(
      { reader: new LeitorSimulado(), tracker, fila, log, notificador: notif },
      { intervaloMs: 1, invalidasParaAlertar: 99, falhasParaAlertar: 99, limpezaMs: 1e9 },
    );
    for (let i = 0; i < 20; i++) {
      await monitor.passo();
      await fila.drenar();
    }
    const estados = fila.todas.map((t) => t.estado).sort();
    // 5 transferências: 2 do funcionário 1 (observadas), 1 com vários resultados (observada), 1 divergente e 1 sem cadastro (ignoradas)
    expect(estados).toEqual(["ignorada", "ignorada", "observada", "observada", "observada"]);
    expect(sender.enviados).toHaveLength(0); // modo observação
    expect(previas).toHaveLength(3);
    const msgs = notif.alertas.map((a) => a.mensagem).join("\n");
    expect(msgs).toMatch(/direto em Stage 3/);
    expect(msgs).toMatch(/cliente errado/);
    expect(msgs).toMatch(/nenhum cliente/);
  });
});
