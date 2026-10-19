import { describe, expect, it } from "vitest";
import { comAviso } from "../src/telegram/com-aviso.js";
import type { OpcoesEnvio } from "../src/dominio/tipos.js";

describe("comAviso repassa tudo ao enviador de verdade", () => {
  it("opções de resposta, conferência e releitura chegam intactas", async () => {
    const vistas: Array<OpcoesEnvio | undefined> = [];
    const linhas: string[] = [];
    const real = {
      send: async (_t: string, _c: string, o?: OpcoesEnvio) => {
        vistas.push(o);
        return { tipo: "enviada", confirmacao: "telegram:9" } as const;
      },
      verify: async () => "entregue" as const,
      reler: async (c: string) => `lido ${c}`,
    };
    const s = comAviso(real, "transferência", (l) => linhas.push(l));
    await s.send("CALLBACK", "k", { responderA: "telegram:42", reserva: "r" });
    expect(vistas[0]).toEqual({ responderA: "telegram:42", reserva: "r" });
    expect(linhas[0]).toContain("Resposta enviada");
    expect(await s.verify?.("k")).toBe("entregue");
    expect(await s.reler?.("telegram:1")).toBe("lido telegram:1");
  });
});
