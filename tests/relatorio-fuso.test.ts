import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { HospedeNavegador } from "../src/navegador/navegador.js";
import { carimbo } from "../src/relatorio/callbacks-manuais.js";
import { paginaHtml } from "../src/relatorio/pagina.js";
import { lerRegistro, montarLigacoes } from "../src/relatorio/relatorio.js";
import { CHROMIUM_DE_TESTE, navegadorDeTeste } from "./helpers/navegador-teste.js";

const hoje = new Date();
const quando = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate(), 9, 0, 0);
const registro = `===== ${carimbo(quando)} | ENVIADA | Funcionário: 908113 | Cliente: 0111 | Ligação: aaa =====\nNAME: X\n\n`;

function paginaEm(fuso: string): string {
  const html = paginaHtml({
    geradoEm: new Date(),
    fuso,
    ...montarLigacoes(lerRegistro(registro, "transferencia"), new Map()),
    inicial: { periodo: "hoje" },
  });
  const pasta = mkdtempSync(join(tmpdir(), "rel-fuso-"));
  const arquivo = join(pasta, "r.html");
  writeFileSync(arquivo, html);
  return pathToFileURL(arquivo).href;
}

describe.skipIf(!CHROMIUM_DE_TESTE)("relatório: horários no fuso do programa", () => {
  let host: HospedeNavegador;
  beforeAll(async () => {
    host = await navegadorDeTeste();
  }, 60_000);
  afterAll(async () => host?.encerrar());

  it("mostra a hora da ligação no fuso configurado, não no do navegador", async () => {
    const pagina = host.paginaPrincipal();
    for (const fuso of ["Asia/Tokyo", "America/Sao_Paulo"]) {
      await pagina.goto(paginaEm(fuso));
      const esperado = quando.toLocaleString("pt-BR", { timeZone: fuso });
      await pagina.locator("#detalhe tbody tr").first().waitFor();
      expect(await pagina.locator("#detalhe tbody tr td").first().innerText()).toBe(esperado);
    }
  });
});
