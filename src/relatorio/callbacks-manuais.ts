import type { Entrada } from "./relatorio.js";

/**
 * Callbacks marcados à mão no relatório (botão "Marcar como callback" na lista de ligações). Só valem para o relatório: nada é
 * enviado ao Telegram. Ficam em `registros/callbacks-manuais.txt`, uma linha por marcação, só ACRESCENTANDO (pedido do usuário,
 * 2026-10-20); vale a última linha de cada ligação, então "Desfazer" grava uma linha `DESMARCADA`. Sem dados de cliente.
 */
export const ARQUIVO_CALLBACKS_MANUAIS = "callbacks-manuais.txt";

const MARCADA = "MARCADA COMO CALLBACK";
const DESMARCADA = "DESMARCADA";

const dois = (n: number): string => String(n).padStart(2, "0");
/** Data e hora no formato dos registros (`AAAA-MM-DD HH:MM:SS`, relógio do computador). */
export function carimbo(d: Date): string {
  return `${d.getFullYear()}-${dois(d.getMonth() + 1)}-${dois(d.getDate())} ${dois(d.getHours())}:${dois(d.getMinutes())}:${dois(d.getSeconds())}`;
}

/**
 * Identifica a transferência: o código da ligação (registros novos) ou, nos registros antigos sem código, a hora do registro e
 * o funcionário.
 */
export function chaveDaTransferencia(
  e: Pick<Entrada, "ligacao" | "quando" | "funcionario">,
): string {
  return e.ligacao ? `L:${e.ligacao}` : `T:${carimbo(e.quando)}|${e.funcionario}`;
}

function descreverChave(chave: string): string | null {
  if (/^L:[\w-]{1,64}$/.test(chave)) return `Ligação: ${chave.slice(2)}`;
  const m = /^T:(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d)\|([^\r\n|]{1,64})$/.exec(chave);
  return m ? `Transferência: ${m[1]} | Funcionário: ${m[2]}` : null;
}

/** `true` se a chave tem o formato de uma das chaves acima (protege o arquivo contra texto qualquer). */
export const chaveValida = (chave: string): boolean => descreverChave(chave) !== null;

export function linhaDeMarcacao(chave: string, marcar: boolean, agora: Date): string {
  const desc = descreverChave(chave);
  if (!desc) throw new Error("chave inválida");
  return `${carimbo(agora)} | ${marcar ? MARCADA : DESMARCADA} | ${desc}\n`;
}

/** Lê o arquivo: chave → marcada (a última linha de cada chave vale). */
export function lerCallbacksManuais(texto: string): Map<string, boolean> {
  const mapa = new Map<string, boolean>();
  const re = new RegExp(
    `^\\d{4}-\\d\\d-\\d\\d \\d\\d:\\d\\d:\\d\\d \\| (${MARCADA}|${DESMARCADA}) \\| (?:Ligação: (\\S+)|Transferência: (\\d{4}-\\d\\d-\\d\\d \\d\\d:\\d\\d:\\d\\d) \\| Funcionário: (.+?))\\s*$`,
  );
  for (const linha of texto.replace(/\r\n?/g, "\n").split("\n")) {
    const m = re.exec(linha);
    if (!m) continue;
    const chave = m[2] ? `L:${m[2]}` : `T:${m[3]}|${m[4]}`;
    mapa.set(chave, m[1] === MARCADA);
  }
  return mapa;
}
