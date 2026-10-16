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
  /** Linhas descartadas individualmente (dado faltando/estrutura inesperada). Normal em pequena quantidade. */
  rowsIgnored?: number;
  /**
   * Callback Numbers de linhas que existem mas estavam com algum dado faltando nesta leitura: o rastreador
   * "congela" essas chamadas (não conta ausência nem muda estado) em vez de tratá-las como sumidas.
   */
  incompleteCallbacks?: string[];
  /**
   * Linhas de Stage 3 com algum dado faltando (mas com Callee e Status legíveis): não viram linha normal, porém contam como
   * "o Stage 3 ainda está lá" para o acompanhamento do atendimento (evita um CALLBACK falso).
   */
  stage3Parciais?: Array<{ calleeNumber: string; agent: boolean }>;
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

export interface OpcoesEnvio {
  /** `confirmacao` de uma mensagem já enviada ao mesmo destino: a nova é enviada COMO RESPOSTA a ela. */
  responderA?: string;
  /** Texto a enviar (sem resposta) se não for possível responder à mensagem (ex.: ela foi apagada). */
  reserva?: string;
}

export interface MessageSender {
  /** `chave` identifica a ocorrência (idempotência). Lançar exceção = resultado desconhecido (tratado como incerto). */
  send(texto: string, chave: string, opcoes?: OpcoesEnvio): Promise<ResultadoEnvio>;
  verify?(chave: string): Promise<"entregue" | "nao_encontrada" | "indeterminado">;
  /**
   * Lê o texto ATUAL de uma mensagem já enviada (a `confirmacao` do envio). Serve para reaproveitar uma mensagem que a pessoa pode
   * ter EDITADO depois de enviada. Devolve o texto; `"apagada"` se a mensagem não existe mais; `null` se não foi possível ler.
   */
  reler?(confirmacao: string): Promise<string | "apagada" | null>;
}
