/**
 * Fuso horário do programa. Tudo que o usuário vê (console, notificações, registros .txt, relatório, arquivo de log) usa este
 * fuso, não o do Windows: assim o horário é o mesmo em todo lugar, mesmo com o relógio do PC em outro fuso.
 * A conta é feita no próprio Node: com `TZ` definido, `Date` (getHours, toLocaleString...) passa a usar o fuso.
 */
export const FUSO_PADRAO = "America/Sao_Paulo";

export function fusoValido(fuso: string): boolean {
  try {
    new Intl.DateTimeFormat("pt-BR", { timeZone: fuso });
    return true;
  } catch {
    return false;
  }
}

/** Passa o programa inteiro para o fuso informado. Chamar uma vez, logo depois de ler a configuração. */
export function aplicarFuso(fuso: string): void {
  process.env.TZ = fuso;
}

const dois = (n: number): string => String(n).padStart(2, "0");

/** Data no fuso do programa (`AAAA-MM-DD`). */
export function dataLocal(d: Date = new Date()): string {
  return `${d.getFullYear()}-${dois(d.getMonth() + 1)}-${dois(d.getDate())}`;
}

/** Instante com o deslocamento do fuso (`2026-10-22T12:45:14.123-03:00`), legível no arquivo de log. */
export function isoLocal(ms: number): string {
  const d = new Date(ms);
  const desloc = -d.getTimezoneOffset();
  const sinal = desloc >= 0 ? "+" : "-";
  const abs = Math.abs(desloc);
  return `${dataLocal(d)}T${dois(d.getHours())}:${dois(d.getMinutes())}:${dois(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, "0")}${sinal}${dois(Math.floor(abs / 60))}:${dois(abs % 60)}`;
}
