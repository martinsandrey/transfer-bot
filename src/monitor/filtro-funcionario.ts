/**
 * Filtro por funcionário, a partir do Callback Number da linha do Stage 1 (quem fez a transferência).
 *
 * Regra do usuário: o número termina em 3 dígitos [linha][dono][qualquer]:
 *  - antepenúltimo = linha (1 = primeira linha, 3 = segunda linha);
 *  - penúltimo = dono do funcionário (0 = equipe do paquistanês, 1 = equipe do usuário; outros valores podem surgir).
 * Este filtro olha só o PENÚLTIMO dígito. Quais valores valem para cada grupo vem do `.env`.
 */

/** `null` = qualquer funcionário. */
export type DigitosPermitidos = ReadonlySet<string> | null;

export interface FiltroFuncionarios {
  /** Grupo das transferências (e do CALLBACK, que responde à mensagem de transferência). */
  transferencia: DigitosPermitidos;
  /** Grupo das ligações de 5 minutos. */
  longa: DigitosPermitidos;
}

export const SEM_FILTRO: FiltroFuncionarios = { transferencia: null, longa: null };

/** Interpreta a lista do `.env` ("1", "0,1", "0 1", "*", "todos"). Vazio = todos. Devolve `undefined` se houver item inválido. */
export function interpretarDigitos(texto: string | undefined): DigitosPermitidos | undefined {
  const itens = (texto ?? "").split(/[\s,;]+/).filter((s) => s !== "");
  if (itens.length === 0) return null;
  const conjunto = new Set<string>();
  for (const item of itens) {
    const t = item.toLowerCase();
    if (t === "*" || t === "todos") return null;
    if (!/^\d$/.test(t)) return undefined;
    conjunto.add(t);
  }
  return conjunto;
}

/** Penúltimo dígito do número (ignora +, espaços, traços e parênteses). `undefined` se houver menos de 2 dígitos. */
export function penultimoDigito(callback: string): string | undefined {
  const digitos = callback.replace(/\D/g, "");
  return digitos.length >= 2 ? digitos.charAt(digitos.length - 2) : undefined;
}

export type DecisaoFiltro = "enviar" | "ignorar" | "indeterminado";

/** `indeterminado` = há filtro, mas o número não tem dígitos suficientes para decidir (tratado como "não enviar" + aviso). */
export function decidirFiltro(permitidos: DigitosPermitidos, callback: string): DecisaoFiltro {
  if (permitidos === null) return "enviar";
  const d = penultimoDigito(callback);
  if (d === undefined) return "indeterminado";
  return permitidos.has(d) ? "enviar" : "ignorar";
}
