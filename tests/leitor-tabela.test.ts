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
import { Anonimizador } from "../src/recon/anonimizador.js";
import {
  capturarSerie,
  diagnosticarPagina,
  escolherTabelaDeChamadas,
} from "../src/recon/captura.js";
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
    expect(r).toMatchObject({
      ok: true,
      ignoradas: 0,
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
  it("linha com dado faltando é IGNORADA sozinha; as demais continuam valendo e a leitura segue válida", () => {
    const r = tabelaParaLinhas(
      tabela(CAB, [
        ["111", "222", "Stage 1 Agent", "10:00:00", "00:00:05"], // ok
        ["", "222", "Stage 1 Agent", "10:00:00", "00:00:05"], // sem Callback
        ["333", "", "Stage 1 Agent", "10:00:01", "00:00:05"], // sem Callee
        ["444", "555", "", "10:00:02", "00:00:05"], // sem status
        ["666", "777", "Stage 1 Agent", "", "00:00:05"], // sem Start Time
        ["888", "999", "Stage 3 Agent", "10:00:03", ""], // sem duração: permitido
      ]),
    );
    expect(r).toMatchObject({ ok: true, ignoradas: 4 });
    if (r.ok) {
      expect(r.rows.map((x) => x.callbackNumber)).toEqual(["111", "888"]);
      expect(r.rows[1]?.callDurationSec).toBeNull();
      // chamadas cuja linha veio incompleta (mas com Callback Number) ficam "congeladas" no rastreador
      expect(r.callbacksIncompletos.sort()).toEqual(["333", "444", "666"]);
    }
  });

  it("linhas curtas demais (mensagem de tabela vazia) ou com MAIS células que cabeçalhos também são só ignoradas", () => {
    expect(tabelaParaLinhas(tabela(CAB, [["Nenhum registro"]]))).toMatchObject({
      ok: true,
      rows: [],
      ignoradas: 1,
    });
    expect(
      tabelaParaLinhas(tabela(CAB, [["1", "2", "Stage 1 Agent", "t", "0", "extra"]])),
    ).toMatchObject({ ok: true, rows: [], ignoradas: 1 });
  });

  it("ESTRUTURA CONFIRMADA PELO RECON: 8 cabeçalhos (o último é um resumo) e linhas de 7 células; Callee vem antes de Callback", () => {
    const cabReal = [
      "ID",
      "Callee Number",
      "Callback Number",
      "Call Status",
      "Start Time",
      "Call Duration",
      "Action",
      "Manual Call： 2 Stage 1：2 Stage 2：0 Stage 3：0 Stage 4：0",
    ];
    const r = tabelaParaLinhas(
      tabela(cabReal, [
        ["1", "011941445986", "908112", "Stage 1 Agent", "20:57:43", "00:01:10", ""],
        ["2", "016981544251", "908113", "Stage 1 Ringing", "20:56:47", "00:00:06", ""],
      ]),
    );
    expect(r).toMatchObject({
      ok: true,
      ignoradas: 0,
      rows: [
        {
          callbackNumber: "908112",
          calleeNumber: "011941445986",
          callStatus: "Stage 1 Agent",
          startTime: "20:57:43",
          callDurationSec: 70,
        },
        {
          callbackNumber: "908113",
          calleeNumber: "016981544251",
          callStatus: "Stage 1 Ringing",
          startTime: "20:56:47",
          callDurationSec: 6,
        },
      ],
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

describe.skipIf(!CHROMIUM_DE_TESTE)(
  "tabela em lugares menos comuns (iframe, grade de div, Shadow DOM)",
  () => {
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

    for (const caminho of ["/layout-evidencia", "/painel-iframe", "/grade-div", "/shadow"]) {
      it(`LeitorTabelaHtml lê ${caminho}`, async () => {
        await nav.abrirUrl(`${site.url}${caminho}`);
        await nav.paginaPrincipal().waitForTimeout(800);
        const leitor = new LeitorTabelaHtml(nav.paginaPrincipal());
        expect(await leitor.tabelaPresente()).toBe(true);
        let validas = 0;
        for (let i = 0; i < 10; i++) {
          const s = await leitor.read();
          if (s.valid && s.rows.length >= 2 && s.rows.every((r) => /^\d+$/.test(r.callbackNumber)))
            validas++;
          await nav.paginaPrincipal().waitForTimeout(60);
        }
        expect(validas).toBeGreaterThanOrEqual(6);
      }, 30000);

      it(`recon encontra a tabela em ${caminho} (série e diagnóstico sem dados pessoais)`, async () => {
        await nav.abrirUrl(`${site.url}${caminho}`);
        await nav.paginaPrincipal().waitForTimeout(800);
        const anon = new Anonimizador();
        const alvo = await escolherTabelaDeChamadas(nav.paginaPrincipal());
        expect(alvo).not.toBeNull();
        const serie = await capturarSerie(nav.paginaPrincipal(), anon, {
          duracaoMs: 1500,
          intervaloMs: 200,
          indiceTabela: null,
        });
        expect(serie.cabecalhos).toEqual(
          expect.arrayContaining([
            "Callback Number",
            "Callee Number",
            "Call Status",
            "Start Time",
            "Call Duration",
          ]),
        );
        expect(serie.snapshots.length).toBeGreaterThan(3);
        const diag = JSON.stringify(await diagnosticarPagina(nav.paginaPrincipal(), anon));
        expect(diag).toContain("callback number");
        for (const n of ["5511900000001", "5521900000101", "88776655"]) {
          expect(diag).not.toContain(n);
          expect(JSON.stringify(serie)).not.toContain(n);
        }
      }, 30000);
    }

    it("diagnóstico indica Shadow DOM e iframe", async () => {
      await nav.abrirUrl(`${site.url}/shadow`);
      await nav.paginaPrincipal().waitForTimeout(500);
      const d = JSON.stringify(await diagnosticarPagina(nav.paginaPrincipal(), new Anonimizador()));
      expect(d).toContain('"emShadowDom":true');
    });
  },
);
