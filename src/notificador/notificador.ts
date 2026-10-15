import { spawn } from "node:child_process";

export type NivelAlerta = "info" | "aviso" | "erro";

export interface Notificador {
  /** Alerta sonoro (quando `aviso`/`erro`) e mensagem no console. Nunca lança exceção. */
  alerta(nivel: NivelAlerta, mensagem: string): void;
}

type Spawn = typeof spawn;

const SOM_POWERSHELL: Record<Exclude<NivelAlerta, "info">, string> = {
  aviso: "[System.Media.SystemSounds]::Exclamation.Play(); Start-Sleep -Milliseconds 900",
  erro: "[System.Media.SystemSounds]::Hand.Play(); Start-Sleep -Milliseconds 900",
};

export interface OpcoesNotificador {
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
    alerta(nivel, mensagem) {
      const marca = nivel === "erro" ? "[ERRO]" : nivel === "aviso" ? "[AVISO]" : "[INFO]";
      escrever(`${marca} ${mensagem}\n`);
      if (nivel === "info") return;
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
  alertas: Array<{ nivel: NivelAlerta; mensagem: string }>;
} {
  const alertas: Array<{ nivel: NivelAlerta; mensagem: string }> = [];
  return { alertas, alerta: (nivel, mensagem) => void alertas.push({ nivel, mensagem }) };
}
