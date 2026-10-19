import { createInterface } from "node:readline";
import { gerarRegistro } from "./senha.js";
import { lerSenhaOculta } from "./senha-console.js";

/** `npm run gerar-hash-senha`: pede a senha (sem mostrar) e imprime o registro para colar em `REGISTRO_DA_SENHA`. */
async function principal(): Promise<void> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const a = await lerSenhaOculta(rl, "Nova senha: ");
  const b = await lerSenhaOculta(rl, "Repita a senha: ");
  rl.close();
  if (a === "" || a !== b) {
    console.error("\nAs senhas estão vazias ou diferentes. Nada foi gerado.");
    process.exitCode = 1;
    return;
  }
  console.log("\nCole no lugar de REGISTRO_DA_SENHA em src/seguranca/senha.ts:\n");
  console.log(JSON.stringify(gerarRegistro(a), null, 2));
}

void principal();
