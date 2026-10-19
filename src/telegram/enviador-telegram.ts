import type { MessageSender, OpcoesEnvio, ResultadoEnvio } from "../dominio/tipos.js";
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

/** O Telegram tira espaços e linhas em branco das pontas e usa \n: compara sem essas diferenças. */
export function normalizarTextoDeMensagem(t: string): string {
  return t.replace(/\r\n?/g, "\n").trim();
}

/** Tolerância entre o relógio do PC e o do Telegram ao conferir uma mensagem (um PC adiantado/atrasado não pode causar reenvio). */
const TOLERANCIA_RELOGIO_S = 15 * 60;
/** Mesmo texto enviado e confirmado dentro deste prazo NÃO é enviado de novo (trava contra duplicata por reenvio/evento repetido). */
const JANELA_ANTI_DUPLICATA_S = 60;

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
  /** Textos já enviados com sucesso (normalizados): trava anti-duplicata de curta duração. */
  private readonly enviadosHa = new Map<string, { em: number; confirmacao: string }>();
  private readonly dormir: (ms: number) => Promise<void>;
  private readonly agora: () => number;

  constructor(
    private readonly cliente: ClienteTelegram,
    private readonly op: OpcoesEnviadorTelegram,
  ) {
    this.dormir = op.dormir ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.agora = op.agora ?? (() => Math.floor(Date.now() / 1000));
  }

  async send(texto: string, chave: string, opcoes?: OpcoesEnvio): Promise<ResultadoEnvio> {
    let respostaA = /^telegram:(\d+)$/.exec(opcoes?.responderA ?? "")?.[1];
    let corpo = texto;
    const agoraS = this.agora();
    for (const [k, v] of this.enviadosHa)
      if (agoraS - v.em > JANELA_ANTI_DUPLICATA_S) this.enviadosHa.delete(k);
    const jaEnviado = this.enviadosHa.get(`${respostaA ?? ""}|${normalizarTextoDeMensagem(texto)}`);
    if (jaEnviado) return { tipo: "enviada", confirmacao: jaEnviado.confirmacao }; // mesma mensagem há instantes: não duplica
    this.pendentes.set(chave, { texto: corpo, desde: this.agora() - 5 });
    let esperouFlood = false;
    for (;;) {
      try {
        const r = await comPrazo(
          this.cliente.enviar(
            this.op.destino,
            corpo,
            respostaA === undefined ? undefined : Number(respostaA),
          ),
          this.op.timeoutEnvioMs,
        );
        this.pendentes.delete(chave);
        const confirmacao = `telegram:${r.id}`;
        this.enviadosHa.set(`${respostaA ?? ""}|${normalizarTextoDeMensagem(corpo)}`, {
          em: this.agora(),
          confirmacao,
        });
        return { tipo: "enviada", confirmacao };
      } catch (e) {
        if (e instanceof FloodWaitTelegram) {
          if (!esperouFlood && e.segundos * 1000 <= this.op.esperaMaximaFloodMs) {
            esperouFlood = true;
            await this.dormir(e.segundos * 1000 + 500);
            continue;
          }
          this.pendentes.delete(chave);
          return { tipo: "falhou", motivo: `flood_wait_${e.segundos}s`, reenviavel: false };
        }
        if (e instanceof FalhaTelegram) {
          if (e.message === "resposta_invalida" && respostaA !== undefined) {
            // A mensagem a que se ia responder não existe mais (nada foi enviado): manda o texto de reserva, sem resposta.
            respostaA = undefined;
            corpo = opcoes?.reserva ?? texto;
            this.pendentes.set(chave, { texto: corpo, desde: this.agora() - 5 });
            continue;
          }
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
      const alvo = normalizarTextoDeMensagem(p.texto);
      const achou = recentes.some(
        (m) =>
          m.data >= p.desde - TOLERANCIA_RELOGIO_S && normalizarTextoDeMensagem(m.texto) === alvo,
      );
      if (achou) {
        this.pendentes.delete(chave);
        return "entregue";
      }
      return "nao_encontrada";
    } catch {
      return "indeterminado";
    }
  }

  /** Texto atual de uma mensagem que este enviador mandou (`telegram:<id>`), inclusive se a pessoa a editou depois. */
  async reler(confirmacao: string): Promise<string | "apagada" | null> {
    const id = /^telegram:(\d+)$/.exec(confirmacao)?.[1];
    if (id === undefined) return null;
    try {
      const t = await comPrazo(
        this.cliente.lerMensagem(this.op.destino, Number(id)),
        this.op.timeoutEnvioMs,
      );
      return t === null ? "apagada" : t;
    } catch {
      return null;
    }
  }
}
