import { mascararTelefone } from "../util/mascara.js";
import { SessaoExpiradaError, type TableReader } from "../dominio/tipos.js";
import type { TaskQueue } from "../fila/task-queue.js";
import type { Logger } from "../log/logger.js";
import type { Notificador } from "../notificador/notificador.js";
import { SEM_FILTRO, decidirFiltro, type FiltroFuncionarios } from "./filtro-funcionario.js";
import type { CallTracker, CodigoAviso, EventoTracker } from "./call-tracker.js";

export interface OpcoesMonitor {
  intervaloMs: number;
  /** Leituras inválidas seguidas até avisar que a tabela está ilegível (possível mudança de layout). */
  invalidasParaAlertar: number;
  /** Falhas de leitura seguidas até alertar. */
  falhasParaAlertar: number;
  /** A cada quanto tempo limpar memória (tracker/fila). */
  limpezaMs: number;
  /**
   * A consulta ao cliente TROCA a página atual (menu → Customer Data List), então a tabela de chamadas não pode ser lida enquanto ela
   * roda. Com `true`, o monitor não lê durante a consulta (sem confundir com sessão expirada) e, ao voltar, o rastreador não conta
   * ausências nem avança confirmações. Chamadas que começam e terminam inteiramente dentro da consulta não são vistas.
   */
  pausarDuranteConsulta?: boolean;
  /** Quais funcionários (penúltimo dígito do Callback Number do Stage 1) geram mensagem em cada grupo. Ausente = todos. */
  filtroFuncionarios?: FiltroFuncionarios;
  /** Apelidos dos funcionários: nos avisos, o funcionário aparece como "Nome (número)". */
  apelidos?: ReadonlyMap<string, string>;
  /** Stage de destino da transferência (padrão 3) e o dígito da linha exigido, só para os textos dos avisos. */
  destinoStage?: number;
  destinoDigito?: string;
  agora?: () => number;
  dormir?: (ms: number, sinal: AbortSignal) => Promise<void>;
}

export interface DepsMonitor {
  reader: TableReader;
  tracker: CallTracker;
  /** Sem fila (ex.: consulta ao cliente ainda não implementada), só avisa a transferência. */
  fila: TaskQueue | null;
  log: Logger;
  notificador: Notificador;
  /** Chamado quando a sessão expira; deve devolver quando o login for refeito. */
  aoPerderSessao?: () => Promise<void>;
  /** Evento que NÃO gerou mensagem por causa do filtro de funcionários (para o relatório ainda contá-lo). Tem telefones: não vai para o log. */
  aoFiltrar?: (info: {
    tipo: "transferencia" | "callback" | "longa";
    callback: string;
    callee: string;
    vinculo: string;
    detalhe?: string;
  }) => void;
}

export function dormirComSinal(ms: number, sinal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (sinal.aborted) return resolve();
    const t = setTimeout(done, ms);
    function done(): void {
      clearTimeout(t);
      sinal.removeEventListener("abort", done);
      resolve();
    }
    sinal.addEventListener("abort", done);
  });
}

/**
 * Laço de monitoramento: lê, alimenta o tracker e encaminha eventos. A consulta ao cliente roda em segundo plano
 * (`fila.drenar()` sem `await`), então o monitor continua lendo enquanto uma tarefa é processada.
 */
/** Telefone como aparece ao usuário (tela e notificações): sempre por inteiro. Só os arquivos de log mascaram. */
const numeroVisivel = (valor: string): string => valor.trim();

export class Monitor {
  private invalidasSeguidas = 0;
  private emPausa = false;
  private todasIgnoradasSeguidas = 0;
  private falhasSeguidas = 0;
  private errosDoLaco = 0;
  private ultimaLimpeza = 0;

  constructor(
    private readonly deps: DepsMonitor,
    private readonly op: OpcoesMonitor,
  ) {}

  async executar(sinal: AbortSignal): Promise<void> {
    const agora = this.op.agora ?? Date.now;
    const dormir = this.op.dormir ?? dormirComSinal;
    this.ultimaLimpeza = agora();
    while (!sinal.aborted) {
      const inicio = agora();
      try {
        await this.passo(agora);
        this.errosDoLaco = 0;
      } catch (e) {
        // Um erro inesperado num passo NUNCA derruba o monitoramento: registra, avisa (sem spam) e segue para a próxima leitura.
        this.errosDoLaco++;
        this.deps.log.error("Erro inesperado no passo do monitor", {
          evento: "erro_no_passo",
          contagem: this.errosDoLaco,
          motivo: e instanceof Error ? e.message : "desconhecido",
        });
        if (this.errosDoLaco === 1 || this.errosDoLaco % 30 === 0)
          this.deps.notificador.alerta(
            "erro",
            `Erro inesperado no monitoramento (${this.errosDoLaco}ª vez seguida). O programa continua tentando. Detalhes no arquivo de log.`,
          );
      }
      if (agora() - this.ultimaLimpeza >= this.op.limpezaMs) {
        this.deps.tracker.sweep(agora());
        this.deps.fila?.limpar();
        this.ultimaLimpeza = agora();
      }
      await dormir(Math.max(0, this.op.intervaloMs - (agora() - inicio)), sinal);
    }
  }

  /** Uma leitura. Exposto para testes. */
  async passo(agora: () => number = Date.now): Promise<void> {
    const { reader, tracker, log, notificador, fila } = this.deps;
    if (this.op.pausarDuranteConsulta && fila?.ocupada) {
      this.emPausa = true; // a aba está na consulta ao cliente: não há tabela de chamadas para ler agora
      return;
    }
    if (this.emPausa) {
      this.emPausa = false;
      tracker.marcarJanelaSemLeitura(); // voltamos de uma janela sem leitura: preserva as chamadas conhecidas
    }
    let snapshot;
    try {
      snapshot = await reader.read();
      this.falhasSeguidas = 0;
    } catch (e) {
      if (e instanceof SessaoExpiradaError) {
        await this.tratarSessaoExpirada(agora);
        return;
      }
      this.falhasSeguidas++;
      log.warn("Falha ao ler a tabela", {
        evento: "leitura_falhou",
        contagem: this.falhasSeguidas,
      });
      if (this.falhasSeguidas === this.op.falhasParaAlertar) {
        notificador.alerta(
          "erro",
          `A leitura da tabela falhou ${this.falhasSeguidas} vezes seguidas.`,
        );
      }
      return;
    }

    if (!snapshot.valid) {
      this.invalidasSeguidas++;
      log.debug("Leitura inválida descartada", {
        evento: "leitura_invalida",
        motivo: snapshot.invalidReason ?? "desconhecido",
        contagem: this.invalidasSeguidas,
      });
      if (this.invalidasSeguidas === this.op.invalidasParaAlertar) {
        notificador.alerta(
          "aviso",
          `A tabela está ilegível há ${this.invalidasSeguidas} leituras (${snapshot.invalidReason ?? "motivo desconhecido"}). O layout do site pode ter mudado.`,
          { windows: true },
        );
      }
      return;
    }
    this.invalidasSeguidas = 0;
    // Linha com dado faltando é normal e é só ignorada; mas se TODAS as linhas vêm ignoradas por muito tempo, avise.
    // Tabela vazia (só a linha-aviso) e linhas Stage 2/3/4 com um dado faltando são normais e não contam: só as inexplicadas.
    if (
      snapshot.rows.length === 0 &&
      (snapshot.rowsIgnoredUnexplained ?? snapshot.rowsIgnored ?? 0) > 0
    ) {
      this.todasIgnoradasSeguidas++;
      if (this.todasIgnoradasSeguidas === this.op.invalidasParaAlertar) {
        const motivos = snapshot.rowsIgnoredReasons ?? "";
        log.warn("Todas as linhas lidas estão sendo ignoradas", {
          evento: "linhas_ignoradas",
          contagem: this.todasIgnoradasSeguidas,
          ...(motivos ? { motivo: motivos } : {}),
        });
        notificador.alerta(
          "aviso",
          `Todas as linhas lidas estão sendo ignoradas há ${this.todasIgnoradasSeguidas} leituras (dados faltando ou layout diferente)${motivos ? `. Motivos: ${motivos}` : ""}.`,
        );
      }
    } else {
      this.todasIgnoradasSeguidas = 0;
    }
    for (const ev of tracker.ingest(snapshot)) this.tratar(ev);
  }

  private async tratarSessaoExpirada(agora: () => number): Promise<void> {
    const { log, notificador, tracker } = this.deps;
    const inicio = agora();
    log.warn("Sessão do site expirada; monitoramento pausado", { evento: "sessao_expirada" });
    notificador.alerta("erro", "Sessão do site expirada. Monitoramento pausado até o login.");
    if (this.deps.aoPerderSessao) await this.deps.aoPerderSessao();
    tracker.reiniciarBaseline();
    this.invalidasSeguidas = 0;
    this.falhasSeguidas = 0;
    log.warn("Monitoramento retomado com nova linha de base; houve janela sem monitoramento", {
      evento: "janela_sem_monitoramento",
      duracaoMs: agora() - inicio,
    });
    notificador.alerta(
      "aviso",
      "Monitoramento retomado. Transferências ocorridas durante a pausa NÃO foram detectadas.",
      { windows: true },
    );
  }

  /** Processa a fila em segundo plano; qualquer erro é registrado (nunca vira "unhandled rejection" que derruba o programa). */
  private iniciarFila(fila: TaskQueue): void {
    fila.drenar().catch((e: unknown) => {
      this.deps.log.error("Erro inesperado na fila", {
        evento: "erro_na_fila",
        motivo: e instanceof Error ? e.message : "desconhecido",
      });
      this.deps.notificador.alerta(
        "erro",
        "Erro inesperado na fila de mensagens. Detalhes no arquivo de log.",
      );
    });
  }

  /** Aplica o filtro por funcionário (`.env`). O CALLBACK segue o filtro das transferências: ele responde à mensagem de transferência. */
  private funcionarioPermitido(
    ev: Extract<EventoTracker, { tipo: "transferencia" | "callback" | "ligacao_longa" }>,
    grupo: "transferencia" | "callback" | "longa",
  ): boolean {
    const filtro = this.op.filtroFuncionarios ?? SEM_FILTRO;
    const permitidos = grupo === "longa" ? filtro.longa : filtro.transferencia;
    const decisao = decidirFiltro(permitidos, ev.callback);
    if (decisao === "enviar") return true;
    try {
      this.deps.aoFiltrar?.({
        tipo: grupo === "longa" ? "longa" : grupo === "callback" ? "callback" : "transferencia",
        callback: ev.callback,
        callee: ev.callee,
        vinculo: ev.vinculo,
        ...(ev.tipo === "callback"
          ? {
              detalhe: `CALLBACK (${ev.motivo === "ligacao_curta" && ev.duracaoSeg !== undefined ? `ligação de ${ev.duracaoSeg} s` : "ninguém atendeu"})`,
            }
          : {}),
      });
    } catch {
      /* o registro nunca atrapalha o monitoramento */
    }
    this.deps.log.info("Mensagem não gerada: funcionário fora do filtro", {
      evento: "funcionario_filtrado",
      idCurto: ev.ocorrencia,
      grupo,
      motivo: decisao,
      callbackMascarado: mascararTelefone(ev.callback),
    });
    if (decisao === "indeterminado" && grupo !== "callback") {
      this.deps.notificador.alerta(
        "aviso",
        `O Callback Number ${this.funcionarioVisivel(ev.callback)} não tem dígitos suficientes para saber de quem é o funcionário; a mensagem do grupo ${grupo === "longa" ? "de 5 minutos" : "de transferências"} não foi gerada.`,
      );
    }
    return false;
  }

  private funcionarioVisivel(callback: string): string {
    const nome = this.op.apelidos?.get(callback.replace(/\D+/g, ""));
    return nome ? `${nome} (${callback.trim()})` : callback.trim();
  }

  private tratar(ev: EventoTracker): void {
    const { log, notificador, fila } = this.deps;
    if (ev.tipo === "transferencia") {
      log.info("Transferência detectada", {
        evento: "transferencia",
        idCurto: ev.ocorrencia,
        callbackMascarado: mascararTelefone(ev.callback),
      });
      notificador.alerta(
        "aviso",
        `TRANSFERÊNCIA detectada${ev.fase === "ringing" ? ` (Stage ${this.op.destinoStage ?? 3} tocando)` : ""}: funcionário ${this.funcionarioVisivel(ev.callback)}, cliente ${numeroVisivel(ev.callee)}.`,
        { windows: "informativo" },
      );
      if (!fila || !this.funcionarioPermitido(ev, "transferencia")) return;
      if (fila.enqueue(ev)) this.iniciarFila(fila);
    } else if (ev.tipo === "callback") {
      log.info("CALLBACK detectado", {
        evento: "callback",
        motivo: ev.motivo,
        idCurto: ev.ocorrencia,
        callbackMascarado: mascararTelefone(ev.callback),
      });
      notificador.alerta(
        "aviso",
        `${ev.motivo === "ligacao_curta" ? `LIGAÇÃO CURTA (CALLBACK, ${ev.duracaoSeg ?? "?"} s)` : "NINGUÉM ATENDEU (CALLBACK)"}: cliente ${numeroVisivel(ev.callee)}, funcionário ${this.funcionarioVisivel(ev.callback)}.`,
        { windows: "informativo" },
      );
      if (!fila || !this.funcionarioPermitido(ev, "callback")) return;
      if (fila.enqueue(ev)) this.iniciarFila(fila);
    } else if (ev.tipo === "ligacao_longa") {
      log.info("Ligação longa detectada", {
        evento: "ligacao_longa",
        idCurto: ev.ocorrencia,
        callbackMascarado: mascararTelefone(ev.callback),
      });
      notificador.alerta(
        "aviso",
        `LIGAÇÃO LONGA (ainda no Stage 1): funcionário ${this.funcionarioVisivel(ev.callback)}, cliente ${numeroVisivel(ev.callee)}.`,
        { windows: "informativo_5min" },
      );
      if (!fila || !this.funcionarioPermitido(ev, "longa")) return;
      if (fila.enqueue(ev)) this.iniciarFila(fila);
    } else if (ev.tipo === "aviso") {
      log.warn("Aviso do rastreador", {
        evento: "aviso",
        codigo: ev.codigo,
        idCurto: ev.ocorrencia,
        callbackMascarado: ev.callbackMascarado,
      });
      notificador.alerta(
        "aviso",
        descreverAviso(
          ev.codigo,
          ev.callbackMascarado,
          this.op.destinoStage,
          this.op.destinoDigito,
        ),
      );
    } else {
      log.warn("Anomalia na tabela", {
        evento: "anomalia",
        codigo: ev.codigo,
        callbackMascarado: ev.callbackMascarado,
      });
      notificador.alerta(
        "aviso",
        `O mesmo Callback Number ${ev.callbackMascarado} apareceu em duas linhas ao mesmo tempo. Ignorei essas linhas.`,
      );
    }
  }
}

/** Texto em português simples para cada aviso do rastreador. */
export function descreverAviso(
  codigo: CodigoAviso,
  funcionario: string,
  destino = 3,
  digito?: string,
): string {
  switch (codigo) {
    case "visto_primeira_vez_stage3":
      return `Uma chamada apareceu direto em Stage ${destino} (funcionário do Stage ${destino}: ${funcionario}) sem eu ter visto a origem em Stage 1 Agent. Nenhuma mensagem foi gerada.`;
    case "destino_fora_da_linha":
      return `Uma chamada passou do Stage 1 para o Stage ${destino}, mas o funcionário que pegou (${funcionario}) não é da linha ${digito ?? "esperada"} (o antepenúltimo dígito do número dele não é ${digito ?? "o esperado"}). Nenhuma mensagem foi gerada.`;
    case "sequencia_inesperada":
      return `Mudança de status inesperada numa chamada (funcionário ${funcionario}). Nenhuma mensagem foi gerada.`;
    case "status_desconhecido":
      return `Status desconhecido numa chamada (funcionário ${funcionario}).`;
    case "transferencia_duplicada":
      return `Transferência repetida ignorada (funcionário ${funcionario}).`;
  }
}
