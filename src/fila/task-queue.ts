import type {
  CustomerLookup,
  CustomerRecord,
  MessageSender,
  ResultadoBusca,
} from "../dominio/tipos.js";
import type { Logger } from "../log/logger.js";
import type { ConstrutorDeMensagem } from "../mensagem/construtor.js";
import type { Notificador } from "../notificador/notificador.js";
import type { EventoTracker } from "../monitor/call-tracker.js";

export type EstadoTarefa =
  | "detectada"
  | "na_fila"
  | "pesquisando"
  | "pronta"
  | "enviando"
  | "enviada"
  | "observada"
  | "incerta"
  | "falhou"
  | "ignorada";

export const ESTADOS_TERMINAIS: ReadonlySet<EstadoTarefa> = new Set([
  "enviada",
  "observada",
  "incerta",
  "falhou",
  "ignorada",
]);

/** Transições permitidas (qualquer outra lança erro). `incerta` pode ser resolvida manualmente. */
const TRANSICOES: Record<EstadoTarefa, readonly EstadoTarefa[]> = {
  detectada: ["na_fila", "ignorada"],
  na_fila: ["pesquisando", "ignorada"],
  pesquisando: ["pronta", "ignorada", "falhou"],
  pronta: ["enviando", "observada", "falhou", "ignorada"],
  enviando: ["enviada", "incerta", "falhou"],
  enviada: [],
  observada: [],
  incerta: ["enviada", "enviando", "falhou"], // só por decisão manual
  falhou: [],
  ignorada: [],
};

/** Traduz o código de falha do enviador (nunca contém dados de cliente) para uma explicação em português. */
export function descreverFalhaDeEnvio(motivo: string): string {
  if (motivo.startsWith("flood_wait_"))
    return `o Telegram pediu para esperar (${motivo.slice(11)}); tente de novo mais tarde.`;
  if (motivo.includes("destino_ambiguo")) {
    const ids = /\[ids: ([^\]]*)\]/.exec(motivo)?.[1];
    return `há mais de uma conversa com esse nome${ids ? ` (IDs: ${ids})` : ""}. Use o ID certo em TELEGRAM_DESTINO (telegram.bat, opção 2).`;
  }
  if (motivo.includes("destino_nao_encontrado"))
    return "não achei uma conversa com esse nome entre as suas. Confira TELEGRAM_DESTINO (telegram.bat, opção 2).";
  if (motivo.includes("destino_invalido_ou_sem_permissao"))
    return "destino inválido ou a sua conta não tem permissão para escrever nele.";
  if (motivo.includes("sessao_invalida"))
    return "a sessão do Telegram não vale mais; refaça o login (telegram.bat, opção 1).";
  return motivo;
}

export type TipoTarefa = "transferencia" | "longa";

export interface TarefaTransferencia {
  id: string;
  /** Identifica a ligação (Stage 1) de origem; liga a mensagem de 5 min à transferência da mesma ligação. */
  vinculo: string;
  /** Confirmação do envio (ex.: `telegram:123`), usada para reler a mensagem se ela for editada depois. */
  confirmacao?: string;
  /** Esta tarefa reaproveitou a mensagem já enviada ao grupo de 5 min (não consultou o cadastro). */
  reaproveitada?: boolean;
  /** `transferencia` = grupo das transferências; `longa` = ligação que atingiu o tempo mínimo em Stage 1 (segundo grupo). */
  tipo: TipoTarefa;
  /** Resumo da ocorrência (sem telefone): chave de idempotência. */
  chave: string;
  estado: EstadoTarefa;
  callback: string;
  callee: string;
  tentativasConsulta: number;
  tentativasEnvio: number;
  /** Só existem em memória e são apagados quando a tarefa termina. */
  cadastro?: CustomerRecord;
  mensagem?: string;
  motivo?: string;
  historico: Array<{ estado: EstadoTarefa; em: number }>;
}

export interface OpcoesFila {
  modo: "observacao" | "live";
  maxTentativasConsulta: number;
  maxTentativasEnvio: number;
  backoffMs: number;
  ttlTarefasMs: number;
  /** Por quanto tempo lembrar (em memória) da mensagem enviada ao grupo de 5 min para reaproveitá-la numa transferência posterior. Padrão 3 h. */
  memoriaMensagemLongaMs?: number;
  /** Mensagem mais velha que isso (desde a detecção) não é mais enviada (o Telegram pode ter ficado fora do ar). 0/ausente = não expira. */
  validadeMensagemMs?: number;
  /** Pausa entre uma tarefa e a próxima, para o monitor voltar a ler a tabela de chamadas entre as consultas (padrão 3 s). */
  pausaEntreTarefasMs?: number;
  agora?: () => number;
  dormir?: (ms: number) => Promise<void>;
  /** Prévia no console (modo observação). Pode conter dados do cliente: nunca vai para o log. */
  previa?: (texto: string, tipo: TipoTarefa) => void;
}

export interface DepsFila {
  lookup: CustomerLookup;
  construtor: ConstrutorDeMensagem;
  sender: MessageSender;
  /** Enviador do segundo grupo (ligações longas). Sem ele, tarefas `longa` não são aceitas. */
  senderLonga?: MessageSender;
  log: Logger;
  notificador: Notificador;
}

export class TaskQueue {
  private readonly tarefas = new Map<string, TarefaTransferencia>();
  private drenando: Promise<void> | null = null;
  private processando = false;
  private seq = 0;

  constructor(
    private readonly deps: DepsFila,
    private readonly op: OpcoesFila,
  ) {}

  private agora(): number {
    return (this.op.agora ?? Date.now)();
  }
  private dormir(ms: number): Promise<void> {
    return (this.op.dormir ?? ((m) => new Promise<void>((r) => setTimeout(r, m))))(ms);
  }

  /** `true` enquanto uma tarefa está sendo processada (consulta ao cliente ocupa a aba); `false` nas pausas entre tarefas. */
  get ocupada(): boolean {
    return this.processando;
  }

  get todas(): readonly TarefaTransferencia[] {
    return [...this.tarefas.values()];
  }
  get(id: string): TarefaTransferencia | undefined {
    return this.tarefas.get(id);
  }

  /** Cria a tarefa (idempotente por `chave`: segunda chamada devolve `null`). */
  enqueue(
    ev: Extract<EventoTracker, { tipo: "transferencia" | "ligacao_longa" }>,
  ): TarefaTransferencia | null {
    const tipo: TipoTarefa = ev.tipo === "ligacao_longa" ? "longa" : "transferencia";
    if (tipo === "longa" && !this.deps.senderLonga && this.op.modo === "live") return null;
    for (const t of this.tarefas.values()) if (t.chave === ev.chave) return null;
    const t: TarefaTransferencia = {
      id: `t${++this.seq}`,
      tipo,
      vinculo: ev.vinculo,
      chave: ev.chave,
      estado: "detectada",
      callback: ev.callback,
      callee: ev.callee,
      tentativasConsulta: 0,
      tentativasEnvio: 0,
      historico: [{ estado: "detectada", em: this.agora() }],
    };
    const aFrente = this.todas.filter(
      (x) =>
        x !== t &&
        (x.estado === "na_fila" ||
          x.estado === "pesquisando" ||
          x.estado === "enviando" ||
          x.estado === "pronta"),
    ).length;
    this.tarefas.set(t.id, t);
    this.mover(t, "na_fila");
    if (aFrente > 0) {
      this.deps.notificador.alerta(
        "info",
        `Tarefa ${t.id} entrou na fila (${aFrente} à frente). Será processada logo após as anteriores.`,
      );
    }
    return t;
  }

  private mover(t: TarefaTransferencia, novo: EstadoTarefa, motivo?: string): void {
    if (!TRANSICOES[t.estado].includes(novo))
      throw new Error(`Transição de tarefa inválida: ${t.estado} → ${novo}`);
    if ((novo === "enviada" || novo === "observada") && t.mensagem !== undefined)
      this.guardarMensagemLonga(t, t.mensagem);
    t.estado = novo;
    if (motivo !== undefined) t.motivo = motivo;
    t.historico.push({ estado: novo, em: this.agora() });
    // A incerta mantém a mensagem em memória até a decisão manual (reenvio); os demais terminais a apagam.
    if (ESTADOS_TERMINAIS.has(novo) && novo !== "incerta") {
      delete t.cadastro;
      delete t.mensagem;
    }
    this.deps.log.info("Tarefa mudou de estado", {
      evento: "tarefa",
      idCurto: t.id,
      estadoTarefa: novo,
      ...(motivo ? { motivo } : {}),
    });
  }

  /** Processa as tarefas em fila, uma por vez. Chamadas simultâneas compartilham a mesma execução (trava). */
  drenar(): Promise<void> {
    if (!this.drenando) {
      // Repete enquanto houver tarefa esperando: uma tarefa que entre justo quando o laço está terminando não fica parada.
      this.drenando = (async () => {
        await Promise.resolve(); // garante que `drenando` já está atribuído antes de qualquer tarefa começar (nunca dois laços)
        do {
          await this.laco();
        } while (!this.parando && this.todas.some((t) => t.estado === "na_fila"));
      })().finally(() => {
        this.drenando = null;
      });
    }
    return this.drenando;
  }

  private parando = false;

  /** Mensagens JÁ ENVIADAS (ou prévias) do grupo de 5 min, por ligação: reaproveitadas se a ligação for transferida depois. Só em memória. */
  private readonly mensagensLongas = new Map<
    string,
    { texto: string; em: number; confirmacao?: string }
  >();

  private guardarMensagemLonga(t: TarefaTransferencia, texto: string): void {
    if (t.tipo !== "longa") return;
    this.mensagensLongas.set(t.vinculo, {
      texto,
      em: this.agora(),
      ...(t.confirmacao !== undefined ? { confirmacao: t.confirmacao } : {}),
    });
  }

  /** Encerramento limpo: termina a tarefa em andamento (sem pegar outra) e devolve as tarefas que ficaram sem conclusão. */
  async encerrar(): Promise<TarefaTransferencia[]> {
    this.parando = true;
    await this.drenando;
    return this.todas.filter((t) => t.estado === "incerta" || t.estado === "na_fila");
  }

  private async laco(): Promise<void> {
    let primeira = true;
    for (;;) {
      if (this.parando) return;
      const proxima = this.todas.find((t) => t.estado === "na_fila");
      if (!proxima) return;
      if (primeira === false) await this.dormir(this.op.pausaEntreTarefasMs ?? 3000);
      primeira = false;
      this.processando = true;
      try {
        await this.processar(proxima);
      } catch (e) {
        this.deps.log.error("Erro inesperado ao processar tarefa", {
          evento: "tarefa_erro",
          idCurto: proxima.id,
          motivo: e instanceof Error ? e.message : "desconhecido",
        });
        if (!ESTADOS_TERMINAIS.has(proxima.estado))
          this.finalizarComoFalha(proxima, "erro_inesperado");
      } finally {
        this.processando = false;
      }
    }
  }

  private finalizarComoFalha(t: TarefaTransferencia, motivo: string): void {
    this.mover(t, TRANSICOES[t.estado].includes("falhou") ? "falhou" : "ignorada", motivo);
    this.deps.notificador.alerta("erro", `Tarefa ${t.id} não concluída (${motivo}).`);
  }

  private async processar(t: TarefaTransferencia): Promise<void> {
    this.mover(t, "pesquisando");
    const reaproveitada = await this.mensagemReaproveitavel(t);
    if (reaproveitada !== undefined) {
      // A ligação já fez 5 min em Stage 1 e a mensagem foi ao grupo de 5 min: reenvia o MESMO texto, sem consultar o cadastro.
      t.reaproveitada = true;
      t.mensagem = reaproveitada;
      this.deps.log.info("Mensagem do grupo de 5 min reaproveitada", {
        evento: "mensagem_reaproveitada",
        idCurto: t.id,
      });
      this.mover(t, "pronta");
    } else if (!(await this.prepararMensagem(t))) {
      return;
    }
    if (t.mensagem === undefined) return;

    if (this.op.modo === "observacao") {
      this.op.previa?.(t.mensagem, t.tipo);
      this.mover(t, "observada");
      return;
    }
    if (this.expirou(t)) {
      this.mover(t, "ignorada", "mensagem_expirada");
      this.avisarExpirada(t);
      return;
    }
    await this.enviar(t);
  }

  private senderDe(t: TarefaTransferencia): MessageSender {
    return t.tipo === "longa" && this.deps.senderLonga ? this.deps.senderLonga : this.deps.sender;
  }

  private expirou(t: TarefaTransferencia): boolean {
    const v = this.op.validadeMensagemMs ?? 0;
    const inicio = t.historico[0]?.em ?? this.agora();
    return v > 0 && this.agora() - inicio > v;
  }

  private avisarExpirada(t: TarefaTransferencia): void {
    this.deps.notificador.alerta(
      "erro",
      `Tarefa ${t.id}: a mensagem ficou velha demais para ser útil e NÃO foi enviada (${Math.round((this.op.validadeMensagemMs ?? 0) / 60000)} min).`,
    );
  }

  /** Consulta o cadastro e monta a mensagem. `false` = a tarefa já terminou (sem cliente, divergente, falha). */
  private async prepararMensagem(t: TarefaTransferencia): Promise<boolean> {
    const busca = await this.pesquisar(t);
    if (!busca) return false;
    if (busca.tipo === "nenhum") {
      this.mover(t, "ignorada", "cliente_nao_encontrado");
      this.deps.notificador.alerta(
        "erro",
        `Tarefa ${t.id}: nenhum cliente encontrado para o Callee Number. Nada foi enviado.`,
      );
      return false;
    }
    if (busca.tipo === "telefone_divergente") {
      this.mover(t, "ignorada", "telefone_divergente");
      this.deps.notificador.alerta(
        "erro",
        `Tarefa ${t.id}: telefone do cadastro diferente do Callee Number (cliente errado). Nada foi enviado.`,
      );
      return false;
    }
    if (busca.multiplos)
      this.deps.notificador.alerta(
        "aviso",
        `Tarefa ${t.id}: mais de um cliente encontrado; usando o primeiro resultado.`,
      );
    t.cadastro = busca.registro;
    try {
      t.mensagem = this.deps.construtor.build(busca.registro, t.callback);
    } catch {
      this.mover(t, "falhou", "erro_ao_montar_mensagem");
      this.deps.notificador.alerta("erro", `Tarefa ${t.id}: erro ao montar a mensagem.`);
      return false;
    }
    this.mover(t, "pronta");
    return true;
  }

  /**
   * Texto a reaproveitar da mensagem de 5 min desta ligação. Lê a mensagem NO GRUPO no momento da transferência, para pegar uma
   * edição feita pela pessoa; se a leitura falhar (ou a mensagem não existir mais) usa o texto guardado em memória.
   */
  private async mensagemReaproveitavel(t: TarefaTransferencia): Promise<string | undefined> {
    if (t.tipo !== "transferencia") return undefined;
    const g = this.mensagensLongas.get(t.vinculo);
    if (!g) return undefined;
    this.mensagensLongas.delete(t.vinculo); // uma ligação só é transferida uma vez
    const validade = this.op.memoriaMensagemLongaMs ?? 3 * 3_600_000;
    if (this.agora() - g.em > validade) return undefined;
    const sender = this.deps.senderLonga;
    if (g.confirmacao !== undefined && sender?.reler) {
      let atual: string | "apagada" | null;
      try {
        atual = await sender.reler(g.confirmacao);
      } catch {
        atual = null;
      }
      if (typeof atual === "string" && atual !== "apagada" && atual.trim() !== "") {
        if (atual !== g.texto)
          this.deps.log.info("Mensagem do grupo de 5 min foi editada; usando o texto editado", {
            evento: "mensagem_editada_usada",
            idCurto: t.id,
          });
        return atual;
      }
      this.deps.notificador.alerta(
        "aviso",
        `Tarefa ${t.id}: ${atual === "apagada" ? "a mensagem do grupo de 5 min foi apagada" : "não consegui reler a mensagem do grupo de 5 min"}; usei o texto original.`,
      );
    }
    return g.texto;
  }

  private async pesquisar(t: TarefaTransferencia): Promise<ResultadoBusca | null> {
    while (t.tentativasConsulta < this.op.maxTentativasConsulta) {
      t.tentativasConsulta++;
      try {
        return await this.deps.lookup.find(t.callee);
      } catch {
        this.deps.log.warn("Falha na consulta ao cliente", {
          evento: "consulta_falhou",
          idCurto: t.id,
          tentativa: t.tentativasConsulta,
        });
        if (t.tentativasConsulta < this.op.maxTentativasConsulta)
          await this.dormir(this.op.backoffMs * 2 ** (t.tentativasConsulta - 1));
      }
    }
    this.mover(t, "falhou", "consulta_esgotou_tentativas");
    this.deps.notificador.alerta(
      "erro",
      `Tarefa ${t.id}: não foi possível consultar o cliente após ${t.tentativasConsulta} tentativa(s).`,
    );
    return null;
  }

  private async enviar(t: TarefaTransferencia): Promise<void> {
    this.mover(t, "enviando");
    while (t.mensagem !== undefined) {
      if (t.tentativasEnvio > 0 && this.expirou(t)) {
        this.mover(t, "falhou", "mensagem_expirada"); // as tentativas anteriores falharam sem enviar nada
        this.avisarExpirada(t);
        return;
      }
      t.tentativasEnvio++;
      let resultado;
      try {
        resultado = await this.senderDe(t).send(t.mensagem, t.chave);
      } catch {
        resultado = { tipo: "incerta", motivo: "excecao_no_envio" } as const; // não sabemos se saiu
      }
      if (resultado.tipo === "enviada") {
        t.confirmacao = resultado.confirmacao;
        this.mover(t, "enviada");
        return;
      }
      if (resultado.tipo === "falhou") {
        if (resultado.reenviavel && t.tentativasEnvio < this.op.maxTentativasEnvio) {
          await this.dormir(this.op.backoffMs * 2 ** (t.tentativasEnvio - 1));
          continue;
        }
        this.mover(t, "falhou", "envio_falhou");
        this.deps.log.warn("Envio falhou", {
          evento: "envio_falhou",
          idCurto: t.id,
          motivo: resultado.motivo,
        });
        this.deps.notificador.alerta(
          "erro",
          `Tarefa ${t.id}: o envio falhou. Nenhuma mensagem foi entregue. Motivo: ${descreverFalhaDeEnvio(resultado.motivo)}`,
        );
        return;
      }
      await this.tratarIncerta(t, resultado.motivo);
      return;
    }
  }

  /** Nunca reenvia sozinho: verifica quando possível; senão alerta e espera decisão manual. */
  private async tratarIncerta(t: TarefaTransferencia, motivo: string): Promise<void> {
    const sender = this.senderDe(t);
    const v = sender.verify
      ? await sender.verify(t.chave).catch(() => "indeterminado" as const)
      : "indeterminado";
    if (v === "entregue") {
      this.mover(t, "enviada", "confirmada_na_verificacao");
    } else if (v === "nao_encontrada") {
      this.mover(t, "falhou", "nao_encontrada_na_verificacao");
      this.deps.notificador.alerta(
        "erro",
        `Tarefa ${t.id}: a mensagem NÃO foi encontrada no destino. Decida se deve reenviar (nada foi reenviado automaticamente).`,
      );
    } else {
      this.mover(t, "incerta", motivo);
      this.deps.notificador.alerta(
        "erro",
        `Tarefa ${t.id}: envio INCERTO (${motivo}). Verifique o destino e decida manualmente; nada será reenviado automaticamente.`,
      );
    }
  }

  /** Decisão humana sobre uma tarefa incerta. `reenviar` faz UMA nova tentativa de envio. */
  async decidirIncerta(
    id: string,
    decisao: "dar_como_enviada" | "descartar" | "reenviar",
  ): Promise<void> {
    const t = this.tarefas.get(id);
    if (!t || t.estado !== "incerta") throw new Error("Tarefa não está em estado incerta.");
    if (decisao === "dar_como_enviada") this.mover(t, "enviada", "decisao_manual");
    else if (decisao === "descartar") this.mover(t, "falhou", "descartada_manualmente");
    else {
      if (t.mensagem === undefined)
        throw new Error("A mensagem não está mais em memória; não é possível reenviar.");
      this.mover(t, "enviando", "reenvio_manual");
      let r;
      try {
        r = await this.senderDe(t).send(t.mensagem, t.chave);
      } catch {
        r = { tipo: "incerta", motivo: "excecao_no_envio" } as const;
      }
      if (r.tipo === "enviada") this.mover(t, "enviada");
      else if (r.tipo === "falhou") this.mover(t, "falhou", "envio_falhou");
      else this.mover(t, "incerta", r.motivo);
    }
  }

  /** Remove da memória tarefas terminadas há mais que o TTL (exceto incertas, que aguardam decisão). */
  limpar(): number {
    const agora = this.agora();
    let n = 0;
    for (const [id, t] of this.tarefas) {
      const ultimo = t.historico[t.historico.length - 1]?.em ?? 0;
      if (
        ESTADOS_TERMINAIS.has(t.estado) &&
        t.estado !== "incerta" &&
        agora - ultimo > this.op.ttlTarefasMs
      ) {
        this.tarefas.delete(id);
        n++;
      }
    }
    return n;
  }
}
