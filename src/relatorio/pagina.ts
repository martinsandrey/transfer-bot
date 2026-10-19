import type { Ligacao, LigacaoLonga } from "./relatorio.js";

export interface DadosDaPagina {
  geradoEm: Date;
  ligacoes: readonly Ligacao[];
  longas: readonly LigacaoLonga[];
  /** Filtro que a página mostra ao abrir: um dos nomes de período, ou `personalizado` com `de`/`ate` (AAAA-MM-DD). */
  inicial: { periodo: string; de?: string; ate?: string };
}

/** JSON seguro para ficar dentro de um <script> (nunca fecha a tag nem quebra a linha). */
function jsonSeguro(v: unknown): string {
  return JSON.stringify(v)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

/**
 * Página HTML autônoma (sem internet, sem bibliotecas): os filtros de período funcionam dentro da própria página.
 * Os dados (telefones de clientes) ficam só no arquivo local, que fica na pasta de registros (ignorada pelo git).
 */
export function paginaHtml(d: DadosDaPagina): string {
  const dados = {
    gerado: d.geradoEm.getTime(),
    ligacoes: d.ligacoes.map((l) => ({
      t: l.quando.getTime(),
      f: l.funcionario,
      c: l.cliente,
      r: l.resultado === "callback" ? "c" : "a",
      o: l.observacao ? 1 : 0,
      s: l.semTransferencia ? 1 : 0,
      d: l.duracaoSeg,
    })),
    longas: d.longas.map((l) => ({
      t: l.quando.getTime(),
      f: l.funcionario,
      c: l.cliente,
      o: l.observacao ? 1 : 0,
    })),
    inicial: d.inicial,
  };
  return PAGINA.replace("/*DADOS*/null", jsonSeguro(dados));
}

const PAGINA = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Relatório de transferências</title>
<style>
:root{
  --fundo:#f4f6f8; --cartao:#ffffff; --texto:#1b2430; --suave:#5d6b7a; --linha:#e3e8ee;
  --marca:#0f766e; --marca-fraca:#d9f2ee; --ok:#15803d; --ok-fraco:#dcfce7; --alerta:#b45309; --alerta-fraco:#fef3c7;
  --sombra:0 1px 2px rgba(16,24,40,.06),0 1px 3px rgba(16,24,40,.08);
}
@media (prefers-color-scheme: dark){
  :root{ --fundo:#0f1419; --cartao:#171d25; --texto:#e6ebf1; --suave:#9aa7b5; --linha:#2a3340;
    --marca:#2dd4bf; --marca-fraca:#12312f; --ok:#4ade80; --ok-fraco:#133021; --alerta:#fbbf24; --alerta-fraco:#3a2c0b; --sombra:none; }
}
*{box-sizing:border-box}
body{margin:0;background:var(--fundo);color:var(--texto);font:15px/1.5 "Segoe UI",system-ui,-apple-system,Roboto,sans-serif}
main{max-width:1100px;margin:0 auto;padding:28px 16px 56px}
h1{font-size:26px;margin:0 0 4px;letter-spacing:-.01em}
.sub{color:var(--suave);margin:0 0 22px}
.painel{background:var(--cartao);border:1px solid var(--linha);border-radius:14px;box-shadow:var(--sombra);padding:16px 18px;margin-bottom:18px}
.filtros{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.filtros button,.acao{font:inherit;border:1px solid var(--linha);background:var(--cartao);color:var(--texto);padding:7px 14px;border-radius:999px;cursor:pointer}
.filtros button:hover,.acao:hover{border-color:var(--marca)}
.filtros button[aria-pressed="true"]{background:var(--marca);border-color:var(--marca);color:#fff;font-weight:600}
@media (prefers-color-scheme: dark){.filtros button[aria-pressed="true"]{color:#06201d}}
.datas{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-top:12px;color:var(--suave)}
.datas[hidden]{display:none}
.datas input{font:inherit;padding:6px 10px;border-radius:8px;border:1px solid var(--linha);background:var(--cartao);color:var(--texto)}
.opc{margin-top:12px;color:var(--suave);display:flex;gap:8px;align-items:center}
.periodo{font-size:18px;font-weight:600;margin:0 0 14px}
.cartoes{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;margin-bottom:18px}
.cartao{background:var(--cartao);border:1px solid var(--linha);border-radius:14px;box-shadow:var(--sombra);padding:14px 16px}
.cartao .rot{color:var(--suave);font-size:13px}
.cartao .num{font-size:32px;font-weight:700;letter-spacing:-.02em;font-variant-numeric:tabular-nums}
.cartao .nota{color:var(--suave);font-size:12px}
.cartao.ok .num{color:var(--ok)} .cartao.alerta .num{color:var(--alerta)}
h2{font-size:17px;margin:0 0 12px}
.rolagem{overflow-x:auto}
table{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums}
th,td{padding:10px 12px;border-bottom:1px solid var(--linha);text-align:right;white-space:nowrap}
th.esq,td.esq{text-align:left}
th{font-size:13px;color:var(--suave);font-weight:600;background:transparent;vertical-align:bottom;white-space:normal;line-height:1.25}
th button{font:inherit;color:inherit;background:none;border:0;padding:0;cursor:pointer;text-align:inherit}
th button:hover{color:var(--texto)}
th button:focus-visible{outline:2px solid var(--marca);outline-offset:3px;border-radius:4px}
th button::after{content:"\\2195";margin-left:6px;opacity:.35;font-size:12px}
th[aria-sort="ascending"] button,th[aria-sort="descending"] button{color:var(--texto)}
th[aria-sort="ascending"] button::after{content:"\\25B2";opacity:1;color:var(--marca)}
th[aria-sort="descending"] button::after{content:"\\25BC";opacity:1;color:var(--marca)}
tbody tr:hover{background:var(--fundo)}
tfoot td{font-weight:700;border-bottom:0;border-top:2px solid var(--linha)}
.selo{display:inline-block;padding:2px 10px;border-radius:999px;font-size:12px;font-weight:600}
.selo.ok{background:var(--ok-fraco);color:var(--ok)} .selo.alerta{background:var(--alerta-fraco);color:var(--alerta)}
.barra{display:inline-block;width:70px;height:7px;border-radius:99px;background:var(--linha);vertical-align:middle;margin-left:8px;overflow:hidden}
.barra i{display:block;height:100%;background:var(--alerta)}
.vazio{color:var(--suave);text-align:center;padding:26px 0}
.acoes{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px}
.explica{color:var(--suave);font-size:13px;margin-top:6px}
.explica li{margin:2px 0}
footer{color:var(--suave);font-size:12px;margin-top:22px}
@media print{ .filtros,.datas,.opc,.acoes{display:none} body{background:#fff} }
</style>
</head>
<body>
<main>
  <h1>Relatório de transferências</h1>
  <p class="sub" id="gerado"></p>

  <section class="painel" aria-label="Filtros">
    <div class="filtros" id="filtros">
      <button data-p="hoje">Hoje</button>
      <button data-p="ontem">Ontem</button>
      <button data-p="semana">Esta semana</button>
      <button data-p="7dias">Últimos 7 dias</button>
      <button data-p="mes">Este mês</button>
      <button data-p="tudo">Tudo</button>
      <button data-p="personalizado">Escolher datas</button>
    </div>
    <div class="datas" id="datas" hidden>
      <label>De <input type="date" id="de"></label>
      <label>até <input type="date" id="ate"></label>
    </div>
    <label class="opc"><input type="checkbox" id="obs"> Incluir também as prévias do modo observação (nada foi enviado)</label>
  </section>

  <p class="periodo" id="periodo"></p>
  <section class="cartoes" id="cartoes"></section>

  <section class="painel">
    <h2>Por funcionário</h2>
    <div class="rolagem"><table id="tabela">
      <thead><tr>
        <th class="esq" data-k="f" data-tipo="txt"><button type="button">Funcionário (Callback Number)</button></th>
        <th data-k="total"><button type="button">Transferências com callback</button></th>
        <th data-k="sem"><button type="button">Transferências sem callback</button></th>
        <th data-k="cb"><button type="button">Callbacks</button></th>
        <th data-k="pc"><button type="button">% de callback</button></th>
        <th data-k="med"><button type="button">Duração média (sem callback)</button></th>
        <th data-k="lg"><button type="button">Ligações de 5 min</button></th>
      </tr></thead>
      <tbody></tbody><tfoot></tfoot>
    </table></div>
    <ul class="explica">
      <li><b>Transferências com callback</b>: todas as ligações transferidas (inclui as que ninguém atendeu).</li>
      <li><b>Transferências sem callback</b>: as que foram atendidas no Stage 3.</li>
      <li><b>Duração média</b>: média do tempo das transferências atendidas e sem callback (só entram as que têm a duração registrada).</li>
      <li><b>Callbacks</b>: as que ninguém atendeu ou que foram atendidas mas duraram muito pouco.</li>
    </ul>
    <div class="acoes">
      <button class="acao" id="csv">Baixar planilha (CSV)</button>
      <button class="acao" onclick="window.print()">Imprimir</button>
    </div>
  </section>

  <section class="painel">
    <h2>Ligações do período</h2>
    <div class="rolagem"><table id="detalhe">
      <thead><tr>
        <th class="esq" data-k="t"><button type="button">Data e hora</button></th>
        <th class="esq" data-k="f" data-tipo="txt"><button type="button">Funcionário</button></th>
        <th class="esq" data-k="c" data-tipo="txt"><button type="button">Cliente</button></th>
        <th class="esq" data-k="r" data-tipo="txt"><button type="button">Resultado</button></th>
        <th data-k="d"><button type="button">Duração</button></th>
      </tr></thead>
      <tbody></tbody>
    </table></div>
  </section>

  <footer>Gerado a partir dos registros em texto do programa. Os horários são os do computador onde o programa roda.</footer>
</main>
<script>
"use strict";
const D = /*DADOS*/null;
const $ = (id) => document.getElementById(id);
const estado = { p: "hoje", de: "", ate: "", obs: false };

const dia = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const somar = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const dd = (d) => String(d.getDate()).padStart(2, "0") + "/" + String(d.getMonth() + 1).padStart(2, "0") + "/" + d.getFullYear();
const aaaammdd = (s) => { const m = /^(\\d{4})-(\\d\\d)-(\\d\\d)$/.exec(s); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; };

function intervalo() {
  const hoje = dia(new Date());
  switch (estado.p) {
    case "hoje": return { de: hoje, ate: somar(hoje, 1), rot: "Hoje (" + dd(hoje) + ")" };
    case "ontem": { const o = somar(hoje, -1); return { de: o, ate: hoje, rot: "Ontem (" + dd(o) + ")" }; }
    case "semana": { const seg = somar(hoje, -((hoje.getDay() + 6) % 7)); return { de: seg, ate: somar(hoje, 1), rot: "Esta semana (desde " + dd(seg) + ")" }; }
    case "7dias": { const i = somar(hoje, -6); return { de: i, ate: somar(hoje, 1), rot: "Últimos 7 dias (desde " + dd(i) + ")" }; }
    case "mes": { const i = new Date(hoje.getFullYear(), hoje.getMonth(), 1); return { de: i, ate: somar(hoje, 1), rot: "Este mês (desde " + dd(i) + ")" }; }
    case "tudo": return { de: null, ate: null, rot: "Todo o período registrado" };
    default: {
      const a = aaaammdd(estado.de), b = aaaammdd(estado.ate || estado.de);
      if (!a || !b || b < a) return { de: new Date(8.64e15), ate: new Date(8.64e15), rot: "Escolha as datas inicial e final", invalido: true };
      return { de: a, ate: somar(b, 1), rot: a.getTime() === b.getTime() ? dd(a) : dd(a) + " a " + dd(b) };
    }
  }
}
const dentro = (t, o, iv) => (estado.obs || !o) && !(iv.de && t < iv.de.getTime()) && !(iv.ate && t >= iv.ate.getTime());

function resumo(iv) {
  const por = new Map();
  const lin = (f) => { if (!por.has(f)) por.set(f, { f, total: 0, sem: 0, cb: 0, lg: 0, ds: 0, nd: 0 }); return por.get(f); };
  const lista = [];
  for (const c of D.ligacoes) {
    if (!dentro(c.t, c.o, iv)) continue;
    const l = lin(c.f); l.total++; if (c.r === "c") l.cb++; else { l.sem++; if (c.d !== null && c.d !== undefined) { l.ds += c.d; l.nd++; } }
    lista.push(c);
  }
  for (const c of D.longas) if (dentro(c.t, c.o, iv)) lin(c.f).lg++;
  const linhas = [...por.values()].sort((a, b) => b.total - a.total || a.f.localeCompare(b.f));
  return { linhas, lista: lista.sort((a, b) => b.t - a.t) };
}

const durTxt = (seg) => { if (seg === null || seg === undefined || isNaN(seg)) return "—"; const s = Math.round(seg); return s < 60 ? s + " s" : Math.floor(s / 60) + " min " + String(s % 60).padStart(2, "0") + " s"; };
const media = (l) => (l.nd ? l.ds / l.nd : null);
const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : 0);
const pctTxt = (a, b) => (b ? String(pct(a, b)).replace(".", ",") + "%" : "—");
const el = (tag, txt, cls) => { const e = document.createElement(tag); if (txt !== undefined) e.textContent = txt; if (cls) e.className = cls; return e; };

function cartao(rot, num, nota, cls) {
  const c = el("div", undefined, "cartao" + (cls ? " " + cls : ""));
  c.append(el("div", rot, "rot"), el("div", String(num), "num"), el("div", nota || "", "nota"));
  return c;
}

const ordem = { tabela: { k: "total", dir: -1 }, detalhe: { k: "t", dir: -1 } };
const txtCmp = (a, b) => String(a).localeCompare(String(b), "pt-BR", { numeric: true, sensitivity: "base" });
const vazio = (x) => x === null || x === undefined || (typeof x === "number" && isNaN(x));
const chavesTabela = { f: (l) => l.f, total: (l) => l.total, sem: (l) => l.sem, cb: (l) => l.cb, pc: (l) => (l.total ? l.cb / l.total : null), med: (l) => media(l), lg: (l) => l.lg };
const chavesDetalhe = { t: (c) => c.t, f: (c) => c.f, c: (c) => c.c || "", r: (c) => (c.r === "c" ? "Callback" : "Atendida"), d: (c) => (c.r === "c" ? null : c.d) };
/** Ordena sem mexer no original; valores vazios ficam sempre no fim, qualquer que seja o sentido. */
function ordenar(arr, chaves, o, desempate) {
  const get = chaves[o.k];
  return [...arr].sort((a, b) => {
    const x = get(a), y = get(b);
    if (vazio(x) || vazio(y)) { if (!(vazio(x) && vazio(y))) return vazio(x) ? 1 : -1; return desempate(a, b); }
    const c = typeof x === "string" ? txtCmp(x, y) : x - y;
    return c !== 0 ? c * o.dir : desempate(a, b);
  });
}
function marcarOrdem(idTabela, o) {
  for (const th of $(idTabela).tHead.rows[0].cells) th.setAttribute("aria-sort", th.dataset.k === o.k ? (o.dir === 1 ? "ascending" : "descending") : "none");
}
for (const id of ["tabela", "detalhe"]) {
  $(id).tHead.addEventListener("click", (e) => {
    const th = e.target && e.target.closest ? e.target.closest("th[data-k]") : null; if (!th) return;
    const o = ordem[id];
    if (o.k === th.dataset.k) o.dir = -o.dir; else { o.k = th.dataset.k; o.dir = th.dataset.tipo === "txt" ? 1 : -1; }
    desenhar();
  });
}

function desenhar() {
  const iv = intervalo();
  $("periodo").textContent = iv.rot;
  const bruto = iv.invalido ? { linhas: [], lista: [] } : resumo(iv);
  const linhas = ordenar(bruto.linhas, chavesTabela, ordem.tabela, (a, b) => txtCmp(a.f, b.f));
  const lista = ordenar(bruto.lista, chavesDetalhe, ordem.detalhe, (a, b) => b.t - a.t);
  marcarOrdem("tabela", ordem.tabela); marcarOrdem("detalhe", ordem.detalhe);
  const T = linhas.reduce((t, l) => ({ total: t.total + l.total, sem: t.sem + l.sem, cb: t.cb + l.cb, lg: t.lg + l.lg, ds: t.ds + l.ds, nd: t.nd + l.nd }), { total: 0, sem: 0, cb: 0, lg: 0, ds: 0, nd: 0 });

  const cs = $("cartoes"); cs.replaceChildren(
    cartao("Transferências", T.total, "com e sem callback"),
    cartao("Sem callback", T.sem, "atendidas e longas o bastante", "ok"),
    cartao("Callbacks", T.cb, "sem atendimento ou muito curtas", "alerta"),
    cartao("Taxa de callback", pctTxt(T.cb, T.total), "callbacks ÷ transferências"),
    cartao("Duração média", durTxt(media(T)), T.nd ? "de " + T.nd + " transferência" + (T.nd > 1 ? "s" : "") + " sem callback" : "sem duração registrada"),
    cartao("Ligações de 5 min", T.lg, "ainda no Stage 1"),
  );

  const tb = $("tabela").tBodies[0]; tb.replaceChildren();
  if (!linhas.length) { const tr = el("tr"); const td = el("td", "Nenhuma mensagem registrada neste período.", "vazio"); td.colSpan = 7; tr.append(td); tb.append(tr); }
  for (const l of linhas) {
    const tr = el("tr");
    const pc = el("td", pctTxt(l.cb, l.total)); const b = el("span", undefined, "barra"); const i = el("i"); i.style.width = pct(l.cb, l.total) + "%"; b.append(i); pc.append(b);
    tr.append(el("td", l.f, "esq"), el("td", String(l.total)), el("td", String(l.sem)), el("td", String(l.cb)), pc, el("td", durTxt(media(l))), el("td", String(l.lg)));
    tb.append(tr);
  }
  const tf = $("tabela").tFoot; tf.replaceChildren();
  const trT = el("tr"); trT.append(el("td", "TOTAL", "esq"), el("td", String(T.total)), el("td", String(T.sem)), el("td", String(T.cb)), el("td", pctTxt(T.cb, T.total)), el("td", durTxt(media(T))), el("td", String(T.lg)));
  tf.append(trT);

  const db = $("detalhe").tBodies[0]; db.replaceChildren();
  if (!lista.length) { const tr = el("tr"); const td = el("td", "Nenhuma ligação transferida neste período.", "vazio"); td.colSpan = 5; tr.append(td); db.append(tr); }
  for (const c of lista) {
    const tr = el("tr");
    const quando = new Date(c.t);
    const sel = el("span", c.r === "c" ? "Callback" : "Atendida", "selo " + (c.r === "c" ? "alerta" : "ok"));
    const r = el("td", undefined, "esq"); r.append(sel);
    if (c.o) r.append(" ", el("span", "(prévia)", "explica"));
    if (c.s) r.append(" ", el("span", "(sem a mensagem de transferência no registro)", "explica"));
    tr.append(el("td", quando.toLocaleString("pt-BR"), "esq"), el("td", c.f, "esq"), el("td", c.c || "—", "esq"), r, el("td", c.r === "c" ? "—" : durTxt(c.d)));
    db.append(tr);
  }
  window.__relatorio = { linhas, total: T, periodo: iv.rot };
}

function sincronizar() {
  for (const b of $("filtros").children) b.setAttribute("aria-pressed", String(b.dataset.p === estado.p));
  $("datas").hidden = estado.p !== "personalizado";
  $("de").value = estado.de; $("ate").value = estado.ate; $("obs").checked = estado.obs;
  desenhar();
}

$("filtros").addEventListener("click", (e) => {
  const p = e.target && e.target.dataset && e.target.dataset.p; if (!p) return;
  estado.p = p; if (p === "personalizado" && !estado.de) { const h = new Date(); estado.de = estado.ate = h.getFullYear() + "-" + String(h.getMonth() + 1).padStart(2, "0") + "-" + String(h.getDate()).padStart(2, "0"); }
  sincronizar();
});
$("de").addEventListener("input", () => { estado.de = $("de").value; if (!estado.ate || estado.ate < estado.de) estado.ate = estado.de; sincronizar(); });
$("ate").addEventListener("input", () => { estado.ate = $("ate").value; sincronizar(); });
$("obs").addEventListener("change", () => { estado.obs = $("obs").checked; desenhar(); });
$("csv").addEventListener("click", () => {
  const { linhas, total } = window.__relatorio;
  const cab = ["Funcionário (Callback Number)", "Transferências com callback", "Transferências sem callback", "Callbacks", "% de callback", "Duração média (min)", "Ligações de 5 min"];
  const l = (x, nome) => [nome || x.f, x.total, x.sem, x.cb, pctTxt(x.cb, x.total), media(x) === null ? "" : (Math.round((media(x) / 60) * 100) / 100).toString().replace(".", ","), x.lg];
  const linhasCsv = [cab, ...linhas.map((x) => l(x)), l(total, "TOTAL")];
  const esc = (v) => { v = String(v); return /[;"\\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  const blob = new Blob(["\\uFEFF" + linhasCsv.map((r) => r.map(esc).join(";")).join("\\r\\n") + "\\r\\n"], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "relatorio-transferencias.csv"; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
});

$("gerado").textContent = "Gerado em " + new Date(D.gerado).toLocaleString("pt-BR");
estado.p = D.inicial.periodo || "hoje"; estado.de = D.inicial.de || ""; estado.ate = D.inicial.ate || "";
sincronizar();
</script>
</body>
</html>
`;
