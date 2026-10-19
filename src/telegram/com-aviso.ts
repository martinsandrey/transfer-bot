import type { MessageSender } from "../dominio/tipos.js";

/**
 * Embrulha um enviador para avisar no console quando uma mensagem sai. Repassa TUDO ao enviador de verdade
 * (opções de resposta, conferência de entrega e releitura de mensagem editada): o embrulho nunca pode descartar nada.
 */
export function comAviso(
  e: Required<MessageSender>,
  rotulo: string,
  escrever: (linha: string) => void = console.log,
): MessageSender {
  return {
    send: async (texto, chave, opcoes) => {
      const r = await e.send(texto, chave, opcoes);
      if (r.tipo === "enviada") {
        const hora = new Date().toLocaleTimeString("pt-BR", { hour12: false });
        escrever(
          `[${hora}] ${opcoes?.responderA ? "Resposta enviada" : "Mensagem enviada"} ao Telegram (${rotulo}).`,
        );
      }
      return r;
    },
    verify: (chave) => e.verify(chave),
    reler: (confirmacao) => e.reler(confirmacao),
  };
}
