/**
 * Contrato mínimo com o Telegram (conta pessoal, MTProto). Implementação real: `cliente-gramjs.ts`; testes usam um cliente falso.
 * Nada aqui guarda texto de mensagens além do necessário para a verificação em memória.
 */
export interface MensagemRecente {
  id: number;
  texto: string;
  /** Segundos desde 1970 (UTC). */
  data: number;
}

export interface Dialogo {
  /** Identificador para usar em TELEGRAM_DESTINO (texto). */
  id: string;
  titulo: string;
  tipo: "privado" | "grupo" | "canal";
}

export interface ClienteTelegram {
  /** Envia texto simples ao destino ("me" = Mensagens Salvas, @usuario, ou ID numérico). Devolve o ID da mensagem enviada. */
  enviar(destino: string, texto: string): Promise<{ id: number; data: number }>;
  /** Últimas mensagens do destino (para verificar se um envio incerto chegou). */
  mensagensRecentes(destino: string, limite: number): Promise<MensagemRecente[]>;
  /** Lista conversas (comando `chats`). */
  dialogos(limite: number): Promise<Dialogo[]>;
  encerrar(): Promise<void>;
}

/** O Telegram pediu para esperar (FLOOD_WAIT). Nada foi enviado. */
export class FloodWaitTelegram extends Error {
  constructor(readonly segundos: number) {
    super(`FLOOD_WAIT de ${segundos}s`);
    this.name = "FloodWaitTelegram";
  }
}

/** Falha definitiva (destino inexistente, conta sem permissão, sessão revogada…). Nada foi enviado. */
export class FalhaTelegram extends Error {
  constructor(
    message: string,
    readonly reenviavel = false,
  ) {
    super(message);
    this.name = "FalhaTelegram";
  }
}
