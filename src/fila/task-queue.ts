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
  pronta: ["enviando", "observada", "falhou"],
  enviando: ["enviada", "incerta", "falhou"],
  enviada: [],
  observada: [],
  incerta: ["enviada", "enviando", "falhou"], // só por decisão manual
  falhou: [],
  ignorada: [],
};

export interface TarefaTransferencia {
  id: string;
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
  /** Pausa entre uma tarefa e a próxima, para o monitor voltar a ler a tabela de chamadas entre as consultas (padrão 3 s). */
  pausaEntreTarefasMs?: number;
  agora?: () => number;
  dormir?: (ms: number) => Promise<void>;
  /** Prévia no console (modo observação). Pode conter dados do cliente: nunca vai para o log. */
  previa?: (texto: string) => void;
}

export interface DepsFila {
  lookup: CustomerLookup;
  construtor: ConstrutorDeMensagem;
  sender: MessageSender;
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
  enqueue(ev: Extract<EventoTracker, { tipo: "transferencia" }>): TarefaTransferencia | null {
    for (const t of this.tarefas.values()) if (t.chave === ev.chave) return null;
    const t: TarefaTransferencia = {
      id: `t${++this.seq}`,
      chave: ev.chave,
      estado: "detectada",
      callback: ev.callback,
      callee: ev.callee,
      tentativasConsulta: 0,
      tentativasEnvio: 0,
      historico: [{ estado: "detectada", em: this.agora() }],
    };
    this.tarefas.set(t.id, t);
    this.mover(t, "na_fila");
    return t;
  }

  private mover(t: TarefaTransferencia, novo: EstadoTarefa, motivo?: string): void {
    if (!TRANSICOES[t.estado].includes(novo))
      throw new Error(`Transição de tarefa inválida: ${t.estado} → ${novo}`);
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
      this.drenando = this.laco().finally(() => {
        this.drenando = null;
      });
    }
    return this.drenando;
  }

  private async laco(): Promise<void> {
    let primeira = true;
    for (;;) {
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
    const busca = await this.pesquisar(t);
    if (!busca) return;
    if (busca.tipo === "nenhum") {
      this.mover(t, "ignorada", "cliente_nao_encontrado");
      this.deps.notificador.alerta(
        "erro",
        `Tarefa ${t.id}: nenhum cliente encontrado para o Callee Number. Nada foi enviado.`,
      );
      return;
    }
    if (busca.tipo === "telefone_divergente") {
      this.mover(t, "ignorada", "telefone_divergente");
      this.deps.notificador.alerta(
        "erro",
        `Tarefa ${t.id}: telefone do cadastro diferente do Callee Number (cliente errado). Nada foi enviado.`,
      );
      return;
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
      return;
    }
    this.mover(t, "pronta");

    if (this.op.modo === "observacao") {
      this.op.previa?.(t.mensagem);
      this.mover(t, "observada");
      return;
    }
    await this.enviar(t);
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
      t.tentativasEnvio++;
      let resultado;
      try {
        resultado = await this.deps.sender.send(t.mensagem, t.chave);
      } catch {
        resultado = { tipo: "incerta", motivo: "excecao_no_envio" } as const; // não sabemos se saiu
      }
      if (resultado.tipo === "enviada") {
        this.mover(t, "enviada");
        return;
      }
      if (resultado.tipo === "falhou") {
        if (resultado.reenviavel && t.tentativasEnvio < this.op.maxTentativasEnvio) {
          await this.dormir(this.op.backoffMs * 2 ** (t.tentativasEnvio - 1));
          continue;
        }
        this.mover(t, "falhou", "envio_falhou");
        this.deps.notificador.alerta(
          "erro",
          `Tarefa ${t.id}: o envio falhou. Nenhuma mensagem foi entregue.`,
        );
        return;
      }
      await this.tratarIncerta(t, resultado.motivo);
      return;
    }
  }

  /** Nunca reenvia sozinho: verifica quando possível; senão alerta e espera decisão manual. */
  private async tratarIncerta(t: TarefaTransferencia, motivo: string): Promise<void> {
    const v = this.deps.sender.verify
      ? await this.deps.sender.verify(t.chave).catch(() => "indeterminado" as const)
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
        r = await this.deps.sender.send(t.mensagem, t.chave);
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
