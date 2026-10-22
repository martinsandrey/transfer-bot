import { afterEach, describe, expect, it } from "vitest";
import { validarConfig } from "../src/config/config.js";
import { criarLogger } from "../src/log/logger.js";
import { aplicarFuso, dataLocal, fusoValido, isoLocal } from "../src/util/fuso.js";

const TZ_ORIGINAL = process.env.TZ;
afterEach(() => {
  if (TZ_ORIGINAL === undefined) delete process.env.TZ;
  else process.env.TZ = TZ_ORIGINAL;
});

// 22/10/2026 15:45:14.123 UTC = 12:45:14.123 em Brasília (UTC-3)
const INSTANTE = Date.UTC(2026, 9, 22, 15, 45, 14, 123);

describe("fuso horário do programa", () => {
  it("mostra o horário de Brasília mesmo com o computador em outro fuso", () => {
    aplicarFuso("Asia/Tokyo");
    expect(isoLocal(INSTANTE)).toBe("2026-10-23T00:45:14.123+09:00");
    aplicarFuso("America/Sao_Paulo");
    expect(isoLocal(INSTANTE)).toBe("2026-10-22T12:45:14.123-03:00");
    expect(new Date(INSTANTE).toLocaleTimeString("pt-BR", { hour12: false })).toBe("12:45:14");
  });

  it("o dia muda à meia-noite de Brasília, não à do UTC", () => {
    aplicarFuso("America/Sao_Paulo");
    expect(dataLocal(new Date(Date.UTC(2026, 9, 23, 1, 30)))).toBe("2026-10-22"); // 22:30 em Brasília
    expect(dataLocal(new Date(Date.UTC(2026, 9, 23, 3, 30)))).toBe("2026-10-23"); // 00:30 em Brasília
  });

  it("o arquivo de log grava o horário legível com o fuso", () => {
    aplicarFuso("America/Sao_Paulo");
    const linhas: string[] = [];
    const log = criarLogger({
      pastaLogs: "nao-usada",
      nivel: "info",
      destino: { write: (l: string) => void linhas.push(l) } as never,
      console: () => undefined,
    });
    log.info("teste", { evento: "x" });
    const reg = JSON.parse(linhas[0] ?? "{}") as { time: string };
    expect(reg.time).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}-03:00$/);
  });

  it("FUSO_HORARIO: padrão Brasília, aceita outro fuso e recusa nome inválido", () => {
    const base = { SITE_URL: "https://exemplo.invalid/" };
    expect(validarConfig(base).fuso).toBe("America/Sao_Paulo");
    expect(validarConfig({ ...base, FUSO_HORARIO: "America/Manaus" }).fuso).toBe("America/Manaus");
    expect(() => validarConfig({ ...base, FUSO_HORARIO: "Marte/Olimpo" })).toThrow(/FUSO_HORARIO/);
    expect(fusoValido("Marte/Olimpo")).toBe(false);
  });
});
