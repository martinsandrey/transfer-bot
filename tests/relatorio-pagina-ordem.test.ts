import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { HospedeNavegador } from "../src/navegador/navegador.js";
import { paginaHtml } from "../src/relatorio/pagina.js";
import type { Ligacao } from "../src/relatorio/relatorio.js";
import { CHROMIUM_DE_TESTE, navegadorDeTeste } from "./helpers/navegador-teste.js";
import type { Page } from "playwright";

const R = (n: string): string => `${n} (sem apelido)`;
const hoje = new Date();
const em = (min: number): Date =>
  new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate(), 0, 0, 5 + min * 60);
const L = (
  min: number,
  f: string,
  c: string,
  r: "atendida" | "callback",
  d: number | null,
): Ligacao => ({
  quando: em(min),
  funcionario: f,
  cliente: c,
  resultado: r,
  observacao: false,
  semTransferencia: false,
  duracaoSeg: d,
});

// B: 3 transferências (1 callback), C: 2 (0 callback, sem duração), A: 1 (1 callback)
const LIGACOES: Ligacao[] = [
  L(1, "908114", "0111", "atendida", 120),
  L(2, "908114", "0222", "callback", null),
  L(3, "908114", "0333", "atendida", 300),
  L(4, "908111", "0444", "callback", null),
  L(5, "908113", "0555", "atendida", null),
  L(6, "908113", "0666", "atendida", null),
];

describe.skipIf(!CHROMIUM_DE_TESTE)(
  "relatório: alinhamento e ordenação clicando nos títulos",
  () => {
    let host: HospedeNavegador;
    let pagina: Page;
    const col = (tabela: string, i: number) =>
      pagina.$$eval(`#${tabela} tbody tr td:nth-child(${i})`, (els) =>
        els.map((e) => (e as HTMLElement).innerText.trim()),
      );
    const clicar = (tabela: string, titulo: string) =>
      pagina.locator(`#${tabela} thead button`, { hasText: titulo }).click();
    const sentido = (tabela: string, titulo: string) =>
      pagina
        .locator(`#${tabela} thead th`, { has: pagina.locator("button", { hasText: titulo }) })
        .getAttribute("aria-sort");

    beforeAll(async () => {
      host = await navegadorDeTeste();
      const arquivo = join(mkdtempSync(join(tmpdir(), "ord-")), "r.html");
      writeFileSync(
        arquivo,
        paginaHtml({
          geradoEm: hoje,
          ligacoes: LIGACOES,
          longas: [],
          inicial: { periodo: "hoje" },
        }),
        "utf8",
      );
      pagina = host.paginaPrincipal();
      await pagina.setViewportSize({ width: 1200, height: 900 });
      await pagina.goto(`file://${arquivo}`);
    }, 60_000);
    afterAll(async () => host?.encerrar());

    it("títulos alinhados com o conteúdo de cada coluna (esquerda para texto, direita para números)", async () => {
      for (const tabela of ["tabela", "detalhe"]) {
        const n = await pagina.locator(`#${tabela} thead th`).count();
        for (let i = 1; i <= n; i++) {
          const [ath, atd] = await pagina.evaluate(
            ([t, k]) => {
              const th = document.querySelector(`#${t} thead th:nth-child(${k})`) as HTMLElement;
              const td = document.querySelector(`#${t} tbody tr td:nth-child(${k})`) as HTMLElement;
              return [getComputedStyle(th).textAlign, getComputedStyle(td).textAlign];
            },
            [tabela, i] as const,
          );
          expect(ath, `${tabela} coluna ${i}`).toBe(atd);
        }
      }
      // e visualmente: borda esquerda do título = borda esquerda do conteúdo (±14 px de padding) na 1ª coluna
      const pos = await pagina.evaluate(() => {
        const b = document.querySelector("#detalhe thead th:nth-child(2) button") as HTMLElement;
        const td = document.querySelector("#detalhe tbody tr td:nth-child(2)") as HTMLElement;
        return [b.getBoundingClientRect().left, td.getBoundingClientRect().left];
      });
      expect(Math.abs((pos[0] ?? 0) - (pos[1] ?? 0))).toBeLessThan(16);
    });

    it("padrão: por funcionário = mais transferências primeiro; ligações = mais recentes primeiro", async () => {
      expect(await col("tabela", 1)).toEqual([R("908114"), R("908113"), R("908111")]);
      expect(await sentido("tabela", "Transferências com callback")).toBe("descending");
      expect((await col("detalhe", 2))[0]).toBe(R("908113")); // a de 6 min é a mais recente
      expect(await sentido("detalhe", "Data e hora")).toBe("descending");
    });

    it("clicar em Funcionário ordena de A a Z e clicar de novo inverte (TOTAL fica no rodapé)", async () => {
      await clicar("tabela", "Funcionário");
      expect(await col("tabela", 1)).toEqual([R("908111"), R("908113"), R("908114")]);
      expect(await sentido("tabela", "Funcionário")).toBe("ascending");
      await clicar("tabela", "Funcionário");
      expect(await col("tabela", 1)).toEqual([R("908114"), R("908113"), R("908111")]);
      expect(await sentido("tabela", "Funcionário")).toBe("descending");
      expect(await pagina.locator("#tabela tfoot td").first().innerText()).toBe("TOTAL");
    });

    it("colunas numéricas: 1º clique = maior primeiro; 2º = menor primeiro", async () => {
      await clicar("tabela", "Callbacks");
      expect((await col("tabela", 5))[0]).toBe("1");
      expect((await col("tabela", 5)).map(Number)).toEqual(
        [...(await col("tabela", 5)).map(Number)].sort((a, b) => b - a),
      );
      await clicar("tabela", "Callbacks");
      expect((await col("tabela", 5)).map(Number)).toEqual(
        [...(await col("tabela", 5)).map(Number)].sort((a, b) => a - b),
      );
    });

    it("duração média: quem não tem duração fica sempre por último, nos dois sentidos", async () => {
      await clicar("tabela", "Duração média");
      expect((await col("tabela", 7))[0]).toBe("3 min 30 s"); // (120 + 300) / 2 do 908114
      expect((await col("tabela", 7)).slice(1)).toEqual(["—", "—"]);
      await clicar("tabela", "Duração média");
      expect((await col("tabela", 7))[0]).toBe("3 min 30 s"); // o único com valor continua na frente
    });

    it("a lista ligação a ligação ordena por funcionário, cliente, resultado, duração e hora — sem afetar a outra tabela", async () => {
      const antes = await col("tabela", 1);
      await clicar("detalhe", "Funcionário");
      expect(await col("detalhe", 2)).toEqual([
        R("908111"),
        R("908113"),
        R("908113"),
        R("908114"),
        R("908114"),
        R("908114"),
      ]);
      await clicar("detalhe", "Cliente");
      expect(await col("detalhe", 3)).toEqual(["0111", "0222", "0333", "0444", "0555", "0666"]);
      await clicar("detalhe", "Resultado");
      expect((await col("detalhe", 4))[0]).toContain("Atendida");
      await clicar("detalhe", "Duração");
      expect((await col("detalhe", 5))[0]).toBe("5 min 00 s"); // maior primeiro
      expect((await col("detalhe", 5)).slice(-3)).toEqual(["—", "—", "—"]);
      await clicar("detalhe", "Data e hora");
      expect((await col("detalhe", 3))[0]).toBe("0666");
      await clicar("detalhe", "Data e hora");
      expect((await col("detalhe", 3))[0]).toBe("0111");
      expect(await col("tabela", 1)).toEqual(antes);
    });

    it("os títulos são botões (teclado) e só um título por tabela fica marcado", async () => {
      expect(
        await pagina
          .locator(
            "#tabela thead th[aria-sort='ascending'], #tabela thead th[aria-sort='descending']",
          )
          .count(),
      ).toBe(1);
      await pagina.locator("#tabela thead button", { hasText: "Funcionário" }).focus();
      await pagina.keyboard.press("Enter");
      expect(await sentido("tabela", "Funcionário")).toBe("ascending");
    });

    it("o filtro de período mantém a ordem escolhida", async () => {
      await clicar("tabela", "Funcionário"); // estava A-Z (teclado) → agora Z-A
      expect(await sentido("tabela", "Funcionário")).toBe("descending");
      await pagina.click('button[data-p="tudo"]');
      expect(await sentido("tabela", "Funcionário")).toBe("descending");
      expect(await col("tabela", 1)).toEqual([R("908114"), R("908113"), R("908111")]);
    });
  },
);
