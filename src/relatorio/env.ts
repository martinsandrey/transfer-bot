import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseEnv } from "node:util";
import { interpretarApelidos } from "../config/apelidos.js";
import { FUSO_PADRAO, fusoValido } from "../util/fuso.js";

/** Lê só o que o relatório precisa do `.env` (sem exigir o resto da configuração). Valores inválidos são ignorados. */
export function lerEnv(caminho = ".env"): {
  pasta: string;
  apelidos: Map<string, string>;
  religacao: { janelaMs: number };
  fuso: string;
  /** Minutos que definem a ligação longa (DURACAO_LONGA_MIN); só muda os textos do relatório. */
  duracaoLongaMin: number;
} {
  let pasta = "registros";
  let apelidos = new Map<string, string>();
  // Mesmos padrões do programa (config.ts): CALLBACK_RELIGACAO_MIN 60 (hoje só liga/desliga a regra "só a última conta").
  let janelaMin = 60;
  let fuso = FUSO_PADRAO;
  let duracaoLongaMin = 5;
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
      janelaMin = inteiro(env["CALLBACK_RELIGACAO_MIN"], 0, 1440) ?? janelaMin;
      duracaoLongaMin = inteiro(env["DURACAO_LONGA_MIN"], 1, 600) ?? duracaoLongaMin;
      const f = (env["FUSO_HORARIO"] ?? "").trim();
      if (f && fusoValido(f)) fuso = f;
    }
  } catch {
    /* usa o padrão */
  }
  return {
    pasta: resolve(pasta),
    apelidos,
    religacao: { janelaMs: janelaMin * 60_000 },
    fuso,
    duracaoLongaMin,
  };
}
