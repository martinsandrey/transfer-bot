/**
 * Códigos de saída do programa, usados pelo supervisor (`supervisor.ts`) para decidir se reabre:
 * - 0: o usuário mandou parar ("sair", Ctrl+C): não reabre;
 * - 1 e 2: problema de configuração, senha errada, Telegram sem login...: reabrir não adianta, não reabre;
 * - `SAIDA_REINICIAR` (e qualquer outro código ou queda inesperada): reabre.
 */
export const SAIDA_REINICIAR = 75;
export const SAIDAS_SEM_REINICIO: readonly number[] = [0, 1, 2];
