import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { lerRegistro } from "../relatorio/relatorio.js";
import { NOME_ARQUIVO } from "./registro-arquivo.js";

/** Só os dígitos do telefone (para comparar o mesmo cliente mesmo com formatos diferentes). */
export const soDigitos = (v: string): string => v.replace(/\D+/g, "");

/**
 * Clientes que já receberam a mensagem de 5 min há pouco, lidos do registro em .txt. Serve para o programa NÃO repetir a
 * mensagem depois de ser reiniciado (a memória do programa some, o arquivo não). Só enxerga blocos com `Cliente:` no cabeçalho.
 */
export function longasRecentes(
  pasta: string,
  agora: number,
  janelaMs: number,
): Array<{ cliente: string; em: number }> {
  try {
    const arquivo = join(pasta, NOME_ARQUIVO.longa);
    if (janelaMs <= 0 || !existsSync(arquivo)) return [];
    return lerRegistro(readFileSync(arquivo, "utf8"), "longa")
      .filter((e) => e.tipo === "longa" && e.cliente !== null)
      .map((e) => ({ cliente: soDigitos(e.cliente ?? ""), em: e.quando.getTime() }))
      .filter((e) => e.cliente !== "" && agora - e.em <= janelaMs && e.em <= agora + 5 * 60_000);
  } catch {
    return [];
  }
}
