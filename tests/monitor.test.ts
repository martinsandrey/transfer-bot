import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  SessaoExpiradaError,
  type CallRow,
  type CustomerLookup,
  type TableReader,
  type TableSnapshot,
} from "../src/dominio/tipos.js";
import { TaskQueue } from "../src/fila/task-queue.js";
import { criarConstrutor } from "../src/mensagem/construtor.js";
import { EnviadorFalso } from "../src/mensagem/enviadores.js";
import { CallTracker } from "../src/monitor/call-tracker.js";
import { Monitor } from "../src/monitor/monitor.js";
import { criarNotificadorFalso } from "../src/notificador/notificador.js";

const R = (cb: string, status: string, ini = "T1", ce = "5521900000101"): CallRow => ({
  callbackNumber: cb,
  calleeNumber: ce,
  callStatus: status,
  startTime: ini,
  callDurationSec: 0,
});
const ok = (rows: CallRow[], t: number): TableSnapshot => ({ readAt: t, rows, valid: true });

/** Leitor roteirizado: cada item é um snapshot, um erro, ou uma função. */
class LeitorRoteirizado implements TableReader {
  leituras = 0;
  constructor(private readonly roteiro: Array<TableSnapshot | Error>) {}
  async read(): Promise<TableSnapshot> {
    this.leituras++;
    const i = Math.min(this.leituras - 1, this.roteiro.length - 1);
    const x = this.roteiro[i] as TableSnapshot | Error;
    if (x instanceof Error) throw x;
    return x;
  }
}

function montar(
  roteiro: Array<TableSnapshot | Error>,
  lookup?: CustomerLookup,
  extra: { aoPerderSessao?: () => Promise<void> } = {},
) {
  const reader = new LeitorRoteirizado(roteiro);
  const tracker = new CallTracker({
    leiturasConfirmacao: 1,
    ausenciaMaxLeituras: 3,
    ttlOcorrenciasMs: 60000,
  });
  const notif = criarNotificadorFalso();
  const log = { debug() {}, info() {}, warn() {}, error() {} };
  const sender = new EnviadorFalso();
  const busca: CustomerLookup = lookup ?? {
    find: async () => ({
      tipo: "ok",
      registro: { nome: "N", cpf: "C", location: "L", age: "1", phone: "5521900000101" },
      multiplos: false,
    }),
  };
  const fila = new TaskQueue(
    {
      lookup: busca,
      construtor: criarConstrutor(readFileSync("config/mensagem.txt", "utf8")),
      sender,
      log,
      notificador: notif,
    },
    {
      modo: "live",
      maxTentativasConsulta: 1,
      maxTentativasEnvio: 1,
      backoffMs: 1,
      ttlTarefasMs: 1000,
    },
  );
  const monitor = new Monitor(
    { reader, tracker, fila, log, notificador: notif, ...extra },
    { intervaloMs: 1000, invalidasParaAlertar: 3, falhasParaAlertar: 2, limpezaMs: 1_000_000 },
  );
  return { reader, tracker, notif, sender, fila, monitor };
}

describe("Monitor", () => {
  it("detecta Stage 1 → 3, cria a tarefa e envia; o monitor segue lendo durante a consulta", async () => {
    let liberar!: () => void;
    const trava = new Promise<void>((r) => (liberar = r));
    const lento: CustomerLookup = {
      find: async () => {
        await trava;
        return {
          tipo: "ok",
          registro: { nome: "N", cpf: "C", location: "L", age: "1", phone: "5521900000101" },
          multiplos: false,
        };
      },
    };
    const m = montar(
      [
        ok([R("A", "Stage 1 Agent")], 1),
        ok([R("A", "Stage 3 Agent")], 2),
        ok([R("A", "Stage 3 Agent")], 3),
      ],
      lento,
    );
    await m.monitor.passo();
    await m.monitor.passo(); // transferência → tarefa em segundo plano (bloqueada na consulta)
    expect(m.fila.todas).toHaveLength(1);
    expect(m.fila.todas[0]?.estado).toBe("pesquisando");
    await m.monitor.passo(); // continua lendo enquanto a consulta está pendente
    expect(m.reader.leituras).toBe(3);
    liberar();
    await m.fila.drenar();
    expect(m.fila.todas[0]?.estado).toBe("enviada");
    expect(m.sender.enviados).toHaveLength(1);
  });

  it("avisos e anomalias geram alerta sonoro sem criar tarefa", async () => {
    const m = montar([
      ok([R("A", "Stage 1 Agent")], 1),
      ok(
        [
          R("A", "Stage 1 Agent"),
          R("A", "Stage 1 Agent", "T2"),
          R("B", "Stage 3 Agent", "T1", "5521900000999"),
        ],
        2,
      ),
    ]);
    await m.monitor.passo();
    await m.monitor.passo();
    expect(m.fila.todas).toHaveLength(0);
    const msgs = m.notif.alertas.map((a) => a.mensagem).join("\n");
    expect(msgs).toMatch(/duas linhas ao mesmo tempo/);
    expect(msgs).toMatch(/direto em Stage 3/);
    expect(msgs).not.toMatch(/\bA\b.*duas linhas.*A\b/);
  });

  it("sessão expirada: pausa, chama o login, refaz a linha de base e avisa sobre a janela", async () => {
    let logins = 0;
    const m = montar(
      [
        ok([R("A", "Stage 1 Agent")], 1),
        new SessaoExpiradaError(),
        ok([R("A", "Stage 3 Agent")], 3),
      ],
      undefined,
      { aoPerderSessao: async () => void logins++ },
    );
    await m.monitor.passo();
    await m.monitor.passo();
    expect(logins).toBe(1);
    await m.monitor.passo(); // A já está em Stage 3 na nova base → nenhuma tarefa
    expect(m.fila.todas).toHaveLength(0);
    expect(m.notif.alertas.map((a) => a.mensagem).join("\n")).toMatch(/NÃO foram detectadas/);
  });

  it("leituras inválidas seguidas e falhas de leitura geram alerta uma vez", async () => {
    const inv: TableSnapshot = {
      readAt: 1,
      rows: [],
      valid: false,
      invalidReason: "linha_incompleta",
    };
    const m = montar([inv, inv, inv, inv, inv]);
    for (let i = 0; i < 5; i++) await m.monitor.passo();
    expect(m.notif.alertas.filter((a) => /ilegível/.test(a.mensagem))).toHaveLength(1);
    const m2 = montar([new Error("x"), new Error("x"), new Error("x")]);
    for (let i = 0; i < 3; i++) await m2.monitor.passo();
    expect(m2.notif.alertas.filter((a) => /falhou/.test(a.mensagem))).toHaveLength(1);
  });

  it("durante a consulta (aba ocupada) o monitor NÃO lê a tabela nem confunde com sessão expirada; ao voltar preserva as chamadas", async () => {
    let libera!: () => void;
    const trava = new Promise<void>((r) => (libera = r));
    const lento: CustomerLookup = {
      find: async () => {
        await trava;
        return {
          tipo: "ok",
          registro: { nome: "N", cpf: "C", location: "L", age: "1", phone: "5521900000101" },
          multiplos: false,
        };
      },
    };
    // 1: Stage 1 Agent; 2: transferência (linha do Stage 3 com o mesmo Callee); depois, leituras que NÃO devem acontecer na pausa
    const m = montar(
      [
        ok([R("A", "Stage 1 Agent")], 1),
        ok([R("C", "Stage 3 Agent")], 2),
        ok([R("C", "Stage 3 Agent")], 3),
        new SessaoExpiradaError(),
      ],
      lento,
    );
    const monitor = new Monitor(
      {
        reader: m.reader,
        tracker: m.tracker,
        fila: m.fila,
        log: { debug() {}, info() {}, warn() {}, error() {} },
        notificador: m.notif,
      },
      {
        intervaloMs: 1,
        invalidasParaAlertar: 99,
        falhasParaAlertar: 99,
        limpezaMs: 1e9,
        pausarDuranteConsulta: true,
      },
    );
    await monitor.passo();
    await monitor.passo();
    await monitor.passo(); // confirma a transferência → tarefa fica "pesquisando" (aba ocupada)
    expect(m.fila.ocupada).toBe(true);
    const leiturasAntes = m.reader.leituras;
    await monitor.passo();
    await monitor.passo();
    expect(m.reader.leituras).toBe(leiturasAntes); // pausado: não leu nada
    expect(m.notif.alertas.some((a) => /expirada/i.test(a.mensagem))).toBe(false);
    libera();
    await m.fila.drenar();
    expect(m.fila.ocupada).toBe(false);
  });

  it("linhas ignoradas por dado faltando não param nada; só alerta se TODAS forem ignoradas por muito tempo", async () => {
    const parcial: TableSnapshot = {
      readAt: 1,
      rows: [R("A", "Stage 1 Agent")],
      valid: true,
      rowsIgnored: 2,
      incompleteCallbacks: ["B"],
    };
    const m = montar([parcial, parcial, parcial, parcial]);
    for (let i = 0; i < 4; i++) await m.monitor.passo();
    expect(m.notif.alertas).toEqual([]);
    const todas: TableSnapshot = { readAt: 1, rows: [], valid: true, rowsIgnored: 3 };
    const m2 = montar([todas, todas, todas, todas, todas]);
    for (let i = 0; i < 5; i++) await m2.monitor.passo();
    expect(m2.notif.alertas.filter((a) => /ignoradas/.test(a.mensagem))).toHaveLength(1);
  });

  it("tabela vazia (só a linha-aviso) e Stage 3 sem um dado NÃO disparam o aviso de 'todas ignoradas'", async () => {
    const vazia: TableSnapshot = {
      readAt: 1,
      rows: [],
      valid: true,
      rowsIgnored: 1,
      rowsIgnoredUnexplained: 0,
      rowsIgnoredReasons: "tabela_vazia x1",
    };
    const m = montar(Array.from({ length: 12 }, () => vazia));
    for (let i = 0; i < 12; i++) await m.monitor.passo();
    expect(m.notif.alertas.filter((a) => /ignoradas/.test(a.mensagem))).toHaveLength(0);
  });

  it("linhas realmente estranhas: o aviso diz os motivos (e vai para o log)", async () => {
    const estranha: TableSnapshot = {
      readAt: 1,
      rows: [],
      valid: true,
      rowsIgnored: 3,
      rowsIgnoredUnexplained: 2,
      rowsIgnoredReasons: "sem_start_time x2, tabela_vazia x1",
    };
    const m = montar(Array.from({ length: 5 }, () => estranha));
    for (let i = 0; i < 5; i++) await m.monitor.passo();
    const a = m.notif.alertas.filter((x) => /ignoradas/.test(x.mensagem));
    expect(a).toHaveLength(1);
    expect(a[0]?.mensagem).toContain("Motivos: sem_start_time x2, tabela_vazia x1.");
  });

  it("executar respeita o sinal de parada", async () => {
    const m = montar([ok([], 1)]);
    const c = new AbortController();
    let dormidas = 0;
    const monitor = new Monitor(
      {
        reader: m.reader,
        tracker: m.tracker,
        fila: null,
        log: { debug() {}, info() {}, warn() {}, error() {} },
        notificador: m.notif,
      },
      {
        intervaloMs: 1000,
        invalidasParaAlertar: 3,
        falhasParaAlertar: 2,
        limpezaMs: 1,
        dormir: async () => void (++dormidas >= 3 && c.abort()),
      },
    );
    await monitor.executar(c.signal);
    expect(m.reader.leituras).toBe(3);
  });

  it("sem fila: transferência apenas avisa", async () => {
    const m = montar([ok([R("A", "Stage 1 Agent")], 1), ok([R("A", "Stage 3 Agent")], 2)]);
    const monitor = new Monitor(
      {
        reader: m.reader,
        tracker: m.tracker,
        fila: null,
        log: { debug() {}, info() {}, warn() {}, error() {} },
        notificador: m.notif,
      },
      { intervaloMs: 1, invalidasParaAlertar: 9, falhasParaAlertar: 9, limpezaMs: 1e6 },
    );
    await monitor.passo();
    await monitor.passo();
    expect(m.notif.alertas.some((a) => /TRANSFERÊNCIA detectada/.test(a.mensagem))).toBe(true);
  });
});
