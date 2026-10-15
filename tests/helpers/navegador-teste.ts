import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { iniciarNavegador, type HospedeNavegador } from "../../src/navegador/navegador.js";

const CANDIDATOS = [process.env["TB_CHROMIUM_PATH"], "/opt/pw-browsers/chromium"].filter(
  (x): x is string => !!x,
);
export const CHROMIUM_DE_TESTE = CANDIDATOS.find((c) => existsSync(c));

/** Abre um navegador sem janela, com perfil temporário. Só para testes. */
export async function navegadorDeTeste(): Promise<HospedeNavegador> {
  const dados = mkdtempSync(join(tmpdir(), "tb-teste-"));
  return iniciarNavegador(
    {
      navegador: "chromium",
      pastas: { dados, perfilNavegador: join(dados, "perfil"), logs: join(dados, "logs") },
      timeouts: { navegacaoMs: 15000, consultaMs: 15000 },
    },
    {
      headless: true,
      ...(CHROMIUM_DE_TESTE ? { executablePath: CHROMIUM_DE_TESTE } : {}),
      args: ["--no-sandbox"],
    },
  );
}
