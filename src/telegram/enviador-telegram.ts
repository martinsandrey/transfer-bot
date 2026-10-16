import type { MessageSender, ResultadoEnvio } from "../dominio/tipos.js";
import { FalhaTelegram, FloodWaitTelegram, type ClienteTelegram } from "./cliente.js";

export interface OpcoesEnviadorTelegram {
  destino: string;
  /** Tempo máximo esperando a resposta do envio; estourou = resultado DESCONHECIDO (incerta), nunca reenvio automático. */
  timeoutEnvioMs: number;
  /** FLOOD_WAIT até este limite é aguardado e o envio repetido uma vez (nada tinha sido enviado). */
  esperaMaximaFloodMs: number;
  /** Pausa antes de conferir o destino (padrão 3000). */
  esperaAntesDeVerificarMs?: number;
  dormir?: (ms: number) => Promise<void>;
  agora?: () => number;
}

class TempoEsgotado extends Error {}

function comPrazo<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new TempoEsgotado()), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(t);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}

/**
 * `MessageSender` sobre o Telegram. Regras:
 * - sucesso (ID de mensagem devolvido) → `enviada`;
 * - FLOOD_WAIT e falhas definitivas → `falhou` (nada saiu);
 * - timeout/erro de rede/qualquer coisa inesperada → `incerta` (pode ter saído; a fila chama `verify`, nunca reenvia sozinha).
 * A memória guarda, só até o fim do processo, o texto e a hora de cada chave para a verificação (o Telegram é o histórico).
 */
export class EnviadorTelegram implements MessageSender {
  private readonly pendentes = new Map<string, { texto: string; desde: number }>();
  private readonly dormir: (ms: number) => Promise<void>;
  private readonly agora: () => number;

  constructor(
    private readonly cliente: ClienteTelegram,
    private readonly op: OpcoesEnviadorTelegram,
  ) {
    this.dormir = op.dormir ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.agora = op.agora ?? (() => Math.floor(Date.now() / 1000));
  }

  async send(texto: string, chave: string): Promise<ResultadoEnvio> {
    this.pendentes.set(chave, { texto, desde: this.agora() - 5 });
    for (let tentativa = 1; ; tentativa++) {
      try {
        const r = await comPrazo(
          this.cliente.enviar(this.op.destino, texto),
          this.op.timeoutEnvioMs,
        );
        this.pendentes.delete(chave);
        return { tipo: "enviada", confirmacao: `telegram:${r.id}` };
      } catch (e) {
        if (e instanceof FloodWaitTelegram) {
          if (tentativa === 1 && e.segundos * 1000 <= this.op.esperaMaximaFloodMs) {
            await this.dormir(e.segundos * 1000 + 500);
            continue;
          }
          this.pendentes.delete(chave);
          return { tipo: "falhou", motivo: `flood_wait_${e.segundos}s`, reenviavel: false };
        }
        if (e instanceof FalhaTelegram) {
          this.pendentes.delete(chave);
          return { tipo: "falhou", motivo: e.message, reenviavel: e.reenviavel };
        }
        return {
          tipo: "incerta",
          motivo: e instanceof TempoEsgotado ? "timeout_no_envio" : "erro_durante_o_envio",
        };
      }
    }
  }

  async verify(chave: string): Promise<"entregue" | "nao_encontrada" | "indeterminado"> {
    const p = this.pendentes.get(chave);
    if (!p) return "indeterminado";
    await this.dormir(this.op.esperaAntesDeVerificarMs ?? 3000); // dá tempo de um envio atrasado aparecer
    try {
      const recentes = await comPrazo(
        this.cliente.mensagensRecentes(this.op.destino, 20),
        this.op.timeoutEnvioMs,
      );
      const achou = recentes.some((m) => m.data >= p.desde && m.texto === p.texto);
      if (achou) {
        this.pendentes.delete(chave);
        return "entregue";
      }
      return "nao_encontrada";
    } catch {
      return "indeterminado";
    }
  }
}
