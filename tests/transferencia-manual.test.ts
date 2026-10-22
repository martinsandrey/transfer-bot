import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright";
import type { HospedeNavegador } from "../src/navegador/navegador.js";
import { dadosDasLigacoes, dadosDasLongas, paginaHtml } from "../src/relatorio/pagina.js";
import { lerRegistro, montarLigacoes } from "../src/relatorio/relatorio.js";
import { iniciarServidor, type ServidorRelatorio } from "../src/relatorio/servidor.js";
import {
  blocoDeTransferenciaManual,
  validarTransferenciaManual,
} from "../src/relatorio/transferencias-manuais.js";
import { CHROMIUM_DE_TESTE, navegadorDeTeste } from "./helpers/navegador-teste.js";

const OK = {
  nome: "Fulano de Tal",
  cpf: "123.456.789-09",
  telefone: "(55) 21 90000-0101",
  linha1: "908113",
};

describe("transferência manual: validação e bloco", () => {
  it("limpa os dados e aceita os campos normais", () => {
    const r = validarTransferenciaManual({ ...OK, nome: "  Fulano   de  Tal " });
    expect(r).toEqual({
      ok: true,
      dados: {
        nome: "Fulano de Tal",
        cpf: "123.456.789-09",
        telefone: "5521900000101",
        linha1: "908113",
      },
    });
  });

  it("recusa campos vazios, formatos errados e tentativas de forjar outro registro", () => {
    const ruim = (o: Record<string, unknown>) => validarTransferenciaManual({ ...OK, ...o }).ok;
    expect(ruim({ nome: "" })).toBe(false);
    expect(ruim({ nome: "A\n===== 2026-01-01 00:00:00 | ENVIADA =====" })).toBe(false);
    expect(ruim({ nome: "x".repeat(101) })).toBe(false);
    expect(ruim({ cpf: "123" })).toBe(false);
    expect(ruim({ cpf: "abc.456.789-09" })).toBe(false);
    expect(ruim({ telefone: "123" })).toBe(false);
    expect(ruim({ linha1: "12" })).toBe(false);
    expect(ruim({ linha1: "90 | 8113" })).toBe(false);
    expect(ruim({ quando: "ontem" })).toBe(false);
    expect(ruim({ quando: "2026-02-31T10:00" })).toBe(false);
    expect(validarTransferenciaManual(null).ok).toBe(false);
    expect(validarTransferenciaManual({ ...OK, nome: 5 }).ok).toBe(false);
  });

  it("o bloco é lido pelo relatório como transferência real do funcionário, com Location/Age/Occupation vazios", () => {
    const v = validarTransferenciaManual({ ...OK, quando: "2026-10-22T14:30" });
    if (!v.ok) throw new Error("deveria validar");
    const bloco = blocoDeTransferenciaManual(v.dados, new Date(), "ab12cd34");
    expect(bloco).toContain(
      "Location: \nAge: \nOccupation: \nPh: 5521900000101\nLine 1 number: 908113",
    );
    const [e, ...resto] = lerRegistro(bloco, "transferencia");
    expect(resto).toEqual([]);
    expect(e).toMatchObject({
      tipo: "transferencia",
      enviada: true,
      funcionario: "908113",
      cliente: "5521900000101",
      ligacao: "manual-ab12cd34",
    });
    expect(e?.quando).toEqual(new Date(2026, 9, 22, 14, 30, 0));
    const [l, ...outras] = montarLigacoes(lerRegistro(bloco, "transferencia"), new Map()).ligacoes;
    expect(outras).toEqual([]);
    expect(l).toMatchObject({ funcionario: "908113", resultado: "atendida", observacao: false });
  });
});

const TOKEN = "c3".repeat(24);
let gravado = "";
const montar = () => montarLigacoes(lerRegistro(gravado, "transferencia"), new Map());
const opcoes = () => ({
  token: TOKEN,
  pagina: () =>
    paginaHtml({
      geradoEm: new Date(),
      ...montar(),
      inicial: { periodo: "tudo" },
      servidor: { token: TOKEN },
    }),
  marcar: () => true,
  dados: () => {
    const m = montar();
    return { ligacoes: dadosDasLigacoes(m.ligacoes), longas: dadosDasLongas(m.longas) };
  },
  adicionar: (d: Parameters<typeof blocoDeTransferenciaManual>[0]) => {
    gravado += blocoDeTransferenciaManual(d);
  },
});

describe("rota /adicionar do servidor do relatório", () => {
  let srv: ServidorRelatorio;
  beforeAll(async () => {
    gravado = "";
    srv = await iniciarServidor(opcoes());
  });
  afterAll(async () => srv?.fechar());
  const base = () => srv.url.replace(/\/\?k=.*$/, "");
  const enviar = (corpo: unknown, cab: Record<string, string> = {}) =>
    fetch(`${base()}/adicionar`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Token": TOKEN, ...cab },
      body: JSON.stringify(corpo),
    });

  it("sem token, sem JSON ou com dados ruins não grava nada", async () => {
    expect((await enviar(OK, { "X-Token": "x" })).status).toBe(403);
    expect((await enviar(OK, { "Content-Type": "text/plain" })).status).toBe(415);
    const r = await enviar({ ...OK, cpf: "1" });
    expect(r.status).toBe(400);
    expect(((await r.json()) as { erro: string }).erro).toMatch(/CPF/);
    expect(gravado).toBe("");
  });

  it("grava e devolve as ligações já com a nova", async () => {
    const r = await enviar(OK);
    expect(r.status).toBe(200);
    const j = (await r.json()) as { ok: boolean; ligacoes: unknown[] };
    expect(j.ok).toBe(true);
    expect(j.ligacoes).toHaveLength(1);
    expect(gravado).toContain("NAME: Fulano de Tal");
  });

  it("sem a opção `adicionar` a rota não existe", async () => {
    const { token, pagina, marcar } = opcoes();
    const sem = await iniciarServidor({ token, pagina, marcar });
    try {
      const b = sem.url.replace(/\/\?k=.*$/, "");
      const r = await fetch(`${b}/adicionar`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Token": TOKEN },
        body: JSON.stringify(OK),
      });
      expect(r.status).toBe(404);
    } finally {
      await sem.fechar();
    }
  });
});

describe.skipIf(!CHROMIUM_DE_TESTE)(
  "relatório no navegador: adicionar transferência manual",
  () => {
    let host: HospedeNavegador;
    let pagina: Page;
    let srv: ServidorRelatorio;
    beforeAll(async () => {
      gravado = "";
      srv = await iniciarServidor(opcoes());
      host = await navegadorDeTeste();
      pagina = host.paginaPrincipal();
      await pagina.goto(srv.url);
    }, 60_000);
    afterAll(async () => {
      await host?.encerrar();
      await srv?.fechar();
    });

    it("abre o formulário com a data de agora, mostra o erro e, com dados certos, inclui a ligação na lista", async () => {
      await pagina.locator("#vivo-btn").click(); // pausa a atualização automática: a lista só pode mudar pela resposta do /adicionar
      await pagina.locator("#adicionar-btn").click();
      expect(await pagina.locator("#add-quando").inputValue()).toMatch(
        /^\d{4}-\d\d-\d\dT\d\d:\d\d$/,
      );
      await pagina.fill("#add-nome", "Fulano de Tal");
      await pagina.fill("#add-cpf", "123");
      await pagina.fill("#add-tel", "5521900000101");
      await pagina.fill("#add-linha", "908113");
      await pagina.locator("#add-salva").click();
      await expect.poll(() => pagina.locator("#add-erro").innerText()).toMatch(/CPF/);
      expect(
        await pagina.locator("#adicionar").evaluate((d) => (d as HTMLDialogElement).open),
      ).toBe(true);
      await pagina.fill("#add-cpf", "12345678909");
      await pagina.locator("#add-salva").click();
      await expect
        .poll(() => pagina.locator("#adicionar").evaluate((d) => (d as HTMLDialogElement).open))
        .toBe(false);
      // (sem ligações a tabela mostra uma linha de aviso; por isso confere o conteúdo, não só a contagem)
      await expect.poll(() => pagina.locator("#detalhe tbody").innerText()).toContain("908113");
      expect(gravado).toContain("Line 1 number: 908113");
    });
  },
);
