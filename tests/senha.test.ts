import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  gerarRegistro,
  REGISTRO_DA_SENHA,
  senhaDoEnvioEstaCorreta,
  verificarSenha,
} from "../src/seguranca/senha.js";

// Custo baixo só nos testes (rápido); o registro real usa custo alto.
const barato = (s: string) => gerarRegistro(s, 2 ** 10);

describe("senha de liberação do envio (hash irreversível)", () => {
  it("aceita só a senha certa (diferencia maiúsculas) e usa sal diferente a cada geração", () => {
    const r = barato("Exemplo-Teste-1");
    expect(verificarSenha("Exemplo-Teste-1", r)).toBe(true);
    expect(verificarSenha("exemplo-teste-1", r)).toBe(false);
    expect(verificarSenha("", r)).toBe(false);
    expect(verificarSenha("Exemplo-Teste-1 ", r)).toBe(false);
    expect(barato("Exemplo-Teste-1").hashHex).not.toBe(r.hashHex);
  });
  it("registro corrompido nunca libera", () => {
    expect(verificarSenha("x", { salHex: "zz", hashHex: "", custoN: 1024, r: 8, p: 1 })).toBe(
      false,
    );
    expect(verificarSenha("x", { ...barato("x"), custoN: 3 })).toBe(false);
  });
  it("o registro real é só hex (sem senha em texto) e o texto antigo ENVIAR não libera mais", () => {
    expect(REGISTRO_DA_SENHA.salHex).toMatch(/^[0-9a-f]{32}$/);
    expect(REGISTRO_DA_SENHA.hashHex).toMatch(/^[0-9a-f]{128}$/);
    expect(REGISTRO_DA_SENHA.custoN).toBeGreaterThanOrEqual(2 ** 16);
    expect(senhaDoEnvioEstaCorreta("ENVIAR")).toBe(false);
    expect(senhaDoEnvioEstaCorreta("")).toBe(false);
  });
  it("a senha não é configurável: nenhuma variável do .env nem do .env.example a menciona", () => {
    const cfg = readFileSync("src/config/config.ts", "utf8");
    expect(cfg).not.toMatch(/SENHA_(ENVIO|LIBERA)/i);
    expect(readFileSync(".env.example", "utf8")).not.toMatch(/SENHA_(ENVIO|LIBERA)/i);
  });
});
