import { createHash } from "node:crypto";

/**
 * Código curto e estável de uma ligação (a partir do `vinculo`: Callback Number + discriminador do Stage 1). Vai para o cabeçalho
 * do registro em .txt para o relatório ligar a transferência, o CALLBACK e a mensagem de 5 min da MESMA ligação.
 * Não revela o telefone (hash).
 */
export function idDaLigacao(vinculo: string): string {
  return createHash("sha1").update(vinculo).digest("hex").slice(0, 10);
}
