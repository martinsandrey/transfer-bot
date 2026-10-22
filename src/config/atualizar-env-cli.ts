import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { acrescentarFaltantes } from "./atualizar-env.js";

/** Usado pelo atualizar.bat: acrescenta ao .env as variáveis novas do .env.example, sem mexer no que já existe. */
function principal(): void {
  if (!existsSync(".env") || !existsSync(".env.example")) return;
  const env = readFileSync(".env", "utf8");
  const { texto, adicionadas } = acrescentarFaltantes(env, readFileSync(".env.example", "utf8"));
  if (adicionadas.length === 0) {
    console.log("O seu .env já tem todas as variáveis.");
    return;
  }
  copyFileSync(".env", ".env.bak"); // cópia do arquivo como estava antes
  writeFileSync(".env", texto, "utf8");
  console.log(
    `Acrescentei ao seu .env ${adicionadas.length} variável(is) nova(s) com o valor padrão: ${adicionadas.join(", ")}.\nSeus valores anteriores não foram alterados (cópia em .env.bak).`,
  );
}

try {
  principal();
} catch (e) {
  console.error(`Não consegui atualizar o .env: ${e instanceof Error ? e.message : String(e)}`);
}
