import type { NivelAlerta } from "./notificador/notificador.js";
import { SAIDAS_SEM_REINICIO } from "./util/saida.js";

export interface OpcoesSupervisor {
  /** Inicia o programa e devolve o código de saída (`null` = morreu por sinal/queda). */
  iniciar: () => Promise<number | null>;
  /** Espera `ms`; devolve cedo se o usuário pediu para parar. */
  esperar: (ms: number) => Promise<void>;
  escrever: (texto: string) => void;
  alertar: (nivel: NivelAlerta, texto: string) => void;
  /** O usuário pediu para parar (Ctrl+C, fechar a janela)? */
  parando: () => boolean;
  agora?: () => number;
  esperaMs?: number;
  /** No máximo tantas aberturas dentro da janela; passou disso, desiste (evita ficar abrindo e fechando sem parar). */
  maxAberturas?: number;
  janelaMs?: number;
}

/** Abre o programa e o reabre quando ele fecha sem o usuário pedir. Devolve o código de saída final. */
export async function supervisionar(op: OpcoesSupervisor): Promise<number> {
  const agora = op.agora ?? Date.now;
  const esperaMs = op.esperaMs ?? 5000;
  const maxAberturas = op.maxAberturas ?? 6;
  const janelaMs = op.janelaMs ?? 10 * 60_000;
  let aberturas: number[] = [];
  for (;;) {
    aberturas = [...aberturas.filter((t) => agora() - t < janelaMs), agora()];
    const codigo = await op.iniciar();
    if (op.parando()) return codigo ?? 0;
    if (codigo !== null && SAIDAS_SEM_REINICIO.includes(codigo)) return codigo;
    const quando = codigo === null ? "caiu" : `fechou (código ${codigo})`;
    if (aberturas.length >= maxAberturas) {
      op.escrever(
        `\nO programa ${quando} e já foi aberto ${aberturas.length} vezes em ${Math.round(janelaMs / 60_000)} minutos. Desisti de reabrir: veja o arquivo de log.\n`,
      );
      op.alertar(
        "erro",
        "O Transfer Bot ficou fechando sozinho e parou de ser reaberto. Veja o log.",
      );
      return codigo ?? 1;
    }
    op.escrever(
      `\nO programa ${quando} sem você pedir. Reabrindo em ${Math.round(esperaMs / 1000)} s (feche esta janela ou aperte Ctrl+C para cancelar)...\n`,
    );
    op.alertar(
      "aviso",
      "O Transfer Bot fechou sozinho e está sendo reaberto. Se o envio real estiver ligado, digite a senha de liberação na janela.",
    );
    await op.esperar(esperaMs);
    if (op.parando()) return 0;
  }
}
