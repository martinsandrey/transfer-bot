import { spawn } from "node:child_process";
import type { Toast } from "./toast-windows.js";

export type NivelAlerta = "info" | "aviso" | "erro";

/**
 * Quando o alerta também vira notificação do Windows (além do console e do som):
 * - `erro`: sempre (algo deu errado e merece atenção);
 * - `aviso`: só com `windows: true` (relevante e que pede ação ou muda o que o programa está fazendo);
 * - `windows: "informativo"`: só se o usuário ligou as notificações de transferência (transferência detectada e CALLBACK);
 * - `windows: "informativo_5min"`: só se o usuário ligou as notificações de ligações de 5 minutos;
 * - `windows: false`: nunca.
 */
export interface OpcoesAlerta {
  windows?: boolean | "informativo" | "informativo_5min";
  /** Clicar na notificação do Windows abre este endereço `tg://` (o Telegram, direto na mensagem). */
  link?: string;
  /** Sem o som de aviso (a notificação é só um complemento). */
  semSom?: boolean;
}

export interface Notificador {
  /** Alerta sonoro (quando `aviso`/`erro`), mensagem no console e, se for relevante, notificação do Windows. Nunca lança exceção. */
  alerta(nivel: NivelAlerta, mensagem: string, opcoes?: OpcoesAlerta): void;
}

type Spawn = typeof spawn;

const SOM_POWERSHELL: Record<Exclude<NivelAlerta, "info">, string> = {
  aviso: "[System.Media.SystemSounds]::Exclamation.Play(); Start-Sleep -Milliseconds 900",
  erro: "[System.Media.SystemSounds]::Hand.Play(); Start-Sleep -Milliseconds 900",
};

export interface OpcoesNotificador {
  /** Função que mostra a notificação do Windows (ver `criarToastWindows`). Sem ela, não há notificações. */
  toast?: Toast;
  /** Também notifica cada transferência detectada e cada CALLBACK. Padrão: não. */
  toastInformativos?: boolean;
  /** Também notifica cada ligação que chegou a 5 min. Padrão: não. */
  toastLigacoesLongas?: boolean;
  plataforma?: NodeJS.Platform;
  spawnFn?: Spawn;
  escrever?: (texto: string) => void;
}

/**
 * Som via PowerShell no Windows (sem dependências); em outros sistemas, apenas o caractere BEL.
 * TODO(confirmar no Windows): audibilidade e comportamento com o Defender — roteiro de validação da Fase 2.
 */
export function criarNotificador(op: OpcoesNotificador = {}): Notificador {
  const plataforma = op.plataforma ?? process.platform;
  const spawnFn = op.spawnFn ?? spawn;
  const escrever = op.escrever ?? ((t: string) => process.stdout.write(t));

  return {
    alerta(nivel, mensagem, opcoes) {
      const marca = nivel === "erro" ? "[ERRO]" : nivel === "aviso" ? "[AVISO]" : "[INFO]";
      const hora = new Date().toLocaleTimeString("pt-BR", { hour12: false });
      escrever(`${hora} ${marca} ${mensagem}\n`);
      if (nivel === "info") return;
      try {
        const w = opcoes?.windows;
        const notificar =
          w === false
            ? false
            : w === "informativo"
              ? op.toastInformativos === true
              : w === "informativo_5min"
                ? op.toastLigacoesLongas === true
                : nivel === "erro" || w === true;
        if (notificar && op.toast)
          op.toast(
            nivel === "erro" ? "Transfer Bot — ERRO" : "Transfer Bot — atenção",
            mensagem,
            opcoes?.link,
          );
      } catch {
        /* a notificação nunca atrapalha o resto */
      }
      if (opcoes?.semSom === true) return;
      try {
        if (plataforma === "win32") {
          const filho = spawnFn(
            "powershell.exe",
            ["-NoProfile", "-NonInteractive", "-Command", SOM_POWERSHELL[nivel]],
            {
              stdio: "ignore",
              windowsHide: true,
            },
          );
          filho.on("error", () => escrever("\x07"));
          filho.unref();
        } else {
          escrever("\x07");
        }
      } catch {
        escrever("\x07");
      }
    },
  };
}

/** Notificador para testes: guarda os alertas. */
export function criarNotificadorFalso(): Notificador & {
  alertas: Array<{ nivel: NivelAlerta; mensagem: string; opcoes?: OpcoesAlerta }>;
} {
  const alertas: Array<{ nivel: NivelAlerta; mensagem: string; opcoes?: OpcoesAlerta }> = [];
  return {
    alertas,
    alerta: (nivel, mensagem, opcoes) =>
      void alertas.push({ nivel, mensagem, ...(opcoes ? { opcoes } : {}) }),
  };
}
