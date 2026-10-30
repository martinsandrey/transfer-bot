import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { carimbo } from "../src/relatorio/callbacks-manuais.js";
import { paginaHtml } from "../src/relatorio/pagina.js";
import { lerRegistro, montarLigacoes } from "../src/relatorio/relatorio.js";
import { montarTabelaMensal } from "../src/relatorio/tabela-mensal.js";
import { lerZip } from "./helpers/zip.js";
import { CHROMIUM_DE_TESTE, navegadorDeTeste } from "./helpers/navegador-teste.js";

const FUSO = "America/Sao_Paulo";
// 12h em Brasília (= 15h UTC) do dia informado de outubro de 2026
const dia = (d: number, h = 12) => Date.UTC(2026, 9, d, h + 3, 0, 0);
const lig = (d: number, f: string, extra: Record<string, unknown> = {}) => ({
  t: dia(d),
  f,
  r: "a",
  ...extra,
});

describe("tabela do mês (2 últimos números da linha 1 x dia do mês)", () => {
  it("uma coluna por dia do mês, 0 nos dias vazios, linhas pelos 2 últimos números e total por dia", () => {
    const t = montarTabelaMensal(
      [lig(1, "908101"), lig(1, "908101"), lig(3, "908101"), lig(1, "908112"), lig(31, "908112")],
      "2026-10",
      FUSO,
    );
    expect(t.dias).toBe(31);
    expect(t.linhas.map((l) => l.chave)).toEqual(["01", "12"]);
    expect(t.linhas[0]?.contagem.slice(0, 4)).toEqual([2, 0, 1, 0]);
    expect(t.linhas[1]?.contagem[0]).toBe(1);
    expect(t.linhas[1]?.contagem[30]).toBe(1);
    expect(t.totais.slice(0, 4)).toEqual([3, 0, 1, 0]);
    expect(t.totais[30]).toBe(1);
    expect(t.linhas.every((l) => l.contagem.length === 31)).toBe(true);
  });

  it("só conta transferência concluída que vale: callback, desconsiderada e CALLBACK sem transferência ficam de fora", () => {
    const t = montarTabelaMensal(
      [
        lig(2, "908101"),
        lig(2, "908101", { r: "c" }),
        lig(2, "908101", { rm: { t: 1 } }),
        lig(2, "908101", { s: 1 }),
      ],
      "2026-10",
      FUSO,
    );
    expect(t.linhas).toEqual([{ chave: "01", contagem: expect.arrayContaining([1]) }]);
    expect(t.totais[1]).toBe(1);
  });

  it("outros meses não entram; o dia vem do fuso (23h30 de Brasília ainda é o mesmo dia)", () => {
    const t = montarTabelaMensal(
      [
        { t: Date.UTC(2026, 8, 30, 20), f: "908101", r: "a" }, // 30/09
        { t: Date.UTC(2026, 10, 1, 4), f: "908101", r: "a" }, // 01/11 01h em Brasília
        { t: Date.UTC(2026, 10, 1, 2, 30), f: "908102", r: "a" }, // 31/10 23h30 em Brasília
      ],
      "2026-10",
      FUSO,
    );
    expect(t.linhas.map((l) => l.chave)).toEqual(["02"]);
    expect(t.linhas[0]?.contagem[30]).toBe(1);
  });

  it("mês de 28 dias, mês sem transferência e funcionários que só diferem no começo do número somam na mesma linha", () => {
    const vazio = montarTabelaMensal([], "2027-02", FUSO);
    expect(vazio.dias).toBe(28);
    expect(vazio.linhas).toEqual([]);
    expect(vazio.totais).toEqual(new Array(28).fill(0));
    const junto = montarTabelaMensal([lig(5, "908101"), lig(5, "918101")], "2026-10", FUSO);
    expect(junto.linhas).toHaveLength(1);
    expect(junto.linhas[0]?.contagem[4]).toBe(2);
  });
});

describe.skipIf(!CHROMIUM_DE_TESTE)("botão Baixar tabela do mês (Excel)", () => {
  it("baixa um .xlsx com colunas de verdade (cabeçalho em chinês, uma coluna por dia), respeitando os filtros da página", async () => {
    const hoje = new Date();
    const em = (d: number, h: number) => new Date(hoje.getFullYear(), hoje.getMonth(), d, h, 0, 0);
    const bloco = (q: Date, func: string, cli: string, lig: string) =>
      `===== ${carimbo(q)} | ENVIADA | Funcionário: ${func} | Cliente: ${cli} | Ligação: ${lig} =====\nNAME: X\n\n`;
    const reg =
      bloco(em(2, 9), "908111", "0111", "a") +
      bloco(em(2, 10), "908111", "0222", "b") +
      bloco(em(3, 9), "908121", "0333", "c"); // 21: equipe do paquistanês (penúltimo dígito 2)
    const m = montarLigacoes(lerRegistro(reg, "transferencia"), new Map());
    const pasta = mkdtempSync(join(tmpdir(), "tb-mes-"));
    const arq = join(pasta, "r.html");
    writeFileSync(
      arq,
      paginaHtml({
        geradoEm: new Date(),
        ...m,
        inicial: { periodo: "hoje" },
        equipePaquistanesDigitos: ["2"],
      }),
    );
    const host = await navegadorDeTeste();
    try {
      const pagina = host.paginaPrincipal();
      await pagina.goto(pathToFileURL(arq).href);
      const baixar = async () => {
        const [d] = await Promise.all([
          pagina.waitForEvent("download"),
          pagina.locator("#mes-btn").click(),
        ]);
        const destino = join(pasta, `t${Math.random()}.xlsx`);
        await d.saveAs(destino);
        return { nome: d.suggestedFilename(), z: lerZip(new Uint8Array(readFileSync(destino))) };
      };
      const mes = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}`;
      expect(await pagina.locator("#mes-csv").inputValue()).toBe(mes);
      const a = await baixar();
      expect(a.nome).toBe(`transferencias-por-dia_${mes}.xlsx`);
      const dias = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0).getDate();
      const planilha = a.z.get("xl/worksheets/sheet1.xml") as string;
      expect(planilha).toContain(">編號<");
      expect(planilha).toContain(">總計<");
      expect(planilha).toContain(">11<");
      expect(planilha).toContain(">21<");
      // cabeçalho com um dia por coluna: A1 = 編號, B1 = 1 ... até a coluna do último dia
      expect(planilha).toMatch(/<c r="A1"[^>]*>.*?編號/);
      const ultimaColuna = (n: number) =>
        n <= 26 ? String.fromCharCode(64 + n) : "A" + String.fromCharCode(64 + n - 26);
      expect(planilha).toContain(`r="${ultimaColuna(dias + 1)}1"`);
      expect(planilha).not.toContain(`r="${ultimaColuna(dias + 2)}1"`);
      // dia 2: o funcionário 11 fez 2 (coluna D = dia 3? B = dia 1, C = dia 2)
      expect(planilha).toMatch(/<c r="C2"[^>]*><v>2<\/v><\/c>/);
      expect(planilha).toMatch(/<c r="D3"[^>]*><v>1<\/v><\/c>/);
      // desligando a equipe do paquistanês na página, a linha 21 some do arquivo
      await pagina.uncheck("#pk");
      const b = await baixar();
      const so = b.z.get("xl/worksheets/sheet1.xml") as string;
      expect(so.match(/<row /g)).toHaveLength(3); // cabeçalho, 11 e 總計 (sem a linha 21)
      expect(planilha.match(/<row /g)).toHaveLength(4); // com a equipe: cabeçalho, 11, 21 e 總計
    } finally {
      await host.encerrar();
    }
  }, 60_000);
});
