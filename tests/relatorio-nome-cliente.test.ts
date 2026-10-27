import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { carimbo } from "../src/relatorio/callbacks-manuais.js";
import { dadosDasLigacoes, paginaHtml } from "../src/relatorio/pagina.js";
import { lerRegistro, montarLigacoes } from "../src/relatorio/relatorio.js";
import { CHROMIUM_DE_TESTE, navegadorDeTeste } from "./helpers/navegador-teste.js";
import { lerZip } from "./helpers/zip.js";

const hoje = new Date();
const em = (h: number, m: number): Date =>
  new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate(), h, m, 0);
const bloco = (q: Date, lig: string, corpo: string, cb = false): string =>
  `===== ${carimbo(q)} | ENVIADA${cb ? " | CALLBACK (ninguém atendeu)" : ""} | Funcionário: 908113 | Cliente: 0111 | Ligação: ${lig} =====\n${corpo}\n\n`;

const REGISTRO =
  bloco(em(9, 0), "aaa", "NAME: Maria Exemplo\nCPF : 1\nPh: 0111") +
  bloco(em(10, 0), "bbb", "NAME: \nCPF : 2\nPh: 0222") + // nome vazio no cadastro
  bloco(em(11, 0), "ccc", "NAME: <b>Joao</b> & Cia\nPh: 0333") +
  bloco(em(12, 1), "ddd", "CALLBACK", true); // callback sem a transferência no registro

describe("nome do cliente no relatório", () => {
  it("o nome vem da linha NAME do registro; vazio ou ausente vira null", () => {
    expect(lerRegistro(REGISTRO, "transferencia").map((e) => e.nome)).toEqual([
      "Maria Exemplo",
      null,
      "<b>Joao</b> & Cia",
      null,
    ]);
  });

  it("vai para a ligação (callback órfão fica sem nome) e para os dados da página", () => {
    const { ligacoes } = montarLigacoes(lerRegistro(REGISTRO, "transferencia"));
    expect(ligacoes.map((l) => l.nome ?? null)).toEqual([
      "Maria Exemplo",
      null,
      "<b>Joao</b> & Cia",
      null,
    ]);
    expect((dadosDasLigacoes(ligacoes)[0] as { n: string }).n).toBe("Maria Exemplo");
  });
});

describe.skipIf(!CHROMIUM_DE_TESTE)("relatório no navegador: coluna Nome", () => {
  it("a coluna Nome fica logo à direita do telefone, mostra '—' sem nome, nunca interpreta HTML, ordena e vai para a planilha", async () => {
    const m = montarLigacoes(lerRegistro(REGISTRO, "transferencia"));
    const pasta = mkdtempSync(join(tmpdir(), "tb-nome-"));
    const arq = join(pasta, "r.html");
    writeFileSync(arq, paginaHtml({ geradoEm: new Date(), ...m, inicial: { periodo: "hoje" } }));
    const host = await navegadorDeTeste();
    try {
      const pagina = host.paginaPrincipal();
      await pagina.goto(pathToFileURL(arq).href);
      const cab = await pagina.$$eval("#detalhe thead th", (e) =>
        e.map((x) => x.textContent?.trim()),
      );
      expect(cab.slice(0, 5)).toEqual([
        "Data e hora",
        "Funcionário",
        "Cliente",
        "Nome",
        "Resultado",
      ]);
      const linhas = await pagina.$$eval("#detalhe tbody tr", (trs) =>
        trs.map((tr) => [...tr.querySelectorAll("td")].slice(2, 4).map((td) => td.textContent)),
      );
      // a lista começa pela ligação mais recente
      expect(linhas).toEqual([
        ["0111", "—"],
        ["0111", "<b>Joao</b> & Cia"],
        ["0111", "—"],
        ["0111", "Maria Exemplo"],
      ]);
      expect(await pagina.locator("#detalhe tbody b").count()).toBe(0);
      // ordenar pelo título "Nome" não dá erro e põe a ordem alfabética
      await pagina.locator('#detalhe th[data-k="n"] button').click();
      const nomes = await pagina.$$eval("#detalhe tbody tr", (trs) =>
        trs.map((tr) => tr.querySelectorAll("td")[3]?.textContent),
      );
      expect(nomes).toEqual(["—", "—", "<b>Joao</b> & Cia", "Maria Exemplo"]);

      const [download] = await Promise.all([
        pagina.waitForEvent("download"),
        pagina.locator("#planilha").click(),
      ]);
      const destino = join(pasta, "p.xlsx");
      await download.saveAs(destino);
      const z = lerZip(new Uint8Array(readFileSync(destino)));
      const lig = z.get("xl/worksheets/sheet3.xml") as string;
      expect(lig).toContain(">Nome<");
      expect(lig).toContain(">Maria Exemplo<");
      expect(lig).toContain("&lt;b&gt;Joao&lt;/b&gt; &amp; Cia");
    } finally {
      await host.encerrar();
    }
  }, 60_000);
});
