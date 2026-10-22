import { describe, expect, it } from "vitest";
import { supervisionar, type OpcoesSupervisor } from "../src/supervisao.js";
import { SAIDA_REINICIAR } from "../src/util/saida.js";

function rodar(codigos: Array<number | null>, extra: Partial<OpcoesSupervisor> = {}) {
  let aberturas = 0;
  let t = 0;
  const saida: string[] = [];
  const alertas: string[] = [];
  const op: OpcoesSupervisor = {
    iniciar: async () => {
      aberturas++;
      return codigos[Math.min(aberturas - 1, codigos.length - 1)] as number | null;
    },
    esperar: async (ms) => void (t += ms),
    escrever: (x) => void saida.push(x),
    alertar: (_n, x) => void alertas.push(x),
    parando: () => false,
    agora: () => t,
    ...extra,
  };
  return { op, saida, alertas, aberturas: () => aberturas };
}

describe("supervisor", () => {
  it("saída normal (0), configuração/senha (1, 2): não reabre", async () => {
    for (const c of [0, 1, 2]) {
      const r = rodar([c]);
      expect(await supervisionar(r.op)).toBe(c);
      expect(r.aberturas()).toBe(1);
    }
  });

  it("pedido de reinício, queda por sinal ou código estranho: reabre e avisa", async () => {
    const r = rodar([SAIDA_REINICIAR, null, 3221225477, 0]);
    expect(await supervisionar(r.op)).toBe(0);
    expect(r.aberturas()).toBe(4);
    expect(r.alertas).toHaveLength(3);
    expect(r.alertas[0]).toMatch(/senha de liberação/);
  });

  it("se o usuário pediu para parar, não reabre mesmo com código de reinício", async () => {
    const r = rodar([SAIDA_REINICIAR], { parando: () => true });
    await supervisionar(r.op);
    expect(r.aberturas()).toBe(1);
  });

  it("desiste depois de muitas aberturas seguidas (não fica abrindo e fechando para sempre)", async () => {
    const r = rodar([SAIDA_REINICIAR], { maxAberturas: 4, esperaMs: 1000 });
    expect(await supervisionar(r.op)).toBe(SAIDA_REINICIAR);
    expect(r.aberturas()).toBe(4);
    expect(r.saida.join("")).toMatch(/Desisti de reabrir/);
  });

  it("aberturas espaçadas (fora da janela) não somam para o limite", async () => {
    const r = rodar([SAIDA_REINICIAR, SAIDA_REINICIAR, SAIDA_REINICIAR, SAIDA_REINICIAR, 0], {
      maxAberturas: 3,
      janelaMs: 10_000,
      esperaMs: 20_000,
    });
    expect(await supervisionar(r.op)).toBe(0);
    expect(r.aberturas()).toBe(5);
  });
});
