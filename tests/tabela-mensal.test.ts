import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { carimbo } from "../src/relatorio/callbacks-manuais.js";
import { paginaHtml } from "../src/relatorio/pagina.js";
import { lerRegistro, montarLigacoes } from "../src/relatorio/relatorio.js";
import { montarTabelaMensal } from "../src/relatorio/tabela-mensal.js";
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
  it("cabeçalho em chinês, uma coluna por dia do mês, 0 nos dias vazios, linhas pelos 2 últimos números e total no fim", () => {
    const csv = montarTabelaMensal(
      [lig(1, "908101"), lig(1, "908101"), lig(3, "908101"), lig(1, "908112"), lig(31, "908112")],
      "2026-10",
      FUSO,
    );
    const linhas = csv.trimEnd().split("\r\n");
    expect(linhas).toHaveLength(4);
    const [cab, a, b, total] = linhas.map((l) => l.split(";"));
    expect(cab?.slice(0, 4)).toEqual(["編號", "1", "2", "3"]);
    expect(cab).toHaveLength(32); // 編號 + 31 dias de outubro
    expect(a?.slice(0, 4)).toEqual(["01", "2", "0", "1"]);
    expect(b?.slice(0, 2)).toEqual(["12", "1"]);
    expect(b?.[31]).toBe("1");
    expect(total?.slice(0, 4)).toEqual(["總計", "3", "0", "1"]);
    expect(total?.[31]).toBe("1");
    expect(csv.endsWith("\r\n")).toBe(true);
  });

  it("só conta transferência concluída que vale: callback, desconsiderada e CALLBACK sem transferência ficam de fora", () => {
    const csv = montarTabelaMensal(
      [
        lig(2, "908101"),
        lig(2, "908101", { r: "c" }),
        lig(2, "908101", { rm: { t: 1 } }),
        lig(2, "908101", { s: 1 }),
      ],
      "2026-10",
      FUSO,
    );
    const [, linha] = csv.trimEnd().split("\r\n");
    expect(linha?.split(";").slice(0, 3)).toEqual(["01", "0", "1"]);
  });

  it("outros meses não entram; o dia vem do fuso (23h30 de Brasília ainda é o mesmo dia)", () => {
    const csv = montarTabelaMensal(
      [
        { t: Date.UTC(2026, 8, 30, 20), f: "908101", r: "a" }, // 30/09
        { t: Date.UTC(2026, 10, 1, 4), f: "908101", r: "a" }, // 01/11 01h em Brasília
        { t: Date.UTC(2026, 10, 1, 2, 30), f: "908102", r: "a" }, // 31/10 23h30 em Brasília
      ],
      "2026-10",
      FUSO,
    );
    const linhas = csv.trimEnd().split("\r\n");
    expect(linhas).toHaveLength(3); // cabeçalho, só o 02, total
    expect(linhas[1]?.split(";")[0]).toBe("02");
    expect(linhas[1]?.split(";")[31]).toBe("1");
  });

  it("mês de 28 dias, mês sem transferência e funcionários que só diferem no começo do número somam na mesma linha", () => {
    const vazio = montarTabelaMensal([], "2027-02", FUSO).trimEnd().split("\r\n");
    expect(vazio).toHaveLength(2);
    expect(vazio[0]?.split(";")).toHaveLength(29);
    expect(vazio[1]?.split(";").slice(0, 3)).toEqual(["總計", "0", "0"]);
    const junto = montarTabelaMensal([lig(5, "908101"), lig(5, "918101")], "2026-10", FUSO);
    expect(junto.trimEnd().split("\r\n")[1]?.split(";").slice(0, 6)).toEqual([
      "01",
      "0",
      "0",
      "0",
      "0",
      "2",
    ]);
  });
});

describe.skipIf(!CHROMIUM_DE_TESTE)("botão Baixar tabela do mês (CSV)", () => {
  it("baixa o CSV com BOM, no mês escolhido, respeitando os filtros da página", async () => {
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
        const destino = join(pasta, `t${Math.random()}.csv`);
        await d.saveAs(destino);
        return { nome: d.suggestedFilename(), bytes: readFileSync(destino) };
      };
      const mes = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}`;
      expect(await pagina.locator("#mes-csv").inputValue()).toBe(mes);
      const a = await baixar();
      expect(a.nome).toBe(`transferencias-por-dia_${mes}.csv`);
      expect([...a.bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]); // BOM UTF-8
      const linhasA = a.bytes
        .toString("utf8")
        .replace(/^\uFEFF/, "")
        .trimEnd()
        .split("\r\n");
      expect(linhasA.map((l) => l.split(";")[0])).toEqual(["編號", "11", "21", "總計"]);
      expect(linhasA[1]?.split(";").slice(1, 4)).toEqual(["0", "2", "0"]);
      expect(linhasA[2]?.split(";").slice(1, 4)).toEqual(["0", "0", "1"]);
      // desligando a equipe do paquistanês na página, a linha 21 some do arquivo
      await pagina.uncheck("#pk");
      const b = await baixar();
      const linhasB = b.bytes
        .toString("utf8")
        .replace(/^\uFEFF/, "")
        .trimEnd()
        .split("\r\n");
      expect(linhasB.map((l) => l.split(";")[0])).toEqual(["編號", "11", "總計"]);
    } finally {
      await host.encerrar();
    }
  }, 60_000);
});
