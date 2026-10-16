import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LeitorTabelaHtml } from "../src/leitura/leitor-tabela.js";
import { AdaptadorLoginDoSite } from "../src/login/adaptador-site.js";
import { GerenciadorLogin } from "../src/login/login-manager.js";
import { criarNotificadorFalso } from "../src/notificador/notificador.js";
import { CHROMIUM_DE_TESTE, navegadorDeTeste } from "./helpers/navegador-teste.js";

/** Site FICTÍCIO: verificação por botão → formulário (username/password/submit) → menu → tabela de chamadas em iframe. */
const ENTRADA = `<!doctype html><title>Entrar</title>
<div id="verificacao"><button id="ok" type="button">Não sou um robô</button></div>
<form id="f" action="/logincheck.php" method="post" style="display:none">
<input type="hidden" name="verify_key" value="x"><input type="hidden" name="done" value="1">
<input name="username" type="text"><input name="password" type="password"><input type="submit" name="submit" value="Login"></form>
<script>document.getElementById("ok").onclick=()=>{document.getElementById("verificacao").style.display="none";document.getElementById("f").style.display="block";};</script>`;
const INDEX = `<!doctype html><title>Painel</title><div class="standartTreeRow">Voice Call Status</div>
<iframe id="c" src="about:blank" style="width:90%;height:300px"></iframe>
<script>document.querySelector(".standartTreeRow").onclick=()=>{document.getElementById("c").src="/modules/cc_monitor/curcall_in.php";};</script>`;
const TABELA = `<!doctype html><table class="adminlist"><thead><tr><th>ID</th><th>Callee Number</th><th>Callback Number</th><th>Call Status</th><th>Start Time</th><th>Call Duration</th><th>Action</th></tr></thead>
<tbody><tr><td>1</td><td>011900000001</td><td>100001</td><td>Stage 1 Agent</td><td>10:00:00</td><td>00:00:05</td><td></td></tr></tbody></table>`;

let servidor: Server;
let base = "";
const posts: Array<{ usuario: string; senha: string }> = [];

beforeAll(async () => {
  if (!CHROMIUM_DE_TESTE) return;
  servidor = createServer((req, res) => {
    const u = new URL(req.url ?? "/", "http://x");
    if (u.pathname === "/logincheck.php" && req.method === "POST") {
      let corpo = "";
      req.on("data", (c: Buffer) => (corpo += c.toString()));
      req.on("end", () => {
        const p = new URLSearchParams(corpo);
        posts.push({ usuario: p.get("username") ?? "", senha: p.get("password") ?? "" });
        res.writeHead(302, { location: "/modules/index.php" });
        res.end();
      });
      return;
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(
      u.pathname === "/modules/index.php"
        ? INDEX
        : u.pathname.endsWith("curcall_in.php")
          ? TABELA
          : ENTRADA,
    );
  });
  await new Promise<void>((r) => servidor.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
});
afterAll(async () => {
  if (servidor) await new Promise<void>((r) => servidor.close(() => r()));
});

describe.skipIf(!CHROMIUM_DE_TESTE)("AdaptadorLoginDoSite (site fictício)", () => {
  it("espera a pessoa clicar na verificação, preenche uma vez e abre a Voice Call Status", async () => {
    posts.length = 0;
    const h = await navegadorDeTeste();
    try {
      const pagina = h.paginaPrincipal();
      await h.abrirUrl(base + "/");
      const leitor = new LeitorTabelaHtml(pagina, { tolerarSemTabela: 3 });
      const adaptador = new AdaptadorLoginDoSite(pagina, leitor, { timeoutMs: 5000 });
      const notif = criarNotificadorFalso();
      const log = { debug() {}, info() {}, warn() {}, error() {} };
      const g = new GerenciadorLogin(
        adaptador,
        {
          loginAutomatico: true,
          usuario: "usuario-ficticio",
          senha: "senha-ficticia",
          esperaAposEnvioMs: 10_000,
          intervaloVerificacaoMs: 200,
          intervaloAvisoMs: 60_000,
        },
        log,
        notif,
      );
      const resultado = g.garantirLogin(new AbortController().signal);
      await pagina.waitForTimeout(800); // a "pessoa" ainda não clicou: nada pode ser preenchido
      expect(posts).toHaveLength(0);
      await pagina.click("#ok"); // a PESSOA clica na verificação
      expect(await resultado).toBe("logado_automatico");
      expect(posts).toEqual([{ usuario: "usuario-ficticio", senha: "senha-ficticia" }]);
    } finally {
      await h.encerrar();
    }
  });
});
