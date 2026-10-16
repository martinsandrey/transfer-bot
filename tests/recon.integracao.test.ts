import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Anonimizador } from "../src/recon/anonimizador.js";
import {
  amostrarAbas,
  analisarSerie,
  capturarPagina,
  capturarSerie,
} from "../src/recon/captura.js";
import { varrerTexto } from "../src/recon/escritor.js";
import { ObservadorRede } from "../src/recon/rede.js";
import type { HospedeNavegador } from "../src/navegador/navegador.js";
import { CHROMIUM_DE_TESTE, navegadorDeTeste } from "./helpers/navegador-teste.js";
import { iniciarSiteSimulado, type SiteSimulado } from "./helpers/site-simulado.js";

const NUMEROS_FICTICIOS = [
  "5511900000001",
  "5511900000002",
  "5511900000003",
  "5521900000101",
  "5521900000104",
  "88776655",
  "11223344",
];

describe.skipIf(!CHROMIUM_DE_TESTE)("reconhecimento contra o site simulado", () => {
  let site: SiteSimulado;
  let nav: HospedeNavegador;
  let rede: ObservadorRede;

  beforeAll(async () => {
    site = await iniciarSiteSimulado(300);
    nav = await navegadorDeTeste();
    rede = new ObservadorRede(nav.contexto);
    rede.iniciar();
  }, 60000);
  afterAll(async () => {
    await nav?.encerrar();
    await site?.fechar();
  });

  it("captura a tela de login sem valores e detecta ausência de captcha", async () => {
    await nav.abrirUrl(`${site.url}/login`);
    const anon = new Anonimizador();
    const cap = (await capturarPagina(nav.paginaPrincipal(), anon, "login")) as {
      captcha: { detectado: boolean };
      controles: Array<{ tag: string; tipo: string | null; rotulo: string | null }>;
    };
    expect(cap.captcha.detectado).toBe(false);
    const senha = cap.controles.find((c) => c.tipo === "password");
    expect(senha?.rotulo).toBe("Senha");
    expect(JSON.stringify(cap)).not.toContain('"value"');
  });

  it("captura série da tabela: reordenação, transições, ID oculto e nenhum valor real na saída", async () => {
    await nav.abrirUrl(`${site.url}/chamadas`);
    await nav.paginaPrincipal().waitForSelector("#corpo tr");
    const anon = new Anonimizador();
    const pagina = await capturarPagina(nav.paginaPrincipal(), anon, "tabela");
    const serie = await capturarSerie(nav.paginaPrincipal(), anon, {
      duracaoMs: 6000,
      intervaloMs: 150,
      indiceTabela: null,
    });
    const analise = analisarSerie(serie);

    expect(serie.cabecalhos).toEqual([
      "Callback Number",
      "Callee Number",
      "Call Status",
      "Start Time",
      "Call Duration",
    ]);
    expect(analise.colunasEncontradas["Callback Number"]).toBe(0);
    expect(analise.snapshots).toBeGreaterThan(10);
    expect(analise.statusDistintos).toEqual(
      expect.arrayContaining(["Stage 1 Agent", "Stage 2 Agent", "Stage 3 Agent"]),
    );
    // a transferência real NÃO é mudança de status na mesma linha: aparece como troca de linha com o mesmo Callee
    expect(analise.trocasDeLinhaPorCallee.length).toBeGreaterThanOrEqual(1);
    expect(analise.trocasDeLinhaPorCallee[0]).toMatchObject({
      deStatus: "Stage 1 Agent",
      paraStatus: "Stage 3 Agent",
    });
    expect(analise.transicoesDeStatus["Stage 1 Agent → Stage 2 Agent"]).toBeGreaterThanOrEqual(1);
    expect(analise.pares_com_ordem_diferente).toBeGreaterThan(0);
    expect(analise.snapshotsComCallbackDuplicado).toBe(0);
    expect(analise.snapshotsComMutacao).toBeGreaterThan(5);
    // funcionário A some e volta com outra ligação (Start Time diferente)
    expect(analise.reaparecimentosComInicioDiferente).toBeGreaterThanOrEqual(1);

    const texto = JSON.stringify({ pagina, serie, analise });
    for (const n of NUMEROS_FICTICIOS) expect(texto).not.toContain(n);
    expect(texto).toContain("FUNC_01");
    expect(texto).toContain("textoOcultoDiferente");
    expect(texto).not.toContain("2000-01-01");
    expect(varrerTexto("t.json", texto, [])).toEqual([]);
  }, 60000);

  it("observação de rede é passiva e guarda só a estrutura", async () => {
    const resumo = rede.resumo();
    const api = resumo.find((r) => r.caminho === "/api/chamadas");
    expect(api).toBeDefined();
    expect(api?.metodo).toBe("GET");
    expect(api?.intervaloMedianoMs).not.toBeNull();
    const texto = JSON.stringify(resumo);
    for (const n of NUMEROS_FICTICIOS) expect(texto).not.toContain(n);
    expect(texto).toContain("linhas");
  });

  it("amostra abas com visibilidade e mutações", async () => {
    const amostras = await amostrarAbas(() => nav.contexto.pages(), 1500);
    expect(amostras.length).toBeGreaterThan(0);
    expect(amostras[0]?.visibilidade).toBeDefined();
  });

  it("tela de clientes: campos de busca, botão e link Edit aparecem; nomes de clientes (title) NÃO vazam", async () => {
    await nav.abrirUrl(`${site.url}/clientes-lista`);
    const anon = new Anonimizador();
    const cap = JSON.stringify(await capturarPagina(nav.paginaPrincipal(), anon, "resultado"));
    expect(cap).not.toContain("NOME FICTICIO");
    expect(cap).not.toContain("OUTRO NOME");
    expect(cap).not.toContain("011900000101");
    expect(cap).toContain("ft[phone]"); // nome do campo de busca por telefone
    expect(cap).toContain('"rotuloDaCelula":"Phone："'); // rótulo ligado ao campo (formulário feito de tabela)
    expect(cap).toContain('"textoBotao":"Search"');
    expect(cap).toContain("Edit"); // ícone de ação da linha
    expect(varrerTexto("c.json", cap, [])).toEqual([]);
  });
});
