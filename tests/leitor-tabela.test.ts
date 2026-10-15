import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SessaoExpiradaError } from "../src/dominio/tipos.js";
import type { HospedeNavegador } from "../src/navegador/navegador.js";
import {
  LeitorTabelaHtml,
  normalizarTelefone,
  parseDuracao,
  tabelaParaLinhas,
} from "../src/leitura/leitor-tabela.js";
import type { TabelaBruta } from "../src/recon/pagina-dom.js";
import { CHROMIUM_DE_TESTE, navegadorDeTeste } from "./helpers/navegador-teste.js";
import { iniciarSiteSimulado, type SiteSimulado } from "./helpers/site-simulado.js";

describe("normalização", () => {
  it("telefones viram só dígitos", () =>
    expect(normalizarTelefone("+55 (11) 90000-0001")).toBe("5511900000001"));
  it("duração em segundos; formato desconhecido → null", () => {
    expect(parseDuracao("42")).toBe(42);
    expect(parseDuracao("01:05")).toBe(65);
    expect(parseDuracao("01:02:03")).toBe(3723);
    expect(parseDuracao("1m 5s")).toBeNull();
    expect(parseDuracao("")).toBeNull();
  });
});

function tabela(cab: string[], linhas: string[][]): TabelaBruta {
  return {
    indice: 0,
    tipo: "table",
    atributos: {},
    cabecalhos: cab,
    totalLinhas: linhas.length,
    linhas: linhas.map((l) => ({
      atributos: {},
      celulas: l.map((texto) => ({ texto, textoOculto: null, atributos: {}, esqueleto: "td" })),
    })),
  };
}
const CAB = ["Callback Number", "Callee Number", "Call Status", "Start Time", "Call Duration"];

describe("tabelaParaLinhas", () => {
  it("mapeia por cabeçalho, independentemente da ordem das colunas", () => {
    const r = tabelaParaLinhas(
      tabela(
        ["Call Status", "Start Time", "Callee Number", "Callback Number"],
        [["Stage 1 Agent", "10:00", "(21) 90000-0101", "11 90000-0001"]],
      ),
    );
    expect(r).toEqual({
      ok: true,
      rows: [
        {
          callbackNumber: "1190000" + "0001",
          calleeNumber: "21900000101",
          callStatus: "Stage 1 Agent",
          startTime: "10:00",
          callDurationSec: null,
        },
      ],
    });
  });
  it("linha incompleta ou com nº de células diferente invalida a leitura inteira", () => {
    expect(tabelaParaLinhas(tabela(CAB, [["", "x", "Stage 1 Agent", "t", "0"]]))).toEqual({
      ok: false,
      motivo: "linha_incompleta",
    });
    expect(tabelaParaLinhas(tabela(CAB, [["1", "2", "Stage 1 Agent"]]))).toMatchObject({
      ok: false,
    });
  });
  it("cabeçalho obrigatório ausente invalida", () => {
    expect(tabelaParaLinhas(tabela(["Callback Number"], []))).toMatchObject({ ok: false });
  });
});

describe.skipIf(!CHROMIUM_DE_TESTE)("LeitorTabelaHtml contra o site simulado", () => {
  let site: SiteSimulado;
  let nav: HospedeNavegador;
  beforeAll(async () => {
    site = await iniciarSiteSimulado(300);
    nav = await navegadorDeTeste();
  }, 60000);
  afterAll(async () => {
    await nav?.encerrar();
    await site?.fechar();
  });

  it("lê linhas tipadas e válidas várias vezes seguidas, mesmo com a tabela sendo reconstruída", async () => {
    await nav.abrirUrl(`${site.url}/chamadas`);
    await nav.paginaPrincipal().waitForSelector("#corpo tr");
    const leitor = new LeitorTabelaHtml(nav.paginaPrincipal());
    expect(await leitor.tabelaPresente()).toBe(true);
    let validas = 0;
    for (let i = 0; i < 25; i++) {
      const s = await leitor.read();
      if (s.valid) {
        validas++;
        expect(s.rows.length).toBeGreaterThanOrEqual(2);
        for (const r of s.rows) expect(r.callbackNumber).toMatch(/^\d+$/);
      }
      await nav.paginaPrincipal().waitForTimeout(40);
    }
    expect(validas).toBeGreaterThan(15);
  }, 30000);

  it("sem a tabela: leituras inválidas e, ao persistir, sessão expirada", async () => {
    await nav.abrirUrl(`${site.url}/login`);
    const leitor = new LeitorTabelaHtml(nav.paginaPrincipal(), { tolerarSemTabela: 3 });
    expect(await leitor.tabelaPresente()).toBe(false);
    expect((await leitor.read()).invalidReason).toBe("tabela_nao_encontrada");
    await leitor.read();
    await expect(leitor.read()).rejects.toBeInstanceOf(SessaoExpiradaError);
  });
});
