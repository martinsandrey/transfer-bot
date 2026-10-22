import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { criarNotificador } from "./notificador/notificador.js";
import { criarToastWindows } from "./notificador/toast-windows.js";
import { supervisionar } from "./supervisao.js";

/**
 * Abre o programa (`main.js`) e o reabre se ele fechar sozinho (queda, página travada que o vigia não resolveu...).
 * Usado pelo iniciar.bat. Para parar de vez: digite "sair", aperte Ctrl+C ou feche a janela.
 */
function principal(): void {
  const principalJs = fileURLToPath(new URL("./main.js", import.meta.url));
  const notificador = criarNotificador({ toast: criarToastWindows() });
  let parando = false;
  let filho: ChildProcess | null = null;
  const acordar: Array<() => void> = [];
  const parar = (): void => {
    parando = true;
    acordar.splice(0).forEach((f) => f());
  };
  // Ctrl+C chega ao programa e ao supervisor ao mesmo tempo (mesma janela): o programa se encerra sozinho.
  process.on("SIGINT", parar);
  for (const s of ["SIGTERM", "SIGHUP", "SIGBREAK"] as const)
    process.on(s, () => {
      parar();
      filho?.kill();
    });

  supervisionar({
    iniciar: () =>
      new Promise((resolve) => {
        filho = spawn(process.execPath, [principalJs, ...process.argv.slice(2)], {
          stdio: "inherit",
        });
        filho.on("error", () => resolve(1));
        filho.on("exit", (codigo) => resolve(codigo));
      }),
    esperar: (ms) =>
      new Promise((resolve) => {
        const t = setTimeout(resolve, ms);
        acordar.push(() => {
          clearTimeout(t);
          resolve();
        });
      }),
    escrever: (t) => process.stdout.write(t),
    alertar: (nivel, texto) => notificador.alerta(nivel, texto),
    parando: () => parando,
  }).then(
    (codigo) => process.exit(codigo),
    () => process.exit(1),
  );
}

principal();
