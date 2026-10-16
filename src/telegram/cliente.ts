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
  /** Envia texto simples ao destino ("me" = Mensagens Salvas, @usuario, ou ID numérico). Com `responderAId`, como resposta a essa mensagem. Devolve o ID da mensagem enviada. */
  enviar(
    destino: string,
    texto: string,
    responderAId?: number,
  ): Promise<{ id: number; data: number }>;
  /** Últimas mensagens do destino (para verificar se um envio incerto chegou). */
  mensagensRecentes(destino: string, limite: number): Promise<MensagemRecente[]>;
  /** Texto atual (já editado, se foi) de uma mensagem do destino; `null` se a mensagem não existe mais (apagada). */
  lerMensagem(destino: string, id: number): Promise<string | null>;
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

/** Compara títulos ignorando maiúsculas, espaços repetidos e formas equivalentes de caracteres (largura total/CJK). */
export function normalizarTitulo(t: string): string {
  return t.normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();
}

/** O destino é um título de conversa (e não "me", ID numérico, @usuario, telefone ou link)? */
export function destinoEhTitulo(destino: string): boolean {
  const d = destino.trim();
  return !(d === "me" || /^-?\d+$/.test(d) || /^[@+]/.test(d) || /^(https?:\/\/|t\.me\/)/i.test(d));
}

/** Índice do diálogo cujo título é o destino. Exato (normalizado) tem prioridade; senão, único que contém o texto. */
export function escolherPorTitulo(titulos: readonly string[], destino: string): number {
  const alvo = normalizarTitulo(destino);
  const exatos = titulos.flatMap((t, i) => (normalizarTitulo(t) === alvo ? [i] : []));
  if (exatos.length === 1) return exatos[0] as number;
  if (exatos.length > 1) throw new FalhaTelegram("destino_ambiguo_varias_conversas_com_esse_nome");
  const parciais = titulos.flatMap((t, i) => (normalizarTitulo(t).includes(alvo) ? [i] : []));
  if (parciais.length === 1) return parciais[0] as number;
  throw new FalhaTelegram(
    parciais.length > 1
      ? "destino_ambiguo_varias_conversas_com_esse_nome"
      : "destino_nao_encontrado_entre_suas_conversas",
  );
}
