import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * Site FICTÍCIO usado só para testar as ferramentas. A estrutura (tabela com os cabeçalhos informados pelo usuário,
 * atualização periódica, linhas trocando de posição) é uma suposição de teste, NÃO evidência do site real.
 * Todos os números/nomes são inventados.
 */

export interface LinhaSimulada {
  cb: string;
  ce: string;
  status: string;
  inicio: string;
  duracao: string;
  idOculto?: string;
}

const T = (n: number): string => `2000-01-01 10:00:${String(n).padStart(2, "0")}`;

/** Linha do tempo determinística (em "ticks"). */
export function linhasNoTick(tick: number): LinhaSimulada[] {
  const l: LinhaSimulada[] = [];
  // Funcionário A: Stage 1 Agent até o tick 2. COMPORTAMENTO REAL (evidência do usuário, 2026-10-16): na transferência a linha
  // do Stage 1 SOME e aparece OUTRA linha em Stage 3 Agent, com outro Callback Number e o MESMO Callee, até o tick 5.
  // Depois some e, no tick 8, o mesmo funcionário faz outra ligação (outro Start Time e outro Callee).
  if (tick < 3) {
    l.push({
      cb: "5511900000001",
      ce: "5521900000101",
      status: "Stage 1 Agent",
      inicio: T(1),
      duracao: `00:00:${String(tick).padStart(2, "0")}`,
      idOculto: "88776655",
    });
  } else if (tick < 6) {
    l.push({
      cb: "5511900000301",
      ce: "5521900000101",
      status: "Stage 3 Agent",
      inicio: T(1),
      duracao: `00:00:${String(tick).padStart(2, "0")}`,
      idOculto: "88776657",
    });
  } else if (tick >= 8) {
    l.push({
      cb: "5511900000001",
      ce: "5521900000102",
      status: "Stage 1 Agent",
      inicio: T(9),
      duracao: "00:00:00",
      idOculto: "88776656",
    });
  }
  // Funcionário B: Stage 1 → Stage 2 no tick 2
  if (tick < 10)
    l.push({
      cb: "5511900000002",
      ce: "5521900000103",
      status: tick < 2 ? "Stage 1 Agent" : "Stage 2 Agent",
      inicio: T(2),
      duracao: `00:00:${String(tick).padStart(2, "0")}`,
      idOculto: "11223344",
    });
  // Funcionário C: constante
  l.push({
    cb: "5511900000003",
    ce: "5521900000104",
    status: "Stage 1 Agent",
    inicio: T(3),
    duracao: `00:00:${String(tick).padStart(2, "0")}`,
    idOculto: "55667788",
  });
  // embaralha de forma determinística
  return l.sort(
    (a, b) => ((Number(a.cb.slice(-2)) * 7 + tick) % 5) - ((Number(b.cb.slice(-2)) * 7 + tick) % 5),
  );
}

const PAGINA_LOGIN = `<!doctype html><html><head><title>Entrar</title></head><body>
<h1>Acesso</h1>
<form action="/login" method="post">
  <label for="u">Usuário</label><input id="u" name="username" type="text" autocomplete="username">
  <label for="p">Senha</label><input id="p" name="password" type="password" autocomplete="current-password">
  <button type="submit">Entrar</button>
</form></body></html>`;

function paginaChamadas(periodoMs: number): string {
  return `<!doctype html><html><head><title>Chamadas</title></head><body>
<nav><ul><li><a href="/chamadas">Call List</a></li><li><span>Customer Data List</span></li></ul></nav>
<table id="tabela-chamadas"><thead><tr>
<th>Callback Number</th><th>Callee Number</th><th>Call Status</th><th>Start Time</th><th>Call Duration</th></tr></thead>
<tbody id="corpo"></tbody></table>
<script>
async function atualizar() {
  const r = await fetch('/api/chamadas'); const dados = await r.json();
  const corpo = document.getElementById('corpo');
  corpo.innerHTML = '';
  for (const d of dados.linhas) {
    const tr = document.createElement('tr'); tr.setAttribute('data-call-id', d.idOculto);
    tr.innerHTML = '<td>' + d.cb + '</td><td>' + d.ce + '</td><td>' + d.status + '</td><td>' + d.inicio + '<span style="display:none">' + d.idOculto + '</span></td><td>' + d.duracao + '</td>';
    corpo.appendChild(tr);
  }
}
atualizar(); setInterval(atualizar, ${periodoMs});
</script></body></html>`;
}

const SCRIPT_LINHAS = `
async function dados() { const r = await fetch('/api/chamadas'); return (await r.json()).linhas; }
const CAB = ['Callback Number','Callee Number','Call Status','Start Time','Call Duration'];
const celulas = (d) => [d.cb, d.ce, d.status, d.inicio, d.duracao];
`;

/** Variante: mesma tabela, mas dentro de um iframe. */
const PAGINA_IFRAME = `<!doctype html><title>Painel</title><h1>Painel</h1><iframe src="/chamadas" style="width:100%;height:400px"></iframe>`;

/** Variante: grade feita só de div (sem <table>), com cabeçalho e linhas irmãos. */
function paginaDiv(periodoMs: number): string {
  return `<!doctype html><title>Grade</title><div id="grade"></div><script>${SCRIPT_LINHAS}
async function atualizar() {
  const g = document.getElementById('grade'); const ls = await dados();
  g.innerHTML = '<div class="linha cab">' + CAB.map(c => '<div class="cel">' + c + '</div>').join('') + '</div>' +
    ls.map(d => '<div class="linha">' + celulas(d).map(c => '<div class="cel">' + c + '</div>').join('') + '</div>').join('');
}
atualizar(); setInterval(atualizar, ${periodoMs});</script>`;
}

/** Variante: tabela dentro de um Shadow DOM aberto. */
function paginaShadow(periodoMs: number): string {
  return `<!doctype html><title>Shadow</title><div id="host"></div><script>${SCRIPT_LINHAS}
const raiz = document.getElementById('host').attachShadow({ mode: 'open' });
async function atualizar() {
  const ls = await dados();
  raiz.innerHTML = '<table><thead><tr>' + CAB.map(c => '<th>' + c + '</th>').join('') + '</tr></thead><tbody>' +
    ls.map(d => '<tr>' + celulas(d).map(c => '<td>' + c + '</td>').join('') + '</tr>').join('') + '</tbody></table>';
}
atualizar(); setInterval(atualizar, ${periodoMs});</script>`;
}

/**
 * Variante que imita a estrutura CONFIRMADA pelo recon (2026-10-16): colunas ID | Callee Number | Callback Number |
 * Call Status | Start Time | Call Duration | Action, com um 8º cabeçalho de resumo e linhas de 7 células; telefones no formato
 * observado (Callee com 12 dígitos e zero à esquerda, Callback com 6 dígitos) e horário sem data. Dados fictícios.
 */
function paginaEvidencia(periodoMs: number): string {
  return `<!doctype html><title>Evidencia</title><table id="t"><thead><tr><th>ID</th><th>Callee Number</th><th>Callback Number</th><th>Call Status</th><th>Start Time</th><th>Call Duration</th><th>Action</th><th>Manual Call： 0 Stage 1：2 Stage 2：0 Stage 3：0 Stage 4：0</th></tr></thead><tbody id="corpo"></tbody></table><script>
async function atualizar() {
  const r = await fetch('/api/chamadas'); const ls = (await r.json()).linhas;
  document.getElementById('corpo').innerHTML = ls.map((d, i) => '<tr><td>' + (i + 1) + '</td><td>0' + d.ce.slice(2) + '</td><td>9' + d.cb.slice(-5) + '</td><td>' + d.status + '</td><td>' + d.inicio.slice(11) + '</td><td>' + d.duracao + '</td><td><img alt="" width="1" height="1"></td></tr>').join('');
}
atualizar(); setInterval(atualizar, ${periodoMs});</script>`;
}

export interface SiteSimulado {
  url: string;
  fechar(): Promise<void>;
}

export async function iniciarSiteSimulado(passoMs = 300): Promise<SiteSimulado> {
  let t0 = Date.now(); // a linha do tempo recomeça a cada carga da página de chamadas
  const servidor: Server = createServer((req, res) => {
    const caminho = (req.url ?? "/").split("?")[0];
    if (caminho === "/api/chamadas") {
      const tick = Math.floor((Date.now() - t0) / passoMs);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ tick, linhas: linhasNoTick(tick) }));
    } else if (caminho === "/painel-iframe") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(PAGINA_IFRAME);
    } else if (caminho === "/layout-evidencia") {
      t0 = Date.now();
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(paginaEvidencia(Math.round(passoMs / 2)));
    } else if (caminho === "/grade-div" || caminho === "/shadow") {
      t0 = Date.now();
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(
        caminho === "/grade-div"
          ? paginaDiv(Math.round(passoMs / 2))
          : paginaShadow(Math.round(passoMs / 2)),
      );
    } else if (caminho === "/chamadas") {
      t0 = Date.now();
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(paginaChamadas(Math.round(passoMs / 2)));
    } else {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(PAGINA_LOGIN);
    }
  });
  await new Promise<void>((r) => servidor.listen(0, "127.0.0.1", r));
  const porta = (servidor.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${porta}`,
    fechar: () => new Promise((r) => servidor.close(() => r())),
  };
}
