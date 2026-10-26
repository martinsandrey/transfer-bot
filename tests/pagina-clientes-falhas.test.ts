import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ConsultaDeCliente } from "../src/consulta/consulta-cliente.js";
import { PaginaClientesPlaywright } from "../src/consulta/pagina-clientes-playwright.js";
import { CHROMIUM_DE_TESTE, navegadorDeTeste } from "./helpers/navegador-teste.js";

/** Site FICTÍCIO que se comporta mal de propósito, para provar que a consulta falha RÁPIDO e sem travar o programa. */
type Modo = "ok" | "sem_menu" | "busca_nao_recarrega" | "sem_edit" | "edicao_demora";
let modo: Modo = "ok";

const INDEX = (): string => `<!doctype html><title>Painel</title>
${modo === "sem_menu" ? "<p>Faça login</p>" : '<div class="m">Customer Data List</div><div class="m">Voice Call Status</div>'}
<iframe id="c" src="/modules/cc_monitor/curcall_in.php" style="width:90%;height:400px"></iframe>
<script>const alvo={"Customer Data List":"/modules/cc_cds/","Voice Call Status":"/modules/cc_monitor/curcall_in.php"};
document.querySelectorAll(".m").forEach(e=>e.onclick=()=>{document.getElementById("c").src=alvo[e.textContent]});</script>`;
const LISTA = (phone: string): string => `<!doctype html>
<form method="get"><input name="ft[mob_phone]"><input name="ft[phone]"><input type="submit" id="submitButton" value="Search" ${modo === "busca_nao_recarrega" ? 'onclick="return false"' : ""}></form>
<form method="post" action="/modules/cc_cds/delete.php"><table>${
  phone.endsWith("01")
    ? `<tr><td><input type="checkbox" name="checkboxes[]"></td><td>${modo === "sem_edit" ? "" : '<a href="/modules/cc_cds/edit.php?id=1">Edit</a>'}</td></tr>`
    : ""
}</table></form>`;
const EDICAO = `<!doctype html><form action="/modules/cc_cds/update.php" method="post"><table>
<tr><td>Name：</td><td><input value="Fulano Ficticio"></td></tr><tr><td>Phone：</td><td><input value="011900000001"></td></tr></table></form>`;

let servidor: Server;
let base = "";
beforeAll(async () => {
  if (!CHROMIUM_DE_TESTE) return;
  servidor = createServer((req, res) => {
    const u = new URL(req.url ?? "/", "http://x");
    const enviar = (corpo: string): void => {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(corpo);
    };
    if (u.pathname === "/modules/index.php") enviar(INDEX());
    else if (u.pathname === "/modules/cc_cds/")
      enviar(LISTA(u.searchParams.get("ft[phone]") ?? ""));
    else if (u.pathname === "/modules/cc_cds/edit.php") {
      if (modo === "edicao_demora") setTimeout(() => enviar(EDICAO), 8000);
      else enviar(EDICAO);
    } else enviar("<!doctype html><table class='adminlist'></table>");
  });
  await new Promise<void>((r) => servidor.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
});
afterAll(async () => {
  if (servidor) {
    servidor.closeAllConnections();
    await new Promise<void>((r) => servidor.close(() => r()));
  }
});

describe.skipIf(!CHROMIUM_DE_TESTE)("consulta ao cadastro quando o site se comporta mal", () => {
  async function tentar(
    m: Modo,
  ): Promise<{ erro: string | null; ms: number; falhouAoVoltar: number }> {
    modo = m;
    const h = await navegadorDeTeste();
    try {
      await h.abrirUrl(`${base}/modules/index.php`);
      let falhouAoVoltar = 0;
      const c = new ConsultaDeCliente(
        new PaginaClientesPlaywright(h.paginaPrincipal(), { timeoutMs: 1500 }),
        () => void falhouAoVoltar++,
      );
      const t0 = Date.now();
      let erro: string | null = null;
      try {
        await c.find("011900000001");
      } catch (e) {
        erro = e instanceof Error ? e.message : String(e);
      }
      return { erro, ms: Date.now() - t0, falhouAoVoltar };
    } finally {
      await h.encerrar();
      modo = "ok";
    }
  }

  it("sem o menu (ex.: caiu na tela de login): falha rápido, com erro, e avisa que não conseguiu voltar", async () => {
    const r = await tentar("sem_menu");
    expect(r.erro).toMatch(/Customer Data List|menu/i);
    expect(r.ms).toBeLessThan(8000);
    expect(r.falhouAoVoltar).toBe(1);
  });

  it("botão Search que não recarrega a lista: falha por tempo, sem travar", async () => {
    const r = await tentar("busca_nao_recarrega");
    expect(r.erro).not.toBeNull();
    expect(r.ms).toBeLessThan(10_000);
  });

  it("resultado sem link Edit: falha por tempo e ainda tenta voltar à Voice Call Status", async () => {
    const r = await tentar("sem_edit");
    expect(r.erro).not.toBeNull();
    expect(r.ms).toBeLessThan(10_000);
    expect(r.falhouAoVoltar).toBe(0); // o menu existe: voltou normalmente
  });

  it("formulário de edição que demora mais que o limite: falha por tempo em vez de esperar para sempre", async () => {
    const r = await tentar("edicao_demora");
    expect(r.erro).not.toBeNull();
    expect(r.ms).toBeLessThan(9000);
  });

  it("controle: com o site normal tudo funciona", async () => {
    const r = await tentar("ok");
    expect(r.erro).toBeNull();
  });
});
