import type { CamposDoCadastro } from "./consulta-cliente.js";

/**
 * Rótulos do formulário de edição do cliente, informados pelo usuário (2026-10-16):
 *   nome → "Name" · cpf → "ID number" · age → "Date of birth" · phone → "Phone" · location → "Address".
 * Atenção: o placeholder `{{age}}` da mensagem recebe o conteúdo de "Date of birth" LITERALMENTE (regra do usuário: sem cálculo).
 * TODO(confirmar) (R2): a estrutura do formulário (como o rótulo se liga ao campo) só será conhecida com a captura `edicao`.
 */
export const ROTULOS_DO_FORMULARIO: Record<keyof CamposDoCadastro, string> = {
  nome: "Name",
  cpf: "ID number",
  age: "Date of birth",
  phone: "Phone",
  mobilePhone: "Mobile Phone",
  location: "Address",
};

/** Ignora maiúsculas, acentos, espaços repetidos e os sinais ":" e "*" no fim do rótulo. */
export function normalizarRotulo(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[:：*\s]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export interface ParRotuloValor {
  rotulo: string;
  valor: string | undefined;
}

/**
 * Converte os pares "rótulo → valor" lidos do formulário nos campos da mensagem. Valores copiados como estão (o `trim` é feito depois).
 * Rótulo repetido: vale o PRIMEIRO. Rótulo ausente: campo `undefined` (vira vazio na mensagem). Rótulos desconhecidos são ignorados.
 */
export function camposPorRotulo(pares: readonly ParRotuloValor[]): CamposDoCadastro {
  const chaves = Object.entries(ROTULOS_DO_FORMULARIO).map(
    ([campo, rotulo]) => [campo as keyof CamposDoCadastro, normalizarRotulo(rotulo)] as const,
  );
  const saida: CamposDoCadastro = {};
  for (const par of pares) {
    const r = normalizarRotulo(par.rotulo);
    const achado = chaves.find(([, esperado]) => esperado === r);
    if (achado && saida[achado[0]] === undefined) saida[achado[0]] = par.valor;
  }
  return saida;
}
