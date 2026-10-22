import { parseEnv } from "node:util";
import { describe, expect, it } from "vitest";
import { acrescentarFaltantes } from "../src/config/atualizar-env.js";

const EXEMPLO = `# Endereço do site
SITE_URL=
# Fuso do programa
# (padrão: Brasília)
FUSO_HORARIO=America/Sao_Paulo

# Tempo parado
TABELA_PARADA_MINUTOS=5
# NIVEL_COMENTADO=x
`;

describe("atualizar o .env com as variáveis novas", () => {
  it("acrescenta só o que falta, com os comentários, sem mexer nos valores existentes", () => {
    const env = "SITE_URL=https://exemplo.invalid/\nSEGREDO=abc123\n";
    const r = acrescentarFaltantes(env, EXEMPLO);
    expect(r.adicionadas).toEqual(["FUSO_HORARIO", "TABELA_PARADA_MINUTOS"]);
    expect(r.texto.startsWith(env)).toBe(true);
    expect(r.texto).toContain("# (padrão: Brasília)\nFUSO_HORARIO=America/Sao_Paulo");
    expect(r.texto).toContain("# Tempo parado\nTABELA_PARADA_MINUTOS=5");
    expect(r.texto).not.toContain("NIVEL_COMENTADO");
    const v = parseEnv(r.texto);
    expect(v["SITE_URL"]).toBe("https://exemplo.invalid/");
    expect(v["SEGREDO"]).toBe("abc123");
    expect(v["TABELA_PARADA_MINUTOS"]).toBe("5");
  });

  it("não muda nada quando já tem tudo (nem valor diferente do padrão), e é idempotente", () => {
    const env = "SITE_URL=x\nFUSO_HORARIO=America/Manaus\nTABELA_PARADA_MINUTOS=0\n";
    expect(acrescentarFaltantes(env, EXEMPLO)).toEqual({ texto: env, adicionadas: [] });
    const uma = acrescentarFaltantes("SITE_URL=x\n", EXEMPLO);
    expect(acrescentarFaltantes(uma.texto, EXEMPLO).adicionadas).toEqual([]);
  });

  it("mantém CRLF do Windows e arquivo sem quebra de linha no fim", () => {
    const r = acrescentarFaltantes("SITE_URL=x", EXEMPLO.replace(/\n/g, "\r\n"));
    expect(r.texto).not.toMatch(/[^\r]\n/);
    expect(r.texto.startsWith("SITE_URL=x\r\n")).toBe(true);
    expect(parseEnv(r.texto)["FUSO_HORARIO"]).toBe("America/Sao_Paulo");
  });

  it("o .env.example real acrescenta tudo a um .env vazio e o resultado é válido", async () => {
    const { readFileSync } = await import("node:fs");
    const { validarConfig } = await import("../src/config/config.js");
    const r = acrescentarFaltantes("", readFileSync(".env.example", "utf8"));
    expect(r.adicionadas.length).toBeGreaterThan(10);
    expect(() =>
      validarConfig({ ...parseEnv(r.texto), SITE_URL: "https://exemplo.invalid/" }),
    ).not.toThrow();
  });
});
