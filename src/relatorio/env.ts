import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseEnv } from "node:util";
import { interpretarApelidos } from "../config/apelidos.js";
import { interpretarDigitos } from "../monitor/filtro-funcionario.js";

/** Lê só o que o relatório precisa do `.env` (sem exigir o resto da configuração). Valores inválidos são ignorados. */
export function lerEnv(caminho = ".env"): {
  pasta: string;
  apelidos: Map<string, string>;
  equipePaquistanesDigitos: string[];
  religacao: { janelaMs: number; duracaoMinSeg: number };
} {
  let pasta = "registros";
  let apelidos = new Map<string, string>();
  let digitos: string[] = ["0"];
  // Mesmos padrões do programa (config.ts): CALLBACK_RELIGACAO_MIN 60, CALLBACK_DURACAO_SEG 20.
  let janelaMin = 60;
  let duracaoMinSeg = 20;
  const inteiro = (v: string | undefined, min: number, max: number): number | null => {
    const t = (v ?? "").trim();
    if (!/^\d+$/.test(t)) return null;
    const n = Number(t);
    return n >= min && n <= max ? n : null;
  };
  try {
    if (existsSync(caminho)) {
      const env = parseEnv(readFileSync(caminho, "utf8").replace(/^\uFEFF/, ""));
      const v = (env["PASTA_REGISTROS"] ?? "").trim();
      if (v) pasta = v;
      apelidos = interpretarApelidos(env["APELIDOS_FUNCIONARIOS"]).apelidos;
      const d = interpretarDigitos((env["EQUIPE_PAQUISTANES_DIGITOS"] ?? "").trim() || "0");
      if (d) digitos = [...d];
      janelaMin = inteiro(env["CALLBACK_RELIGACAO_MIN"], 0, 1440) ?? janelaMin;
      duracaoMinSeg = inteiro(env["CALLBACK_DURACAO_SEG"], 0, 3600) ?? duracaoMinSeg;
    }
  } catch {
    /* usa o padrão */
  }
  return {
    pasta: resolve(pasta),
    apelidos,
    equipePaquistanesDigitos: digitos,
    religacao: { janelaMs: janelaMin * 60_000, duracaoMinSeg },
  };
}
