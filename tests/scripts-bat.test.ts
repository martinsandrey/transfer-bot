import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const bats = readdirSync(".").filter((f) => f.endsWith(".bat"));

describe("scripts .bat do Windows", () => {
  it("existem os scripts esperados", () => {
    for (const f of [
      "instalar",
      "configurar",
      "iniciar",
      "simular",
      "recon",
      "telegram",
      "atualizar",
    ])
      expect(bats).toContain(`${f}.bat`);
  });
  for (const f of bats) {
    it(`${f}: CRLF em todas as linhas, ASCII puro nos echo e sem parênteses dentro de blocos`, () => {
      const bruto = readFileSync(f, "latin1");
      const linhas = bruto.split("\r\n");
      expect(bruto.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/); // nenhum LF/CR solto
      expect(bruto.startsWith("@echo off\r\n")).toBe(true);
      // acentos em echo quebram em páginas de código diferentes; mantemos os textos sem acento
      for (const l of linhas.filter((x) => /^\s*echo /i.test(x)))
        expect(l).toMatch(/^[\x20-\x7e]*$/);
      // ")" dentro de um echo que está num bloco "( ... )" fecha o bloco antes da hora
      let dentro = 0;
      for (const l of linhas) {
        if (dentro > 0 && /^\s*echo .*[()]/i.test(l))
          throw new Error(`${f}: parêntese em echo dentro de bloco: ${l}`);
        if (/\(\s*$/.test(l)) dentro++;
        else if (/^\s*\)/.test(l)) dentro = Math.max(0, dentro - 1);
      }
    });
  }
});
