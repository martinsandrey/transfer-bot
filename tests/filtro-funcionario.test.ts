import { describe, expect, it } from "vitest";
import { validarConfig } from "../src/config/config.js";
import type { TableReader, TableSnapshot } from "../src/dominio/tipos.js";
import type { TaskQueue } from "../src/fila/task-queue.js";
import type { CallTracker, EventoTracker } from "../src/monitor/call-tracker.js";
import {
  decidirFiltro,
  interpretarDigitos,
  penultimoDigito,
} from "../src/monitor/filtro-funcionario.js";
import { Monitor } from "../src/monitor/monitor.js";
import { criarNotificadorFalso } from "../src/notificador/notificador.js";

describe("penultimoDigito", () => {
  it("lê o penúltimo dígito (o último é livre; o antepenúltimo é a linha)", () => {
    expect(penultimoDigito("5500000101")).toBe("0"); // ...[1][0][1]
    expect(penultimoDigito("5500000111")).toBe("1");
    expect(penultimoDigito("5500000131")).toBe("3");
  });
  it("ignora símbolos e espaços", () => {
    expect(penultimoDigito("+55 (11) 0000-0119")).toBe("1");
  });
  it("sem dígitos suficientes: indefinido", () => {
    expect(penultimoDigito("7")).toBeUndefined();
    expect(penultimoDigito("abc")).toBeUndefined();
    expect(penultimoDigito("")).toBeUndefined();
  });
});

describe("interpretarDigitos", () => {
  it("aceita um dígito, lista e curinga", () => {
    expect([...(interpretarDigitos("1") ?? [])]).toEqual(["1"]);
    expect([...(interpretarDigitos("0, 1;2 3") ?? [])]).toEqual(["0", "1", "2", "3"]);
    expect(interpretarDigitos("*")).toBeNull();
    expect(interpretarDigitos("Todos")).toBeNull();
    expect(interpretarDigitos("")).toBeNull();
  });
  it("rejeita item inválido", () => {
    expect(interpretarDigitos("1,a")).toBeUndefined();
    expect(interpretarDigitos("10")).toBeUndefined();
  });
});

describe("decidirFiltro", () => {
  it("só os dígitos permitidos passam; sem filtro todos passam", () => {
    const so1 = interpretarDigitos("1") ?? null;
    expect(decidirFiltro(so1, "5500000111")).toBe("enviar");
    expect(decidirFiltro(so1, "5500000101")).toBe("ignorar");
    expect(decidirFiltro(null, "5500000101")).toBe("enviar");
    expect(decidirFiltro(null, "7")).toBe("enviar");
  });
  it("com filtro e número curto demais: indeterminado (não envia)", () => {
    expect(decidirFiltro(interpretarDigitos("1") ?? null, "7")).toBe("indeterminado");
  });
});

describe("configuração do filtro", () => {
  const base = { SITE_URL: "https://exemplo.invalid/" };
  it("padrão: transferências só dígito 1; 5 min todos", () => {
    const f = validarConfig(base).filtroFuncionarios;
    expect([...(f.transferencia ?? [])]).toEqual(["1"]);
    expect(f.longa).toBeNull();
  });
  it("configurável pelo .env", () => {
    const f = validarConfig({
      ...base,
      PENULTIMO_DIGITO_TRANSFERENCIA: "*",
      PENULTIMO_DIGITO_5MIN: "1,2",
    }).filtroFuncionarios;
    expect(f.transferencia).toBeNull();
    expect([...(f.longa ?? [])]).toEqual(["1", "2"]);
  });
  it("valor inválido dá erro em português", () => {
    expect(() => validarConfig({ ...base, PENULTIMO_DIGITO_5MIN: "um" })).toThrow(
      /PENULTIMO_DIGITO_5MIN/,
    );
  });
});

describe("monitor aplica o filtro por funcionário", () => {
  const log = { debug() {}, info() {}, warn() {}, error() {} };
  const ev = (tipo: "transferencia" | "ligacao_longa" | "callback", callback: string) =>
    ({
      tipo,
      ocorrencia: "x",
      chave: `${tipo}|${callback}`,
      callback,
      callee: "C1",
      vinculo: `${callback}|v`,
      ...(tipo === "transferencia" ? { fase: "agent" } : {}),
    }) as EventoTracker;

  async function rodar(eventos: EventoTracker[], filtro: Parameters<typeof criar>[0]) {
    return criar(filtro, eventos);
  }
  async function criar(
    filtro: { transferencia: ReadonlySet<string> | null; longa: ReadonlySet<string> | null },
    eventos: EventoTracker[],
  ) {
    const enfileirados: string[] = [];
    const fila = {
      enqueue: (e: EventoTracker) => (
        enfileirados.push(e.tipo + ":" + (e as { callback: string }).callback),
        null
      ),
      drenar: async () => {},
    } as unknown as TaskQueue;
    const tracker = {
      ingest: () => eventos.splice(0),
      sweep() {},
    } as unknown as CallTracker;
    const reader: TableReader = {
      read: async (): Promise<TableSnapshot> => ({ readAt: 1, rows: [], valid: true }),
    };
    const notif = criarNotificadorFalso();
    const m = new Monitor(
      { reader, tracker, fila, log, notificador: notif },
      {
        intervaloMs: 1,
        invalidasParaAlertar: 3,
        falhasParaAlertar: 3,
        limpezaMs: 1_000_000,
        filtroFuncionarios: filtro,
      },
    );
    const c = new AbortController();
    const p = m.executar(c.signal);
    await new Promise((r) => setTimeout(r, 30));
    c.abort();
    await p;
    return { enfileirados, notif };
  }

  const so1 = new Set(["1"]);
  const filtro = { transferencia: so1, longa: null };

  it("transferência: só funcionário com penúltimo dígito 1; 5 min: todos", async () => {
    const { enfileirados } = await rodar(
      [
        ev("transferencia", "5500000111"), // meu
        ev("transferencia", "5500000101"), // paquistanês
        ev("ligacao_longa", "5500000111"),
        ev("ligacao_longa", "5500000101"),
      ],
      filtro,
    );
    expect(enfileirados).toEqual([
      "transferencia:5500000111",
      "ligacao_longa:5500000111",
      "ligacao_longa:5500000101",
    ]);
  });

  it("CALLBACK segue o filtro das transferências", async () => {
    const { enfileirados } = await rodar(
      [ev("callback", "5500000101"), ev("callback", "5500000121")],
      { transferencia: new Set(["1", "2"]), longa: null },
    );
    expect(enfileirados).toEqual(["callback:5500000121"]);
  });

  it("número curto demais com filtro ativo: não gera mensagem e avisa", async () => {
    const { enfileirados, notif } = await rodar([ev("transferencia", "7")], filtro);
    expect(enfileirados).toEqual([]);
    expect(notif.alertas.some((a) => /dígitos suficientes/.test(a.mensagem))).toBe(true);
  });

  it("sem filtro configurado (simulação): tudo passa", async () => {
    const { enfileirados } = await rodar([ev("transferencia", "5500000101")], {
      transferencia: null,
      longa: null,
    });
    expect(enfileirados).toHaveLength(1);
  });
});

describe("avisos do monitor mostram o número por inteiro", () => {
  const log = { debug() {}, info() {}, warn() {}, error() {} };
  async function mensagens(): Promise<string[]> {
    const ev = {
      tipo: "transferencia",
      ocorrencia: "x",
      chave: "k",
      callback: "5500000111",
      callee: "5511987654321",
      vinculo: "v",
      fase: "agent",
    } as EventoTracker;
    const tracker = { ingest: () => [ev], sweep() {} } as unknown as CallTracker;
    const reader: TableReader = {
      read: async (): Promise<TableSnapshot> => ({ readAt: 1, rows: [], valid: true }),
    };
    const notif = criarNotificadorFalso();
    const m = new Monitor(
      { reader, tracker, fila: null, log, notificador: notif },
      {
        intervaloMs: 1,
        invalidasParaAlertar: 3,
        falhasParaAlertar: 3,
        limpezaMs: 1e6,
      },
    );
    const c = new AbortController();
    const p = m.executar(c.signal);
    await new Promise((r) => setTimeout(r, 20));
    c.abort();
    await p;
    return notif.alertas.map((a) => a.mensagem);
  }
  it("cliente e funcionário aparecem completos", async () => {
    const m = (await mensagens())[0];
    expect(m).toContain("cliente 5511987654321");
    expect(m).toContain("funcionário 5500000111");
  });
});
