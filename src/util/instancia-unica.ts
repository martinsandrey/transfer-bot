import { closeSync, mkdirSync, openSync, readFileSync, unlinkSync, writeSync } from "node:fs";
import { dirname } from "node:path";

export type ResultadoTrava = { ok: true; liberar: () => void } | { ok: false; pid: number };

/** `true` se existe um processo com esse PID (EPERM = existe, sem permissão para sinalizar). */
function processoVivo(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * Impede duas cópias do programa ao mesmo tempo (duas cópias enviariam cada mensagem duas vezes). Arquivo de trava com o PID;
 * se o PID guardado não existe mais (o programa anterior caiu), a trava velha é substituída.
 */
export function adquirirTrava(arquivo: string, pidAtual: number = process.pid): ResultadoTrava {
  mkdirSync(dirname(arquivo), { recursive: true });
  for (let tentativa = 0; tentativa < 3; tentativa++) {
    try {
      const fd = openSync(arquivo, "wx");
      writeSync(fd, String(pidAtual));
      closeSync(fd);
      let liberada = false;
      return {
        ok: true,
        liberar: () => {
          if (liberada) return;
          liberada = true;
          try {
            if (readFileSync(arquivo, "utf8").trim() === String(pidAtual)) unlinkSync(arquivo);
          } catch {
            /* já removida */
          }
        },
      };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      let pid: number;
      try {
        pid = Number(readFileSync(arquivo, "utf8").trim());
      } catch {
        continue; // sumiu entre a checagem e a leitura: tenta de novo
      }
      if (Number.isInteger(pid) && pid > 0 && pid !== pidAtual && processoVivo(pid))
        return { ok: false, pid };
      try {
        unlinkSync(arquivo); // trava velha (processo morto ou arquivo inválido)
      } catch {
        /* outro processo removeu */
      }
    }
  }
  return { ok: false, pid: 0 };
}
