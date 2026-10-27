import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { carimbo } from "../src/relatorio/callbacks-manuais.js";
import { paginaHtml } from "../src/relatorio/pagina.js";
import { lerRegistro, montarLigacoes } from "../src/relatorio/relatorio.js";
import { ESTILO, montarXlsx } from "../src/relatorio/xlsx.js";
import { CHROMIUM_DE_TESTE, navegadorDeTeste } from "./helpers/navegador-teste.js";
import { lerZip } from "./helpers/zip.js";

describe("gerador de .xlsx", () => {
  const xlsx = montarXlsx([
    {
      nome: "Resumo",
      larguras: [30, 12],
      linhas: [
        [{ v: "Título & <ação> \u0001", e: ESTILO.titulo }],
        [],
        [{ v: "Taxa" }, { v: 0.25, e: ESTILO.porcentagem }],
        [{ v: "Vazio", e: ESTILO.texto }, { v: null, e: ESTILO.texto }, null, { v: NaN }],
      ],
      mesclar: ["A1:B1"],
    },
    {
      nome: "Por funcionário: [x]",
      larguras: [20],
      linhas: [[{ v: "Cab", e: ESTILO.cabecalho }], [{ v: "0123" }]],
      congelar: 1,
      filtro: "A1:A2",
    },
  ]);
  const z = lerZip(xlsx);

  it("tem as partes mínimas do formato e cada aba", () => {
    expect([...z.keys()]).toEqual([
      "[Content_Types].xml",
      "_rels/.rels",
      "xl/workbook.xml",
      "xl/_rels/workbook.xml.rels",
      "xl/styles.xml",
      "xl/worksheets/sheet1.xml",
      "xl/worksheets/sheet2.xml",
    ]);
    expect(z.get("xl/styles.xml")).toContain(`<cellXfs count="${Object.keys(ESTILO).length}">`);
  });

  it("escapa o texto, tira caracteres de controle e mantém número como número", () => {
    const s1 = z.get("xl/worksheets/sheet1.xml") as string;
    expect(s1).toContain("Título &amp; &lt;ação&gt; </t>");
    expect(s1).toContain('<c r="B3" s="6"><v>0.25</v></c>');
    expect(s1).toContain('<c r="B4" s="4"/>');
    expect(s1).toContain('<c r="D4"/>'); // NaN vira célula vazia
    expect(s1).not.toContain("C4"); // null = sem célula
    expect(s1).toContain('<mergeCell ref="A1:B1"/>');
  });

  it("nome de aba inválido é limpo; filtro e linha congelada", () => {
    const wb = z.get("xl/workbook.xml") as string;
    expect(wb).toContain('<sheet name="Por funcionário   x" sheetId="2"');
    expect(wb).toContain(
      `<definedName name="_xlnm._FilterDatabase" localSheetId="1" hidden="1">'Por funcionário   x'!$A$1:$A$2</definedName>`,
    );
    const s2 = z.get("xl/worksheets/sheet2.xml") as string;
    expect(s2).toContain(
      '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>',
    );
    expect(s2).toContain('<autoFilter ref="A1:A2"/>');
    expect(s2).toContain('t="inlineStr"><is><t xml:space="preserve">0123</t>'); // texto, não número
  });

  it("o código roda isolado (é assim que vai para a página)", () => {
    const isolado = new Function(`return (${montarXlsx.toString()})`)() as typeof montarXlsx;
    expect(lerZip(isolado([{ nome: "A", larguras: [], linhas: [[{ v: 1 }]] }])).size).toBe(6);
  });
});

const hoje = new Date();
const em = (h: number, m: number): Date =>
  new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate(), h, m, 0);
const bloco = (q: Date, func: string, cli: string, lig: string, cb = false): string =>
  `===== ${carimbo(q)} | ENVIADA${cb ? " | CALLBACK (ninguém atendeu)" : ""} | Funcionário: ${func} | Cliente: ${cli} | Ligação: ${lig} =====\n${cb ? "CALLBACK" : "NAME: X"}\n\n`;

describe.skipIf(!CHROMIUM_DE_TESTE)("botão Baixar planilha (Excel) na página", () => {
  it("baixa um .xlsx com as abas, os totais e as ligações do período", async () => {
    const reg =
      bloco(em(9, 0), "908113", "0111", "aaa") +
      bloco(em(10, 0), "908113", "0222", "bbb") +
      bloco(em(10, 1), "908113", "0222", "bbb", true) +
      bloco(em(14, 0), "908124", "0333", "ccc");
    const m = montarLigacoes(
      lerRegistro(reg, "transferencia"),
      new Map([
        ["aaa", 300],
        ["ccc", 400],
      ]),
      new Map(),
      {
        ateTransferencia: new Map([
          ["aaa", 90],
          ["ccc", 150],
        ]),
      },
    );
    const pasta = mkdtempSync(join(tmpdir(), "tb-xlsx-"));
    const arq = join(pasta, "r.html");
    writeFileSync(
      arq,
      paginaHtml({
        geradoEm: new Date(),
        ...m,
        inicial: { periodo: "hoje" },
        apelidos: new Map([["908113", "Ana"]]),
      }),
    );
    const host = await navegadorDeTeste();
    try {
      const pagina = host.paginaPrincipal();
      await pagina.goto(`file://${arq}`);
      const [download] = await Promise.all([
        pagina.waitForEvent("download"),
        pagina.locator("#planilha").click(),
      ]);
      const ymd = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}-${String(hoje.getDate()).padStart(2, "0")}`;
      expect(download.suggestedFilename()).toBe(`relatorio-transferencias_${ymd}.xlsx`);
      const destino = join(pasta, "p.xlsx");
      await download.saveAs(destino);
      if (process.env["TB_GUARDAR_XLSX"])
        writeFileSync(process.env["TB_GUARDAR_XLSX"], readFileSync(destino));
      const z = lerZip(new Uint8Array(readFileSync(destino)));
      const wb = z.get("xl/workbook.xml") as string;
      for (const aba of [
        "Resumo",
        "Por funcionário",
        "Ligações",
        "Ligações de 5 min",
        "Meio-dia por funcionário",
        "Por hora",
      ])
        expect(wb).toContain(`<sheet name="${aba}"`);
      const resumo = z.get("xl/worksheets/sheet1.xml") as string;
      // 3 transferências, 1 callback, média até a transferência = (90 + 150) / 2 = 120 s
      expect(resumo).toMatch(/<c r="B7" s="5"><v>3<\/v><\/c>/);
      expect(resumo).toMatch(/<c r="B9" s="5"><v>1<\/v><\/c>/);
      expect(resumo).toContain(`<c r="B11" s="7"><v>${120 / 86400}</v></c>`);
      const func = z.get("xl/worksheets/sheet2.xml") as string;
      expect(func).toContain("Ana (908113)");
      expect(func).toContain(">TOTAL<");
      const lig = z.get("xl/worksheets/sheet3.xml") as string;
      expect(lig.match(/<row /g)).toHaveLength(4); // cabeçalho + 3 ligações
      expect(lig).toContain(">Callback<");
      expect(lig).toContain(">0333<");
    } finally {
      await host.encerrar();
    }
  }, 60_000);
});
