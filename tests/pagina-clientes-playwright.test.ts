import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ConsultaDeCliente } from "../src/consulta/consulta-cliente.js";
import {
  instalarBloqueioDeEscrita,
  PaginaClientesPlaywright,
} from "../src/consulta/pagina-clientes-playwright.js";
import type { HospedeNavegador } from "../src/navegador/navegador.js";
import { CHROMIUM_DE_TESTE, navegadorDeTeste } from "./helpers/navegador-teste.js";

/** Site FICTÍCIO que imita a estrutura confirmada no recon (iframes /modules/cc_cds/ e edit.php, menu lateral, busca por GET). */
const INDEX = `<!doctype html><title>Painel</title>
<div id="menu"><div class="standartTreeRow">Customer Data List</div><div class="standartTreeRow">Voice Call Status</div></div>
<iframe id="c" name="c" src="/modules/cc_monitor/curcall_in.php" style="width:90%;height:500px"></iframe>
<script>
const alvo = { "Customer Data List": "/modules/cc_cds/", "Voice Call Status": "/modules/cc_monitor/curcall_in.php" };
document.querySelectorAll(".standartTreeRow").forEach(el => el.addEventListener("click", () => { document.getElementById("c").src = alvo[el.textContent]; }));
</script>`;

const LISTA = (phone: string, mob = ""): string => `<!doctype html><title>Lista</title>
<form id="selectForm" method="get"><table><tr><td><input name="ft[name]"></td><td><input name="ft[mob_phone]" value="${mob}"></td><td><input name="ft[phone]" value="${phone}"></td></tr>
<tr><td><input type="submit" id="submitButton" title="Search" value="Search"></td></tr></table></form>
<form id="listForm" method="post" action="/modules/cc_cds/delete.php"><table>
${
  phone.endsWith("01")
    ? `<tr><td><input type="checkbox" name="checkboxes[]"></td><td>X</td><td><a href="/modules/cc_cds/edit.php?id=1">Edit</a> <a href="/modules/cc_cds/delete.php?id=1">Delete</a></td></tr>`
    : ""
}
${
  mob.endsWith("03") && phone === ""
    ? `<tr><td><input type="checkbox" name="checkboxes[]"></td><td><a href="/modules/cc_cds/edit.php?id=4">Edit</a></td></tr>`
    : ""
}
${
  phone.endsWith("02")
    ? `<tr><td><input type="checkbox" name="checkboxes[]"></td><td><a href="/modules/cc_cds/edit.php?id=2">Edit</a></td></tr><tr><td><input type="checkbox" name="checkboxes[]"></td><td><a href="/modules/cc_cds/edit.php?id=3">Edit</a></td></tr>`
    : ""
}
</table></form>`;

const EDICAO = (
  id: string,
): string => `<!doctype html><title>Edição</title><form action="/modules/cc_cds/update.php" method="post"><table>
<tr><td>Name：</td><td><input name="name" value="Fulano Ficticio"></td><td>Customer Type：</td><td><select name="type"><option>A</option></select></td></tr>
<tr><td>ID Number：</td><td><input name="idn" value="000.000.000-01"></td><td>Date of Birth：</td><td><input name="dob" value="1980-01-31"></td></tr>
<tr><td>Mobile Phone：</td><td><input name="mob" value="${id === "4" ? "011900000003" : "999"}"></td><td>Phone：</td><td><input name="phone" value="${id === "4" ? "" : `0119000001${id === "1" ? "01" : "02"}`}"></td></tr>
<tr><td>Address：</td><td><input name="addr" value="Rua Ficticia 1"></td></tr>
</table><input type="submit" value="Edit" id="submitButton"></form>`;

let servidor: Server;
let base = "";
const acessos: string[] = [];

beforeAll(async () => {
  if (!CHROMIUM_DE_TESTE) return;
  servidor = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    acessos.push(`${req.method} ${url.pathname}`);
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    if (url.pathname === "/modules/index.php") res.end(INDEX);
    else if (url.pathname === "/modules/cc_cds/")
      res.end(
        LISTA(url.searchParams.get("ft[phone]") ?? "", url.searchParams.get("ft[mob_phone]") ?? ""),
      );
    else if (url.pathname === "/modules/cc_cds/edit.php")
      res.end(EDICAO(url.searchParams.get("id") ?? ""));
    else res.end("<!doctype html><title>Chamadas</title><table class='adminlist'></table>");
  });
  await new Promise<void>((r) => servidor.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
});
afterAll(async () => {
  if (servidor) await new Promise<void>((r) => servidor.close(() => r()));
});

describe.skipIf(!CHROMIUM_DE_TESTE)("PaginaClientesPlaywright (site fictício)", () => {
  async function comPagina<T>(
    f: (h: HospedeNavegador, c: ConsultaDeCliente) => Promise<T>,
  ): Promise<T> {
    const h = await navegadorDeTeste();
    try {
      await instalarBloqueioDeEscrita(h.contexto);
      await h.abrirUrl(`${base}/modules/index.php`);
      const c = new ConsultaDeCliente(
        new PaginaClientesPlaywright(h.paginaPrincipal(), { timeoutMs: 8000 }),
      );
      return await f(h, c);
    } finally {
      await h.encerrar();
    }
  }

  it("pesquisa, abre Edit, lê pelos rótulos e volta à Voice Call Status sem tocar em Delete/update", async () => {
    acessos.length = 0;
    const r = await comPagina((_h, c) => c.find("011900000101"));
    expect(r).toEqual({
      tipo: "ok",
      multiplos: false,
      registro: {
        nome: "Fulano Ficticio",
        cpf: "000.000.000-01",
        location: "Rua Ficticia 1",
        age: "1980-01-31",
        phone: "011900000101",
      },
    });
    expect(acessos.some((a) => a.includes("delete.php") || a.includes("update.php"))).toBe(false);
    expect(acessos.at(-1)).toBe("GET /modules/cc_monitor/curcall_in.php");
  });

  it("sem resultado: nenhum, e ainda volta à Voice Call Status", async () => {
    acessos.length = 0;
    const r = await comPagina((_h, c) => c.find("011900000999"));
    expect(r).toEqual({
      tipo: "nenhum",
      tentativas: 'Phone "011900000999"; Mobile Phone "011900000999"',
    });
    expect(acessos.at(-1)).toBe("GET /modules/cc_monitor/curcall_in.php");
  });

  it("não achou no Phone: pesquisa no Mobile Phone (com o Phone vazio) e usa o telefone desse campo", async () => {
    const r = await comPagina((_h, c) => c.find("011900000003"));
    expect(r).toMatchObject({
      tipo: "ok",
      multiplos: false,
      registro: { nome: "Fulano Ficticio", phone: "011900000003" },
    });
  });

  it("vários resultados: segue com o primeiro e marca múltiplos", async () => {
    const r = await comPagina((_h, c) => c.find("011900000102"));
    expect(r).toMatchObject({ tipo: "ok", multiplos: true });
  });

  it("o bloqueio aborta POST em update.php", async () => {
    const h = await navegadorDeTeste();
    try {
      await instalarBloqueioDeEscrita(h.contexto);
      await h.abrirUrl(`${base}/modules/index.php`);
      const status = await h.paginaPrincipal().evaluate(async () =>
        fetch("/modules/cc_cds/update.php", { method: "POST", body: "x" }).then(
          (r) => r.status,
          () => -1,
        ),
      );
      expect(status).toBe(-1);
    } finally {
      await h.encerrar();
    }
  });
});
