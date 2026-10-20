import { mkdtempSync, readFileSync, writeFileSync, existsSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright";
import type { HospedeNavegador } from "../src/navegador/navegador.js";
import {
  ARQUIVO_CALLBACKS_MANUAIS,
  carimbo,
  chaveDaTransferencia,
  chaveValida,
  lerCallbacksManuais,
  linhaDeMarcacao,
} from "../src/relatorio/callbacks-manuais.js";
import { paginaHtml } from "../src/relatorio/pagina.js";
import { lerRegistro, montarLigacoes, resumir, totalDe } from "../src/relatorio/relatorio.js";
import { iniciarServidor, type ServidorRelatorio } from "../src/relatorio/servidor.js";
import { CHROMIUM_DE_TESTE, navegadorDeTeste } from "./helpers/navegador-teste.js";

const hoje = new Date();
const em = (h: number, m: number): Date =>
  new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate(), h, m, 0);
const bloco = (q: Date, func: string, cli: string, lig: string | null, cb = false): string =>
  `===== ${carimbo(q)} | ENVIADA${cb ? " | CALLBACK (ninguém atendeu)" : ""} | Funcionário: ${func} | Cliente: ${cli}${lig ? ` | Ligação: ${lig}` : ""} =====\n${cb ? "CALLBACK" : "NAME: X"}\n\n`;

describe("callbacks marcados no relatório: arquivo", () => {
  it("chave = código da ligação; registros antigos sem código = hora do registro + funcionário", () => {
    expect(chaveDaTransferencia({ ligacao: "ab12", quando: em(9, 0), funcionario: "908113" })).toBe(
      "L:ab12",
    );
    expect(chaveDaTransferencia({ ligacao: null, quando: em(9, 5), funcionario: "908113" })).toBe(
      `T:${carimbo(em(9, 5))}|908113`,
    );
  });

  it("grava uma linha legível por marcação e, na leitura, vale a última de cada ligação", () => {
    const t = em(10, 0);
    const texto =
      linhaDeMarcacao("L:aaa", true, t) +
      linhaDeMarcacao("L:bbb", true, t) +
      linhaDeMarcacao(`T:${carimbo(em(9, 5))}|(não identificado)`, true, t) +
      linhaDeMarcacao("L:aaa", false, t) +
      "lixo\n";
    expect(texto.split("\n")[0]).toBe(`${carimbo(t)} | MARCADA COMO CALLBACK | Ligação: aaa`);
    expect(texto).toContain(`| DESMARCADA | Ligação: aaa`);
    expect(texto).toContain(
      `| Transferência: ${carimbo(em(9, 5))} | Funcionário: (não identificado)`,
    );
    const m = lerCallbacksManuais(texto.replace(/\n/g, "\r\n"));
    expect([...m]).toEqual([
      ["L:aaa", false],
      ["L:bbb", true],
      [`T:${carimbo(em(9, 5))}|(não identificado)`, true],
    ]);
  });

  it("recusa chaves que poderiam injetar texto no arquivo", () => {
    for (const ruim of [
      "",
      "L:",
      "L:a b",
      "L:a\nX",
      "X:abc",
      "T:2026-10-20 10:00:00|a\n|b",
      "T:ontem|908113",
    ])
      expect(chaveValida(ruim), JSON.stringify(ruim)).toBe(false);
    expect(() => linhaDeMarcacao("L:a\n2026", true, em(1, 0))).toThrow();
  });
});

describe("callbacks marcados no relatório: cálculo", () => {
  const txt =
    bloco(em(9, 0), "908113", "0111", "aaa") +
    bloco(em(9, 10), "908113", "0222", "bbb") +
    bloco(em(9, 12), "908113", "0222", "bbb", true) +
    bloco(em(9, 20), "908114", "0333", null);
  const entradas = lerRegistro(txt, "transferencia");
  const dur = new Map([["aaa", 200]]);

  it("a transferência marcada vira callback (manual), sai da duração média e o resto não muda", () => {
    const antes = montarLigacoes(entradas, dur);
    const t0 = totalDe(resumir(antes, { de: null, ate: null, rotulo: "" }));
    expect(t0).toMatchObject({
      comCallback: 3,
      semCallback: 2,
      callbacks: 1,
      comDuracao: 1,
      mediaSeg: 200,
    });

    const manuais = new Map([
      ["L:aaa", true],
      [`T:${carimbo(em(9, 20))}|908114`, true],
      ["L:bbb", true], // já era callback pelo bot: nada muda
    ]);
    const depois = montarLigacoes(entradas, dur, manuais);
    const t1 = totalDe(resumir(depois, { de: null, ate: null, rotulo: "" }));
    expect(t1).toMatchObject({
      comCallback: 3,
      semCallback: 0,
      callbacks: 3,
      comDuracao: 0,
      mediaSeg: null,
    });
    const porChave = new Map(depois.ligacoes.map((l) => [l.chave, l]));
    expect(porChave.get("L:aaa")).toMatchObject({
      resultado: "callback",
      manual: true,
      duracaoSeg: 200,
    });
    expect(porChave.get("L:bbb")).toMatchObject({ resultado: "callback", manual: false });
    expect(porChave.get(`T:${carimbo(em(9, 20))}|908114`)).toMatchObject({
      resultado: "callback",
      manual: true,
    });

    // desmarcada = volta a ser atendida, com a duração
    const desfeita = montarLigacoes(entradas, dur, new Map([["L:aaa", false]]));
    expect(desfeita.ligacoes.find((l) => l.chave === "L:aaa")).toMatchObject({
      resultado: "atendida",
      manual: false,
      duracaoSeg: 200,
    });
  });
});

describe("servidor local do relatório", () => {
  let srv: ServidorRelatorio;
  const marcadas: [string, boolean][] = [];
  const TOKEN = "f".repeat(48);
  beforeAll(async () => {
    srv = await iniciarServidor({
      token: TOKEN,
      pagina: () => "<p>pagina</p>",
      marcar: (chave, marcar) => {
        if (chave === "L:naoexiste") return false;
        if (chave === "L:quebra") throw new Error("disco cheio");
        marcadas.push([chave, marcar]);
        return true;
      },
    });
  });
  afterAll(async () => srv?.fechar());
  const base = () => srv.url.replace(/\/\?k=.*$/, "");
  const post = (corpo: unknown, cab: Record<string, string> = {}) =>
    fetch(`${base()}/marcar`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Token": TOKEN, ...cab },
      body: typeof corpo === "string" ? corpo : JSON.stringify(corpo),
    });

  it("só escuta no próprio computador e a página exige o token do link", async () => {
    expect(srv.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/\?k=f{48}$/);
    expect(await (await fetch(srv.url)).text()).toBe("<p>pagina</p>");
    expect((await fetch(`${base()}/`)).status).toBe(403);
    expect((await fetch(`${base()}/?k=errado`)).status).toBe(403);
    expect((await fetch(`${base()}/outra`)).status).toBe(404);
  });

  it("recusa outro nome de servidor (site malicioso apontando para 127.0.0.1)", async () => {
    const { request } = await import("node:http");
    const porta = Number(new URL(srv.url).port);
    const status = await new Promise<number>((r) => {
      const req = request(
        {
          host: "127.0.0.1",
          port: porta,
          path: `/?k=${TOKEN}`,
          headers: { Host: `malicioso.example:${porta}` },
        },
        (res) => r(res.statusCode ?? 0),
      );
      req.end();
    });
    expect(status).toBe(403);
  });

  it("marcar: exige o token no cabeçalho, JSON e uma chave válida; responde em português", async () => {
    expect((await post({ chave: "L:aaa", marcar: true }, { "X-Token": "x" })).status).toBe(403);
    expect(
      (await post({ chave: "L:aaa", marcar: true }, { "Content-Type": "text/plain" })).status,
    ).toBe(415);
    expect((await post("{quebrado")).status).toBe(400);
    expect((await post({ chave: "L:a b", marcar: true })).status).toBe(400);
    expect((await post({ chave: "L:aaa", marcar: "sim" })).status).toBe(400);
    expect((await post("x".repeat(10_000))).status).toBe(400);
    const nao = await post({ chave: "L:naoexiste", marcar: true });
    expect(nao.status).toBe(404);
    expect(await nao.json()).toMatchObject({
      ok: false,
      erro: "ligação não encontrada nos registros",
    });
    expect((await post({ chave: "L:quebra", marcar: true })).status).toBe(500);
    expect(marcadas).toEqual([]);
    const ok = await post({ chave: "L:aaa", marcar: true });
    expect(await ok.json()).toEqual({ ok: true });
    expect(marcadas).toEqual([["L:aaa", true]]);
  });
});

describe.skipIf(!CHROMIUM_DE_TESTE)("relatório no navegador: botão Marcar como callback", () => {
  let host: HospedeNavegador;
  let pagina: Page;
  let srv: ServidorRelatorio;
  const pasta = mkdtempSync(join(tmpdir(), "tb-cbm-"));
  const arqManuais = join(pasta, ARQUIVO_CALLBACKS_MANUAIS);
  const registro =
    bloco(em(9, 0), "908113", "0111", "aaa") +
    bloco(em(9, 10), "908113", "0222", "bbb") +
    bloco(em(9, 12), "908113", "0222", "bbb", true);
  // mesma montagem do relatorio/cli.ts: relê os registros a cada pedido
  const montar = () =>
    montarLigacoes(
      lerRegistro(registro, "transferencia"),
      new Map([["aaa", 200]]),
      lerCallbacksManuais(existsSync(arqManuais) ? readFileSync(arqManuais, "utf8") : ""),
    );
  const TOKEN = "a1".repeat(24);
  const total = () =>
    pagina.evaluate(
      () =>
        (window as unknown as { __relatorio: { total: Record<string, number> } }).__relatorio.total,
    );

  beforeAll(async () => {
    srv = await iniciarServidor({
      token: TOKEN,
      pagina: () =>
        paginaHtml({
          geradoEm: new Date(),
          ...montar(),
          inicial: { periodo: "hoje" },
          servidor: { token: TOKEN },
        }),
      marcar: (chave, marcar) => {
        if (!montar().ligacoes.some((l) => l.chave === chave)) return false;
        appendFileSync(arqManuais, linhaDeMarcacao(chave, marcar, new Date()));
        return true;
      },
    });
    host = await navegadorDeTeste();
    pagina = host.paginaPrincipal();
    await pagina.setViewportSize({ width: 1200, height: 900 });
    await pagina.goto(srv.url);
  }, 60_000);
  afterAll(async () => {
    await host?.encerrar();
    await srv?.fechar();
  });

  it("só a ligação atendida tem o botão; o callback do bot não", async () => {
    await expect.poll(() => pagina.locator("#detalhe tbody tr").count()).toBe(2);
    expect(await pagina.locator("#detalhe button.mini").allInnerTexts()).toEqual([
      "Marcar como callback",
    ]);
    expect(await total()).toMatchObject({ total: 2, sem: 1, cb: 1, nd: 1 });
  });

  it("Cancelar na janela de confirmação não muda nada", async () => {
    await pagina.locator("#detalhe button.mini").click();
    await expect.poll(() => pagina.locator("#confirma").isVisible()).toBe(true);
    expect(await pagina.locator("#conf-cliente").innerText()).toBe("0111");
    await pagina.locator("#conf-nao").click();
    expect(await pagina.locator("#confirma").isVisible()).toBe(false);
    expect(existsSync(arqManuais)).toBe(false);
    expect(await total()).toMatchObject({ sem: 1, cb: 1 });
  });

  it("Confirmar grava no arquivo, recalcula o relatório e continua marcado depois de recarregar", async () => {
    await pagina.locator("#detalhe button.mini").click();
    await pagina.locator("#conf-sim").click();
    await expect.poll(() => pagina.locator("#confirma").isVisible()).toBe(false);
    expect(await total()).toMatchObject({ total: 2, sem: 0, cb: 2, nd: 0 });
    expect(readFileSync(arqManuais, "utf8")).toMatch(/\| MARCADA COMO CALLBACK \| Ligação: aaa\n$/);
    expect(await pagina.locator("#detalhe").innerText()).toContain("(marcado no relatório)");

    await pagina.reload();
    expect(await total()).toMatchObject({ sem: 0, cb: 2 });
    expect(await pagina.locator("#detalhe button.mini").allInnerTexts()).toEqual(["Desfazer"]);
  });

  it("Desfazer (também com confirmação) volta a ligação para atendida, com a duração", async () => {
    await pagina.locator("#detalhe button.mini").click();
    expect(await pagina.locator("#conf-sim").innerText()).toBe("Desfazer");
    await pagina.locator("#conf-sim").click();
    await expect.poll(() => pagina.locator("#confirma").isVisible()).toBe(false);
    expect(await total()).toMatchObject({ sem: 1, cb: 1, nd: 1, ds: 200 });
    expect(readFileSync(arqManuais, "utf8")).toMatch(/\| DESMARCADA \| Ligação: aaa\n$/);
  });

  it("se a janela do relatorio.bat foi fechada, avisa na própria janela de confirmação e nada muda", async () => {
    await srv.fechar();
    await pagina.locator("#detalhe button.mini").click();
    await pagina.locator("#conf-sim").click();
    await expect.poll(() => pagina.locator("#conf-erro").innerText()).toContain("relatorio.bat");
    expect(await total()).toMatchObject({ sem: 1, cb: 1 });
    await pagina.locator("#conf-nao").click();
  });

  it("aberta como arquivo (sem o relatorio.bat): sem botões e com a explicação", async () => {
    const f = join(pasta, "r.html");
    writeFileSync(
      f,
      paginaHtml({ geradoEm: new Date(), ...montar(), inicial: { periodo: "hoje" } }),
    );
    await pagina.goto(`file://${f}`);
    expect(await pagina.locator("#detalhe button.mini").count()).toBe(0);
    expect(await pagina.locator("#nota-acao").innerText()).toContain(
      "abra o relatório pelo relatorio.bat",
    );
    expect(await pagina.locator("#detalhe thead th:last-child").isVisible()).toBe(false);
  });
});
