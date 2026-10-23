import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { validarConfig } from "../src/config/config.js";
import { paginaHtml } from "../src/relatorio/pagina.js";
import { lerEnv } from "../src/relatorio/env.js";
import { montarLigacoes } from "../src/relatorio/relatorio.js";

const pagina = (duracaoLongaMin?: number) =>
  paginaHtml({
    geradoEm: new Date(),
    ...montarLigacoes([]),
    inicial: { periodo: "hoje" },
    ...(duracaoLongaMin !== undefined ? { duracaoLongaMin } : {}),
  });

describe("tempo da ligação longa configurável (DURACAO_LONGA_MIN)", () => {
  it("o relatório troca todos os '5 min' pelo tempo configurado", () => {
    const html = pagina(7);
    expect(html).toContain("Ligações de 7 min");
    expect(html).toContain("Ligações de 7 minutos: viraram transferência?");
    expect(html).toContain("7 min antes do meio-dia");
    expect(html).not.toMatch(/\b5 min(utos)?\b/);
  });

  it("sem configurar, continua 5 min", () => {
    for (const html of [pagina(), pagina(5)]) {
      expect(html).toContain("Ligações de 5 min");
      expect(html).not.toContain("Ligações de 7 min");
    }
  });

  it("relatorio.bat lê DURACAO_LONGA_MIN do .env (padrão 5; inválido usa 5)", () => {
    const pasta = mkdtempSync(join(tmpdir(), "env-"));
    const com = (t: string) => {
      const f = join(pasta, `.env${Math.random()}`);
      writeFileSync(f, t);
      return lerEnv(f).duracaoLongaMin;
    };
    expect(com("DURACAO_LONGA_MIN=7\n")).toBe(7);
    expect(com("SITE_URL=x\n")).toBe(5);
    expect(com("DURACAO_LONGA_MIN=abc\n")).toBe(5);
  });

  it("o programa lê 7 e o converte em segundos para o rastreador", () => {
    const cfg = validarConfig({ SITE_URL: "https://exemplo.invalid/", DURACAO_LONGA_MIN: "7" });
    expect(cfg.duracaoLongaMin).toBe(7);
  });
});
