import { mascararTelefone } from "../util/mascara.js";
import { SessaoExpiradaError, type TableReader, type TableSnapshot } from "../dominio/tipos.js";
import type { TaskQueue } from "../fila/task-queue.js";
import type { Logger } from "../log/logger.js";
import type { Notificador } from "../notificador/notificador.js";
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
  /** Apelidos dos funcionários: nos avisos, o funcionário aparece como "Nome (número)". */
  apelidos?: ReadonlyMap<string, string>;
  /** Stage de destino da transferência (padrão 3) e o dígito da linha exigido, só para os textos dos avisos. */
  destinoStage?: number;
  destinoDigito?: string;
  /**
   * Envio real ligado: a notificação do Windows de detecção não aparece (o som continua), porque a da mensagem enviada, que abre o
   * Telegram ao clicar, já avisa. Só vale quando há fila de mensagens (o que será de fato enviado).
   */
  toastSoDaEnviada?: boolean;
  /**
   * Vigia da página (precisa de `deps.recarregar`). Recarrega a página do site quando: não há ligação nenhuma há tantos ms
   * (`recargaOciosaMs`); a tabela tem ligações em andamento mas nada muda há tantos ms, ou seja, a tela congelou (`tabelaParadaMs`);
   * ou a leitura falha/vem ilegível tantas vezes seguidas (`leiturasRuinsParaRecarregar`). 0 = desligado (padrão).
   * Se recarregar por problema não resolver `recargasAntesDeReiniciar` vezes em 10 min, pede para reiniciar o programa inteiro.
   */
  recargaOciosaMs?: number;
  tabelaParadaMs?: number;
  leiturasRuinsParaRecarregar?: number;
  recargasAntesDeReiniciar?: number;
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
  /** Recarrega a página do site e devolve quando a tabela estiver de volta (refazendo o menu/login se preciso). */
  recarregar?: () => Promise<void>;
  /** O vigia não conseguiu consertar recarregando: o programa deve fechar para ser reaberto (pelo supervisor). */
  aoPrecisarReiniciar?: (motivo: string) => void;
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

/** Recargas por problema só contam como "seguidas" se a anterior foi há menos que isto. */
const JANELA_RECUPERACAO_MS = 10 * 60_000;

export class Monitor {
  private invalidasSeguidas = 0;
  private leiturasRuins = 0;
  private ultimaAtividade: number | null = null;
  private assinatura: string | null = null;
  private assinaturaDesde = 0;
  private recargasDeProblema = 0;
  private ultimoProblemaEm = 0;
  private reiniciarPedido = false;
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
      this.leiturasRuins++;
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
      await this.vigiarLeiturasRuins(agora);
      return;
    }

    if (!snapshot.valid) {
      this.invalidasSeguidas++;
      this.leiturasRuins++;
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
      await this.vigiarLeiturasRuins(agora);
      return;
    }
    this.invalidasSeguidas = 0;
    this.leiturasRuins = 0;
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
    await this.vigiarPagina(snapshot, agora);
  }

  /** Leituras falhando/ilegíveis por muito tempo: recarregar a página costuma resolver. */
  private async vigiarLeiturasRuins(agora: () => number): Promise<void> {
    const limite = this.op.leiturasRuinsParaRecarregar ?? 0;
    if (limite > 0 && this.leiturasRuins >= limite)
      await this.recarregar("leitura_falhando", true, agora);
  }

  /** Página ociosa (sem nenhuma ligação por muito tempo) ou congelada (ligações que não mudam): recarrega. */
  private async vigiarPagina(snapshot: TableSnapshot, agora: () => number): Promise<void> {
    const { tracker, fila } = this.deps;
    const t = agora();
    const ativo =
      snapshot.rows.length > 0 || tracker.ocorrenciasAtivas > 0 || fila?.ocupada === true;
    if (ativo || this.ultimaAtividade === null) this.ultimaAtividade = t;
    // Congelada: há duração correndo, e mesmo assim a tabela inteira está idêntica leitura após leitura.
    const correndo = snapshot.rows.some((r) => (r.callDurationSec ?? 0) > 0);
    const assinatura = correndo
      ? snapshot.rows
          .map((r) => `${r.callbackNumber}|${r.calleeNumber}|${r.callStatus}|${r.callDurationSec}`)
          .join(";")
      : null;
    if (assinatura === null || assinatura !== this.assinatura) {
      this.assinatura = assinatura;
      this.assinaturaDesde = t;
    } else if (
      (this.op.tabelaParadaMs ?? 0) > 0 &&
      t - this.assinaturaDesde >= (this.op.tabelaParadaMs ?? 0)
    ) {
      await this.recarregar("tabela_parada", true, agora);
      return;
    }
    const ociosaMs = this.op.recargaOciosaMs ?? 0;
    if (ociosaMs > 0 && !ativo && t - this.ultimaAtividade >= ociosaMs)
      await this.recarregar("ociosa", false, agora);
  }

  private async recarregar(motivo: string, problema: boolean, agora: () => number): Promise<void> {
    const { log, notificador, tracker } = this.deps;
    if (!this.deps.recarregar) return;
    if (problema) {
      if (agora() - this.ultimoProblemaEm > JANELA_RECUPERACAO_MS) this.recargasDeProblema = 0;
      this.ultimoProblemaEm = agora();
      this.recargasDeProblema++;
      if (this.recargasDeProblema > (this.op.recargasAntesDeReiniciar ?? 3)) {
        if (this.reiniciarPedido) return;
        this.reiniciarPedido = true;
        log.error("Recarregar a página não resolveu; pedindo para reiniciar o programa", {
          evento: "reinicio_necessario",
          motivo,
          contagem: this.recargasDeProblema,
        });
        notificador.alerta(
          "erro",
          "Recarregar a página do site não resolveu. O programa vai fechar para ser aberto de novo.",
          { windows: true },
        );
        this.deps.aoPrecisarReiniciar?.(motivo);
        return;
      }
      notificador.alerta(
        "aviso",
        motivo === "tabela_parada"
          ? "A tabela do site parou de atualizar (as durações não mudam). Vou recarregar a página."
          : "A leitura da tabela está falhando há muito tempo. Vou recarregar a página.",
        { windows: true },
      );
    }
    log.warn("Recarregando a página do site", {
      evento: "pagina_recarregada",
      motivo,
      contagem: this.recargasDeProblema,
    });
    const inicio = agora();
    try {
      await this.deps.recarregar();
    } catch (e) {
      log.error("Falha ao recarregar a página", {
        evento: "recarga_falhou",
        motivo: e instanceof Error ? e.message.slice(0, 120) : "desconhecido",
      });
    }
    tracker.marcarJanelaSemLeitura(); // houve um intervalo sem leitura: preserva as chamadas conhecidas
    this.leiturasRuins = 0;
    this.invalidasSeguidas = 0;
    this.falhasSeguidas = 0;
    this.assinatura = null;
    this.ultimaAtividade = agora();
    log.info("Página recarregada", {
      evento: "pagina_recarregada_ok",
      duracaoMs: agora() - inicio,
    });
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
    this.leiturasRuins = 0;
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
      const permitido = fila !== null;
      notificador.alerta(
        "aviso",
        `TRANSFERÊNCIA detectada${ev.fase === "ringing" ? ` (Stage ${this.op.destinoStage ?? 3} tocando)` : ""}: funcionário ${this.funcionarioVisivel(ev.callback)}, cliente ${numeroVisivel(ev.callee)}.`,
        { windows: this.op.toastSoDaEnviada === true && permitido ? false : "informativo" },
      );
      if (!permitido) return;
      if (fila.enqueue(ev)) this.iniciarFila(fila);
    } else if (ev.tipo === "callback") {
      log.info("CALLBACK detectado", {
        evento: "callback",
        motivo: ev.motivo,
        idCurto: ev.ocorrencia,
        callbackMascarado: mascararTelefone(ev.callback),
      });
      const permitido = fila !== null;
      notificador.alerta(
        "aviso",
        `${ev.motivo === "ligacao_curta" ? `LIGAÇÃO CURTA (CALLBACK, ${ev.duracaoSeg ?? "?"} s)` : "NINGUÉM ATENDEU (CALLBACK)"}: cliente ${numeroVisivel(ev.callee)}, funcionário ${this.funcionarioVisivel(ev.callback)}.`,
        { windows: this.op.toastSoDaEnviada === true && permitido ? false : "informativo" },
      );
      if (!permitido) return;
      if (fila.enqueue(ev)) this.iniciarFila(fila);
    } else if (ev.tipo === "ligacao_longa") {
      log.info("Ligação longa detectada", {
        evento: "ligacao_longa",
        idCurto: ev.ocorrencia,
        callbackMascarado: mascararTelefone(ev.callback),
      });
      const permitido = fila !== null;
      notificador.alerta(
        "aviso",
        `LIGAÇÃO LONGA (ainda no Stage 1): funcionário ${this.funcionarioVisivel(ev.callback)}, cliente ${numeroVisivel(ev.callee)}.`,
        { windows: this.op.toastSoDaEnviada === true && permitido ? false : "informativo_5min" },
      );
      if (!permitido) return;
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
