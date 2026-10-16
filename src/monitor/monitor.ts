import { mascararTelefone } from "../util/mascara.js";
import { SessaoExpiradaError, type TableReader } from "../dominio/tipos.js";
import type { TaskQueue } from "../fila/task-queue.js";
import type { Logger } from "../log/logger.js";
import type { Notificador } from "../notificador/notificador.js";
import type { CallTracker, EventoTracker } from "./call-tracker.js";

export interface OpcoesMonitor {
  intervaloMs: number;
  /** Leituras inválidas seguidas até avisar que a tabela está ilegível (possível mudança de layout). */
  invalidasParaAlertar: number;
  /** Falhas de leitura seguidas até alertar. */
  falhasParaAlertar: number;
  /** A cada quanto tempo limpar memória (tracker/fila). */
  limpezaMs: number;
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
export class Monitor {
  private invalidasSeguidas = 0;
  private todasIgnoradasSeguidas = 0;
  private falhasSeguidas = 0;
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
      await this.passo(agora);
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
    const { reader, tracker, log, notificador } = this.deps;
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
        );
      }
      return;
    }
    this.invalidasSeguidas = 0;
    if (snapshot.rowsIgnored) {
      log.debug("Linhas ignoradas nesta leitura", {
        evento: "linhas_ignoradas",
        contagem: snapshot.rowsIgnored,
      });
    }
    // Linha com dado faltando é normal e é só ignorada; mas se TODAS as linhas vêm ignoradas por muito tempo, avise.
    if (snapshot.rows.length === 0 && (snapshot.rowsIgnored ?? 0) > 0) {
      this.todasIgnoradasSeguidas++;
      if (this.todasIgnoradasSeguidas === this.op.invalidasParaAlertar) {
        notificador.alerta(
          "aviso",
          `Todas as linhas lidas estão sendo ignoradas há ${this.todasIgnoradasSeguidas} leituras (dados faltando ou layout diferente).`,
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
    );
  }

  private tratar(ev: EventoTracker): void {
    const { log, notificador, fila } = this.deps;
    if (ev.tipo === "transferencia") {
      log.info("Transferência detectada", {
        evento: "transferencia",
        idCurto: ev.ocorrencia,
        callbackMascarado: mascararTelefone(ev.callback),
      });
      if (!fila) {
        notificador.alerta(
          "aviso",
          "Transferência detectada (a consulta ao cliente ainda não está disponível nesta versão).",
        );
        return;
      }
      if (fila.enqueue(ev)) void fila.drenar();
    } else if (ev.tipo === "aviso") {
      log.warn("Aviso do rastreador", {
        evento: "aviso",
        codigo: ev.codigo,
        idCurto: ev.ocorrencia,
        callbackMascarado: ev.callbackMascarado,
      });
      notificador.alerta(
        "aviso",
        `Aviso (${ev.codigo}) para o funcionário ${ev.callbackMascarado}.`,
      );
    } else {
      log.warn("Anomalia na tabela", {
        evento: "anomalia",
        codigo: ev.codigo,
        callbackMascarado: ev.callbackMascarado,
      });
      notificador.alerta(
        "aviso",
        `Anomalia (${ev.codigo}): o mesmo Callback Number ${ev.callbackMascarado} apareceu em duas linhas. Linhas ignoradas.`,
      );
    }
  }
}
