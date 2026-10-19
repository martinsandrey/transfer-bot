import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AdaptadorLoginDoSite } from "../src/login/adaptador-site.js";
import { abrirMenusAte, descreverMenu } from "../src/navegador/menu-lateral.js";
import type { HospedeNavegador } from "../src/navegador/navegador.js";
import { CHROMIUM_DE_TESTE, navegadorDeTeste } from "./helpers/navegador-teste.js";

/** Menu FICTÍCIO recolhido, no estilo da árvore dhtmlx: três grupos com botão "+" que revelam seus itens. */
const MENU = (
  opcoes: { semMais?: boolean; aninhado?: boolean } = {},
): string => `<!doctype html><title>Menu</title>
<style>.filho{display:none}.aberto>.filho{display:block}</style>
<div id="arvore">
  ${[1, 2, 3]
    .map(
      (n) => `<div class="grupo" id="g${n}">
    ${opcoes.semMais ? "" : `<img class="exp" src="/img/plus.gif" width="16" height="16" alt="">`}<span class="standartTreeRow">Grupo ${n}</span>
    <div class="filho">
      ${n === 2 ? `<div class="standartTreeRow item" id="vcs">Voice Call Status</div>` : ""}
      ${n === 3 ? `<div class="standartTreeRow item" id="cdl">Customer Data List</div><div class="standartTreeRow item" id="del">Delete Records</div>` : ""}
      ${
        opcoes.aninhado && n === 1
          ? `<div class="grupo" id="g1a"><img class="exp" src="/img/plus.gif" width="16" height="16" alt=""><span class="standartTreeRow">Sub</span><div class="filho"><div class="standartTreeRow item" id="fundo">Item Fundo</div></div></div>`
          : ""
      }
    </div></div>`,
    )
    .join("")}
</div>
<script>
window.cliques = [];
document.addEventListener("click", (e) => {
  const t = e.target;
  if (t.classList.contains("exp")) {
    const g = t.parentElement; const abrir = !g.classList.contains("aberto");
    g.classList.toggle("aberto", abrir); t.setAttribute("src", abrir ? "/img/minus.gif" : "/img/plus.gif"); window.cliques.push("exp:" + g.id);
  } else if (t.classList.contains("item")) window.cliques.push("item:" + t.id);
});
</script>`;

describe.skipIf(!CHROMIUM_DE_TESTE)("menu lateral recolhido (site fictício)", () => {
  let host: HospedeNavegador;
  beforeAll(async () => {
    host = await navegadorDeTeste();
  }, 60_000);
  afterAll(async () => host?.encerrar());

  const cliques = () =>
    host.paginaPrincipal().evaluate(() => (window as unknown as { cliques: string[] }).cliques);

  it("abre os grupos até o item aparecer e para (não abre os que não precisa)", async () => {
    const p = host.paginaPrincipal();
    await p.setContent(MENU());
    expect(await abrirMenusAte(p, "Voice Call Status")).toBe(true);
    const c = await cliques();
    expect(c).toContain("exp:g2");
    expect(c.every((x) => x.startsWith("exp:"))).toBe(true); // só botões "+"; nenhum item foi clicado
  });

  it("os dois itens ficam visíveis (Voice Call Status e Customer Data List) e nada é clicado além dos '+'", async () => {
    const p = host.paginaPrincipal();
    await p.setContent(MENU());
    expect(await abrirMenusAte(p, "Voice Call Status")).toBe(true);
    expect(await abrirMenusAte(p, "Customer Data List")).toBe(true);
    expect(await p.getByText("Customer Data List", { exact: true }).isVisible()).toBe(true);
    expect((await cliques()).filter((x) => x.startsWith("item:"))).toEqual([]);
  });

  it("grupo dentro de grupo: abre também o '+' que só aparece depois", async () => {
    const p = host.paginaPrincipal();
    await p.setContent(MENU({ aninhado: true }));
    expect(await abrirMenusAte(p, "Item Fundo")).toBe(true);
  });

  it("menu já aberto: não clica em nenhum '+'", async () => {
    const p = host.paginaPrincipal();
    await p.setContent(MENU());
    await p.locator("#g2 > img.exp").click();
    await p.evaluate(() => ((window as unknown as { cliques: string[] }).cliques.length = 0));
    expect(await abrirMenusAte(p, "Voice Call Status")).toBe(true);
    expect(await cliques()).toEqual([]);
  });

  it("sem botões '+' e item ausente: devolve false sem erro e descreve o menu", async () => {
    const p = host.paginaPrincipal();
    await p.setContent(MENU({ semMais: true }));
    expect(await abrirMenusAte(p, "Voice Call Status")).toBe(false);
    expect(await descreverMenu(p)).toContain("linhas=");
    await p.setContent("<p>sem menu</p>");
    expect(await abrirMenusAte(p, "Voice Call Status")).toBe(false);
    expect(await descreverMenu(p)).toContain("nenhum frame");
  });

  it("depois do login: o adaptador abre os menus ANTES de clicar em Voice Call Status", async () => {
    const p = host.paginaPrincipal();
    await p.setContent(MENU());
    const adaptador = new AdaptadorLoginDoSite(
      p,
      { tabelaPresente: async () => false },
      { timeoutMs: 5000 },
    );
    expect(await adaptador.detectar()).toBe("desconhecido");
    const c = await cliques();
    const iExp = c.indexOf("exp:g2");
    const iItem = c.indexOf("item:vcs");
    expect(iExp).toBeGreaterThanOrEqual(0);
    expect(iItem).toBeGreaterThan(iExp);
  });

  it("menu impossível de abrir: avisa uma única vez (diagnóstico) e não derruba nada", async () => {
    const p = host.paginaPrincipal();
    await p.setContent(MENU({ semMais: true }));
    const avisos: string[] = [];
    let t = 0;
    const adaptador = new AdaptadorLoginDoSite(
      p,
      { tabelaPresente: async () => false },
      { timeoutMs: 2000, agora: () => (t += 10_000), diagnostico: (x) => avisos.push(x) },
    );
    await adaptador.detectar();
    await adaptador.detectar();
    expect(avisos).toHaveLength(1);
    expect(avisos[0]).toContain("Voice Call Status");
  });
});
