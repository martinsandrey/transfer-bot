/** Mascaramento de dados pessoais para logs e para a saída do reconhecimento. */

/** Mantém apenas os dígitos. */
export function somenteDigitos(valor: string): string {
  return valor.replace(/\D+/g, "");
}

/** Telefone → `***1234` (últimos 4 dígitos). Vazio/curto demais → `***`. */
export function mascararTelefone(valor: string): string {
  const d = somenteDigitos(valor);
  return d.length >= 4 ? `***${d.slice(-4)}` : "***";
}

const CPF_FORMATADO = /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g;
// Sequência com 8+ dígitos, tolerando separadores comuns de telefone (+, espaço, ponto, hífen, parênteses).
const SEQUENCIA_LONGA = /\+?\d[\d\s().-]{6,}\d/g;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

/**
 * Rede de segurança: mascara CPF, e-mail e qualquer sequência longa de dígitos que lembre telefone.
 * Não substitui a regra de nunca passar dados do cliente ao logger.
 */
export function mascararTexto(texto: string, opcoes: { telefones?: boolean } = {}): string {
  const base = texto.replace(CPF_FORMATADO, "***CPF***").replace(EMAIL, "***EMAIL***");
  if (opcoes.telefones === false) return base;
  return base.replace(SEQUENCIA_LONGA, (m) =>
    somenteDigitos(m).length >= 8 ? mascararTelefone(m) : m,
  );
}

/** `true` se o texto parece conter telefone, CPF ou e-mail (usado na varredura da saída do reconhecimento). */
export function pareceTerPii(texto: string): boolean {
  return mascararTexto(texto) !== texto;
}
