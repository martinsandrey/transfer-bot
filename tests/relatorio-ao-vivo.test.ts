import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright";
import type { HospedeNavegador } from "../src/navegador/navegador.js";
import { carimbo } from "../src/relatorio/callbacks-manuais.js";
import { dadosDasLigacoes, dadosDasLongas, paginaHtml } from "../src/relatorio/pagina.js";
import { lerRegistro, montarLigacoes } from "../src/relatorio/relatorio.js";
import { iniciarServidor, type ServidorRelatorio } from "../src/relatorio/servidor.js";
import { CHROMIUM_DE_TESTE, navegadorDeTeste } from "./helpers/navegador-teste.js";

const hoje = new Date();
const em = (h: number, m: number): Date =>
  new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate(), h, m, 0);
const bloco = (q: Date, func: string, cli: string, lig: string): string =>
  `===== ${carimbo(q)} | ENVIADA | Funcionário: ${func} | Cliente: ${cli} | Ligação: ${lig} =====\nNAME: X\n\n`;

const TOKEN = "b2".repeat(24);
let registro = bloco(em(9, 0), "908113", "0111", "aaa");
// mesma montagem do relatorio/cli.ts: relê os registros a cada pedido
const montar = () => montarLigacoes(lerRegistro(registro, "transferencia"), new Map());
const opcoes = () => ({
  token: TOKEN,
  pagina: () =>
    paginaHtml({
      geradoEm: new Date(),
      ...montar(),
      inicial: { periodo: "hoje" },
      servidor: { token: TOKEN },
    }),
  marcar: () => true,
  dados: () => {
    const m = montar();
    return { ligacoes: dadosDasLigacoes(m.ligacoes), longas: dadosDasLongas(m.longas) };
  },
});

describe("rota /dados do servidor do relatório", () => {
  let srv: ServidorRelatorio;
  beforeAll(async () => {
    srv = await iniciarServidor(opcoes());
  });
  afterAll(async () => srv?.fechar());
  const base = () => srv.url.replace(/\/\?k=.*$/, "");

  it("exige o token no cabeçalho e devolve os registros lidos de novo a cada pedido", async () => {
    expect((await fetch(`${base()}/dados`)).status).toBe(403);
    expect((await fetch(`${base()}/dados`, { headers: { "X-Token": "x" } })).status).toBe(403);
    const pedir = async () =>
      (await (await fetch(`${base()}/dados`, { headers: { "X-Token": TOKEN } })).json()) as {
        ligacoes: unknown[];
        longas: unknown[];
      };
    const antes = await pedir();
    expect(antes.ligacoes).toHaveLength(1);
    registro += bloco(em(9, 30), "908113", "0222", "bbb");
    expect((await pedir()).ligacoes).toHaveLength(2);
    registro = bloco(em(9, 0), "908113", "0111", "aaa");
  });

  it("sem a opção `dados` a rota não existe", async () => {
    const { token, pagina, marcar } = opcoes();
    const sem = await iniciarServidor({ token, pagina, marcar });
    try {
      const b = sem.url.replace(/\/\?k=.*$/, "");
      expect((await fetch(`${b}/dados`, { headers: { "X-Token": TOKEN } })).status).toBe(404);
    } finally {
      await sem.fechar();
    }
  });
});

describe.skipIf(!CHROMIUM_DE_TESTE)("relatório no navegador: atualização automática", () => {
  let host: HospedeNavegador;
  let pagina: Page;
  let srv: ServidorRelatorio;
  const linhas = () => pagina.locator("#detalhe tbody tr").count();
  const agora = () =>
    pagina.evaluate(() =>
      (window as unknown as { __atualizarAgora: () => Promise<void> }).__atualizarAgora(),
    );

  beforeAll(async () => {
    registro = bloco(em(9, 0), "908113", "0111", "aaa");
    srv = await iniciarServidor(opcoes());
    host = await navegadorDeTeste();
    pagina = host.paginaPrincipal();
    await pagina.setViewportSize({ width: 1200, height: 900 });
    await pagina.goto(srv.url);
  }, 60_000);
  afterAll(async () => {
    await host?.encerrar();
    await srv?.fechar();
  });

  it("mostra a linha de atualização e puxa ligações novas sem recarregar a página", async () => {
    await expect.poll(linhas).toBe(1);
    expect(await pagina.locator("#vivo").isVisible()).toBe(true);
    await pagina.evaluate(() => ((window as unknown as { marca: number }).marca = 42));
    registro += bloco(em(9, 30), "908113", "0222", "bbb");
    await agora();
    await expect.poll(linhas).toBe(2);
    expect(await pagina.evaluate(() => (window as unknown as { marca: number }).marca)).toBe(42);
    expect(await pagina.locator("#gerado").innerText()).toMatch(/^Atualizado às \d\d:\d\d:\d\d$/);
  });

  it("Pausar interrompe a atualização e Retomar busca de novo", async () => {
    await pagina.locator("#vivo-btn").click();
    expect(await pagina.locator("#vivo-btn").innerText()).toBe("Retomar atualização");
    registro += bloco(em(9, 40), "908113", "0333", "ccc");
    await agora();
    expect(await linhas()).toBe(2);
    await pagina.locator("#vivo-btn").click();
    await expect.poll(linhas).toBe(3);
  });

  it("não atualiza com a janela de confirmação aberta", async () => {
    await pagina.locator("#detalhe button.mini").first().click();
    await expect.poll(() => pagina.locator("#confirma").isVisible()).toBe(true);
    registro += bloco(em(9, 50), "908113", "0444", "ddd");
    await agora();
    expect(await linhas()).toBe(3);
    await pagina.locator("#conf-nao").click();
    await agora();
    await expect.poll(linhas).toBe(4);
  });

  it("se a janela do relatorio.bat fechar, avisa e mantém a tabela", async () => {
    await srv.fechar();
    await agora();
    await expect
      .poll(() => pagina.locator("#vivo-txt").innerText())
      .toContain("Sem conexão com o relatório");
    expect(await linhas()).toBe(4);
  });
});

describe.skipIf(!CHROMIUM_DE_TESTE)("relatório no navegador: duração média", () => {
  it("usa a duração até a transferência, não a do Stage 3 (e ignora a que não tem esse dado)", async () => {
    const reg =
      bloco(em(9, 0), "908113", "0111", "aaa") +
      bloco(em(9, 10), "908113", "0222", "bbb") +
      bloco(em(9, 20), "908113", "0333", "ccc");
    const m = montarLigacoes(
      lerRegistro(reg, "transferencia"),
      new Map([
        ["aaa", 600],
        ["bbb", 900],
        ["ccc", 700],
      ]),
      new Map(),
      {
        ateTransferencia: new Map([
          ["aaa", 100],
          ["bbb", 200],
        ]),
      },
    );
    const pasta = mkdtempSync(join(tmpdir(), "tb-dm-"));
    const arq = join(pasta, "r.html");
    writeFileSync(arq, paginaHtml({ geradoEm: new Date(), ...m, inicial: { periodo: "hoje" } }));
    const host = await navegadorDeTeste();
    try {
      const pagina = host.paginaPrincipal();
      await pagina.goto(`file://${arq}`);
      const cartao = pagina.locator("#cartoes .cartao", { hasText: "Duração média" });
      expect(await cartao.innerText()).toMatch(/(^|\s)2 min 30 s/);
      expect(await cartao.innerText()).toContain("2 transferências");
    } finally {
      await host.encerrar();
    }
  }, 60_000);
});
