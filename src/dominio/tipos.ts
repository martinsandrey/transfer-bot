/** Tipos de domínio compartilhados. Nada aqui depende do site. */

export interface CallRow {
  /** Telefone do funcionário (só dígitos). Localiza a chamada na tabela; nunca a posição da linha. */
  callbackNumber: string;
  /** Telefone do cliente (só dígitos). */
  calleeNumber: string;
  /** Texto cru de Call Status. */
  callStatus: string;
  /** Start Time como texto cru. TODO(confirmar): formato/fuso (P6); a identidade usa o texto cru. */
  startTime: string;
  /** Call Duration em segundos, quando legível. TODO(confirmar): formato (P6). */
  callDurationSec: number | null;
}

export interface TableSnapshot {
  /** Relógio monotônico/epoch em ms no momento da leitura. */
  readAt: number;
  rows: CallRow[];
  /** `false` = leitura parcial/inconsistente: descartada, não conta como leitura nem como ausência. */
  valid: boolean;
  invalidReason?: string;
}

export interface TableReader {
  read(): Promise<TableSnapshot>;
}

/** Sessão do site expirada/ausente: o monitor pausa e aciona o login. */
export class SessaoExpiradaError extends Error {
  constructor(mensagem = "Sessão do site expirada ou ausente.") {
    super(mensagem);
    this.name = "SessaoExpiradaError";
  }
}

export interface CustomerRecord {
  nome: string;
  cpf: string;
  location: string;
  age: string;
  phone: string;
}

export type ResultadoBusca =
  | { tipo: "ok"; registro: CustomerRecord; multiplos: boolean }
  | { tipo: "nenhum" }
  | { tipo: "telefone_divergente" };

export interface CustomerLookup {
  find(calleeNumber: string): Promise<ResultadoBusca>;
}

export type ResultadoEnvio =
  | { tipo: "enviada"; confirmacao: string }
  | { tipo: "incerta"; motivo: string }
  | { tipo: "falhou"; motivo: string; reenviavel: boolean };

export interface MessageSender {
  /** `chave` identifica a ocorrência (idempotência). Lançar exceção = resultado desconhecido (tratado como incerto). */
  send(texto: string, chave: string): Promise<ResultadoEnvio>;
  verify?(chave: string): Promise<"entregue" | "nao_encontrada" | "indeterminado">;
}
