/**
 * Apelidos dos funcionários (Callback Number → nome), do `.env`:
 *   APELIDOS_FUNCIONARIOS=908113=Maria; 908114=João Silva
 * Pares separados por `;`. O número é comparado só pelos dígitos. Onde o funcionário aparece (relatório, avisos), o apelido vem
 * SEMPRE junto do número ("Maria (908113)"), nunca só um dos dois.
 */
export type Apelidos = ReadonlyMap<string, string>;

const soDigitos = (v: string): string => v.replace(/\D+/g, "");

/** Devolve os apelidos e a lista de itens inválidos (para a configuração avisar em português). */
export function interpretarApelidos(texto: string | undefined): {
  apelidos: Map<string, string>;
  invalidos: string[];
} {
  const apelidos = new Map<string, string>();
  const invalidos: string[] = [];
  for (const bruto of (texto ?? "").split(";")) {
    const item = bruto.trim();
    if (item === "") continue;
    const i = item.indexOf("=");
    const numero = i < 0 ? "" : soDigitos(item.slice(0, i));
    const nome = i < 0 ? "" : item.slice(i + 1).trim();
    if (numero === "" || nome === "") invalidos.push(item);
    else apelidos.set(numero, nome);
  }
  return { apelidos, invalidos };
}

/** "Maria (908113)" ou, sem apelido cadastrado, "908113 (sem apelido)". */
export function rotuloDoFuncionario(numero: string, apelidos: Apelidos | undefined): string {
  const n = numero.trim();
  const nome = apelidos?.get(soDigitos(n));
  return nome ? `${nome} (${n})` : `${n} (sem apelido)`;
}
