import { ESTILO, montarXlsx } from "./xlsx.js";
import type { Ligacao, LigacaoLonga } from "./relatorio.js";

export interface DadosDaPagina {
  geradoEm: Date;
  ligacoes: readonly Ligacao[];
  longas: readonly LigacaoLonga[];
  /** Filtro que a página mostra ao abrir: um dos nomes de período, ou `personalizado` com `de`/`ate` (AAAA-MM-DD). */
  inicial: { periodo: string; de?: string; ate?: string };
  /** Apelidos (número só com dígitos → nome). O apelido sempre aparece junto do número. */
  apelidos?: ReadonlyMap<string, string>;
  /** Penúltimos dígitos da equipe do paquistanês (a caixa "Mostrar equipe do paquistanês" usa isto). */
  equipePaquistanesDigitos?: readonly string[];
  /** Página servida pelo `relatorio.bat` (servidor local): habilita "Marcar como callback". Sem isto, a página só mostra. */
  servidor?: { token: string };
}

/** JSON seguro para ficar dentro de um <script> (nunca fecha a tag nem quebra a linha). */
function jsonSeguro(v: unknown): string {
  return JSON.stringify(v)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

/** Ligações no formato compacto da página (também devolvido pelo servidor depois de uma marcação, para a página se recalcular). */
export function dadosDasLigacoes(ligacoes: readonly Ligacao[]): unknown[] {
  return ligacoes.map((l) => ({
    t: l.quando.getTime(),
    f: l.funcionario,
    c: l.cliente,
    r: l.resultado === "callback" ? "c" : "a",
    o: l.observacao ? 1 : 0,
    s: l.semTransferencia ? 1 : 0,
    d: l.duracaoSeg,
    u: l.duracaoAteTransfSeg,
    k: l.chave ?? null,
    m: l.manual ? 1 : 0,
    // callback removido pela religação: não conta; `rm` = quando e quem fez a nova transferência atendida
    rm: l.callbackRemovido
      ? { t: l.callbackRemovido.quando.getTime(), f: l.callbackRemovido.funcionario }
      : null,
    sb: l.substituiu ?? 0,
  }));
}

export function dadosDasLongas(longas: DadosDaPagina["longas"]): unknown[] {
  return longas.map((l) => ({
    t: l.quando.getTime(),
    f: l.funcionario,
    c: l.cliente,
    o: l.observacao ? 1 : 0,
    x: l.transferida === null ? null : l.transferida ? 1 : 0,
  }));
}

/**
 * Página HTML autônoma (sem internet, sem bibliotecas): filtros de período, equipe e ordenação funcionam dentro da própria página.
 * Os dados (telefones de clientes) ficam só no arquivo local, que fica na pasta de registros (ignorada pelo git).
 */
export function paginaHtml(d: DadosDaPagina): string {
  const dados = {
    gerado: d.geradoEm.getTime(),
    ligacoes: dadosDasLigacoes(d.ligacoes),
    longas: dadosDasLongas(d.longas),
    ap: Object.fromEntries(d.apelidos ?? []),
    pk: [...(d.equipePaquistanesDigitos ?? ["0"])],
    inicial: d.inicial,
    srv: d.servidor ? { token: d.servidor.token } : null,
  };
  return PAGINA.replace("/*DADOS*/null", () => jsonSeguro(dados))
    .replace("/*XLSX*/null", () => `(${montarXlsx.toString()})`)
    .replace("/*ESTILOS*/null", () => JSON.stringify(ESTILO));
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
.selo.neutro{background:var(--linha);color:var(--suave);text-decoration:line-through}
tr.removida td{color:var(--suave)}
.barra{display:inline-block;width:70px;height:7px;border-radius:99px;background:var(--linha);vertical-align:middle;margin-left:8px;overflow:hidden}
.barra i{display:block;height:100%;background:var(--alerta)}
.vazio{color:var(--suave);text-align:center;padding:26px 0}
.acoes{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px}
.explica{color:var(--suave);font-size:13px;margin-top:6px}
.explica li{margin:2px 0}
footer{color:var(--suave);font-size:12px;margin-top:22px}
.chk{display:flex;gap:8px;align-items:center;margin-top:12px;color:var(--texto)}
.chk.suave{color:var(--suave)}
h3{font-size:15px;margin:18px 0 8px}
.dif{color:var(--suave)}
.equipe{display:inline-block;padding:1px 8px;border-radius:999px;font-size:12px;border:1px solid var(--linha);color:var(--suave)}
.horas{display:grid;grid-template-columns:48px 1fr 1fr;gap:4px 12px;align-items:center;font-variant-numeric:tabular-nums;font-size:13px}
.horas .cab{color:var(--suave);font-weight:600}
.horas .h{color:var(--suave)}
.horas .meio{border-top:2px dashed var(--marca);padding-top:6px}
.bar{display:flex;align-items:center;gap:8px;min-height:18px}
.bar i{display:block;height:12px;border-radius:4px;min-width:2px}
.bar.a i{background:var(--alerta)} .bar.b i{background:var(--ok)}
.leg{display:flex;gap:16px;color:var(--suave);font-size:12px;margin:0 0 8px}
.mini{font:inherit;font-size:13px;border:1px solid var(--linha);background:var(--cartao);color:var(--texto);padding:4px 10px;border-radius:999px;cursor:pointer}
.mini:hover{border-color:var(--alerta);color:var(--alerta)}
.mini:focus-visible{outline:2px solid var(--marca);outline-offset:2px}
.sem-acao th:last-child,.sem-acao td:last-child{display:none}
dialog{border:1px solid var(--linha);border-radius:14px;background:var(--cartao);color:var(--texto);box-shadow:0 10px 30px rgba(0,0,0,.25);padding:20px 22px;max-width:440px;width:calc(100% - 32px)}
dialog::backdrop{background:rgba(15,20,25,.45)}
dialog h2{margin:0 0 10px}
dialog dl{display:grid;grid-template-columns:auto 1fr;gap:4px 12px;margin:12px 0}
dialog dt{color:var(--suave)} dialog dd{margin:0;font-weight:600}
dialog .botoes{display:flex;gap:8px;justify-content:flex-end;margin-top:16px}
dialog .confirmar{background:var(--alerta);border-color:var(--alerta);color:#fff;font-weight:600}
@media (prefers-color-scheme: dark){dialog .confirmar{color:#1b1400}}
.erro{color:var(--alerta);font-weight:600;min-height:1em;margin:8px 0 0}
@media print{ .filtros,.datas,.opc,.acoes,.sem-print{display:none} body{background:#fff} #detalhe th:last-child,#detalhe td:last-child{display:none} }
</style>
</head>
<body>
<main>
  <h1>Relatório de transferências</h1>
  <p class="sub" id="gerado"></p>
  <p class="sub sem-print" id="vivo" hidden><span id="vivo-txt"></span> <button type="button" class="mini" id="vivo-btn">Pausar atualização</button></p>

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
    <label class="chk"><input type="checkbox" id="pk" checked> Mostrar equipe do paquistanês</label>
    <label class="chk suave"><input type="checkbox" id="obs"> Incluir também as prévias do modo observação (nada foi enviado)</label>
  </section>

  <p class="periodo" id="periodo"></p>
  <section class="cartoes" id="cartoes"></section>

  <section class="painel">
    <h2>Transferências por funcionário</h2>
    <div class="rolagem"><table id="tabela">
      <thead><tr>
        <th class="esq" data-k="f" data-tipo="txt"><button type="button">Funcionário</button></th>
        <th class="esq" data-k="eq" data-tipo="txt"><button type="button">Equipe</button></th>
        <th data-k="tr"><button type="button">Transferências com callback</button></th>
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
      <li><b>Transferências sem callback</b>: as que foram atendidas por quem recebeu a transferência (linha 2; até 21/10/2026, o Stage 3).</li>
      <li><b>Callbacks</b>: as que ninguém atendeu ou que foram atendidas mas duraram muito pouco. Se o mesmo cliente foi transferido de novo pouco depois (por qualquer funcionário) e dessa vez foi atendido, o callback é removido e as duas contam como uma só transferência, na nova (ver “Callback removido” na lista).</li>
      <li><b>Duração média</b>: média de quanto a ligação já durava quando foi transferida para a linha 2 (até 21/10/2026, o Stage 3) — o tempo antes da transferência, não o da conversa depois dela, nas transferências sem callback. Só entram as que têm essa duração registrada (as de versões anteriores do programa ficam de fora).</li>
    </ul>
    <div class="acoes">
      <button class="acao" id="planilha">Baixar planilha (Excel)</button>
      <button class="acao" onclick="window.print()">Imprimir</button>
    </div>
  </section>

  <section class="painel">
    <h2>Ligações de 5 minutos: viraram transferência?</h2>
    <div class="rolagem"><table id="longas">
      <thead><tr>
        <th class="esq" data-k="f" data-tipo="txt"><button type="button">Funcionário</button></th>
        <th class="esq" data-k="eq" data-tipo="txt"><button type="button">Equipe</button></th>
        <th data-k="lg"><button type="button">Ligações de 5 min</button></th>
        <th data-k="lgTr"><button type="button">Transferidas</button></th>
        <th data-k="pTr"><button type="button">% transferidas</button></th>
        <th data-k="lgNao"><button type="button">Não transferidas</button></th>
        <th data-k="pNao"><button type="button">% não transferidas</button></th>
      </tr></thead>
      <tbody></tbody><tfoot></tfoot>
    </table></div>
    <p class="explica" id="nota-longas"></p>
  </section>

  <section class="painel">
    <h2>Antes e depois do meio-dia (horário de Brasília)</h2>
    <p class="explica">Antes do meio-dia = das 00h00 às 11h59; depois = a partir das 12h00. Se os dois períodos não tiveram o mesmo movimento, compare as taxas (%), não só as quantidades.</p>
    <div class="rolagem"><table id="comparacao">
      <thead><tr><th class="esq">Indicador</th><th>Antes do meio-dia</th><th>Depois do meio-dia</th><th>Diferença (depois − antes)</th></tr></thead>
      <tbody></tbody>
    </table></div>
    <h3>Movimento por hora do dia</h3>
    <div class="leg"><span>&#9632; <span style="color:var(--alerta)">Ligações de 5 min</span></span><span>&#9632; <span style="color:var(--ok)">Transferências</span></span></div>
    <div class="horas" id="horas"></div>
    <h3>Por funcionário</h3>
    <div class="rolagem"><table id="meio">
      <thead><tr>
        <th class="esq" data-k="f" data-tipo="txt"><button type="button">Funcionário</button></th>
        <th class="esq" data-k="eq" data-tipo="txt"><button type="button">Equipe</button></th>
        <th data-k="lgM"><button type="button">5 min antes do meio-dia</button></th>
        <th data-k="trM"><button type="button">Transferências antes</button></th>
        <th data-k="cM"><button type="button">% transferidas antes</button></th>
        <th data-k="lgT"><button type="button">5 min depois do meio-dia</button></th>
        <th data-k="trT"><button type="button">Transferências depois</button></th>
        <th data-k="cT"><button type="button">% transferidas depois</button></th>
      </tr></thead>
      <tbody></tbody>
    </table></div>
  </section>

  <section class="painel">
    <h2>Ligações do período</h2>
    <p class="explica sem-print" id="nota-acao"></p>
    <div class="rolagem"><table id="detalhe">
      <thead><tr>
        <th class="esq" data-k="t"><button type="button">Data e hora</button></th>
        <th class="esq" data-k="f" data-tipo="txt"><button type="button">Funcionário</button></th>
        <th class="esq" data-k="c" data-tipo="txt"><button type="button">Cliente</button></th>
        <th class="esq" data-k="r" data-tipo="txt"><button type="button">Resultado</button></th>
        <th data-k="u"><button type="button">Duração até a transferência</button></th>
        <th class="esq">Corrigir</th>
      </tr></thead>
      <tbody></tbody>
    </table></div>
  </section>

  <dialog id="confirma" aria-labelledby="conf-titulo">
    <h2 id="conf-titulo"></h2>
    <p id="conf-texto" class="explica"></p>
    <dl>
      <dt>Data e hora</dt><dd id="conf-quando"></dd>
      <dt>Funcionário</dt><dd id="conf-func"></dd>
      <dt>Cliente</dt><dd id="conf-cliente"></dd>
    </dl>
    <p class="erro" id="conf-erro" role="alert"></p>
    <div class="botoes">
      <button type="button" class="acao" id="conf-nao">Cancelar</button>
      <button type="button" class="acao confirmar" id="conf-sim"></button>
    </div>
  </dialog>

  <footer>Gerado a partir dos registros em texto do programa. Os horários da lista são os do computador onde o programa roda; a divisão do meio-dia usa o horário de Brasília.</footer>
</main>
<script>
"use strict";
const D = /*DADOS*/null;
const $ = (id) => document.getElementById(id);
const estado = { p: "hoje", de: "", ate: "", obs: false, pk: true };

/* ---- funcionários: apelido sempre junto do número; equipe pelo penúltimo dígito ---- */
const PK = new Set(D.pk);
const dig = (f) => String(f).replace(/\\D+/g, "");
const penult = (f) => { const d = dig(f); return d.length >= 2 ? d.charAt(d.length - 2) : ""; };
const ehPk = (f) => PK.has(penult(f));
const equipeTxt = (f) => (ehPk(f) ? "Paquistanês" : "Própria");
const rotulo = (f) => { if (dig(f) === "") return String(f); const n = D.ap[dig(f)]; return n ? n + " (" + f + ")" : f + " (sem apelido)"; };
/* Brasília = UTC-3 (sem horário de verão desde 2019) */
const horaBR = (t) => new Date(t - 3 * 3600000).getUTCHours();

/* ---- datas ---- */
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
/* callback removido pela religação: aparece na lista, mas não conta (a nova transferência atendida conta no lugar dela) */
const conta = (c) => !c.rm;
const dentro = (c, iv) => (estado.obs || !c.o) && (estado.pk || !ehPk(c.f)) && !(iv.de && c.t < iv.de.getTime()) && !(iv.ate && c.t >= iv.ate.getTime());

/* ---- agregação ---- */
function agregar(L, G) {
  const a = { tr: 0, sem: 0, cb: 0, lg: 0, lgAv: 0, lgTr: 0, ds: 0, nd: 0 };
  for (const c of L) { a.tr++; if (c.r === "c") a.cb++; else { a.sem++; if (c.u !== null && c.u !== undefined) { a.ds += c.u; a.nd++; } } }
  for (const g of G) { a.lg++; if (g.x !== null && g.x !== undefined) { a.lgAv++; if (g.x) a.lgTr++; } }
  return a;
}
const media = (a) => (a.nd ? a.ds / a.nd : null);
const razao = (a, b) => (b ? a / b : null);

function porFuncionario(L, G) {
  const mapa = new Map();
  const pega = (f) => { if (!mapa.has(f)) mapa.set(f, { f, L: [], G: [] }); return mapa.get(f); };
  for (const c of L) pega(c.f).L.push(c);
  for (const g of G) pega(g.f).G.push(g);
  return [...mapa.values()].map((x) => ({
    f: x.f, a: agregar(x.L, x.G),
    m: agregar(x.L.filter((c) => horaBR(c.t) < 12), x.G.filter((g) => horaBR(g.t) < 12)),
    t: agregar(x.L.filter((c) => horaBR(c.t) >= 12), x.G.filter((g) => horaBR(g.t) >= 12)),
  }));
}

/* ---- formatação ---- */
const durTxt = (seg) => { if (seg === null || seg === undefined || isNaN(seg)) return "—"; const s = Math.round(seg); return s < 60 ? s + " s" : Math.floor(s / 60) + " min " + String(s % 60).padStart(2, "0") + " s"; };
const pct1 = (r) => String(Math.round(r * 1000) / 10).replace(".", ",") + "%";
const pctTxt = (a, b) => (b ? pct1(a / b) : "—");
const el = (tag, txt, cls) => { const e = document.createElement(tag); if (txt !== undefined) e.textContent = txt; if (cls) e.className = cls; return e; };
const linhaTr = (...tds) => { const tr = el("tr"); tr.append(...tds); return tr; };
const vazioTr = (n, msg) => { const td = el("td", msg, "vazio"); td.colSpan = n; return linhaTr(td); };

function cartao(rot, num, nota, cls) {
  const c = el("div", undefined, "cartao" + (cls ? " " + cls : ""));
  c.append(el("div", rot, "rot"), el("div", String(num), "num"), el("div", nota || "", "nota"));
  return c;
}

/* ---- ordenação por título ---- */
const vazio = (x) => x === null || x === undefined || (typeof x === "number" && isNaN(x));
const txtCmp = (a, b) => String(a).localeCompare(String(b), "pt-BR", { numeric: true, sensitivity: "base" });
const chavesFunc = {
  f: (x) => rotulo(x.f), eq: (x) => equipeTxt(x.f),
  tr: (x) => x.a.tr, sem: (x) => x.a.sem, cb: (x) => x.a.cb, pc: (x) => razao(x.a.cb, x.a.tr), med: (x) => media(x.a), lg: (x) => x.a.lg,
  lgTr: (x) => x.a.lgTr, pTr: (x) => razao(x.a.lgTr, x.a.lgAv), lgNao: (x) => x.a.lgAv - x.a.lgTr, pNao: (x) => razao(x.a.lgAv - x.a.lgTr, x.a.lgAv),
  lgM: (x) => x.m.lg, trM: (x) => x.m.tr, cM: (x) => razao(x.m.lgTr, x.m.lgAv), lgT: (x) => x.t.lg, trT: (x) => x.t.tr, cT: (x) => razao(x.t.lgTr, x.t.lgAv),
};
const chavesDet = { t: (c) => c.t, f: (c) => rotulo(c.f), c: (c) => c.c || "", r: (c) => (c.rm ? "Callback removido" : c.r === "c" ? "Callback" : "Atendida"), u: (c) => (c.r === "c" ? null : c.u) };
const ORD = {
  tabela: { k: "tr", dir: -1, chaves: chavesFunc, desempate: (a, b) => txtCmp(rotulo(a.f), rotulo(b.f)) },
  longas: { k: "lg", dir: -1, chaves: chavesFunc, desempate: (a, b) => txtCmp(rotulo(a.f), rotulo(b.f)) },
  meio: { k: "f", dir: 1, chaves: chavesFunc, desempate: (a, b) => txtCmp(rotulo(a.f), rotulo(b.f)) },
  detalhe: { k: "t", dir: -1, chaves: chavesDet, desempate: (a, b) => b.t - a.t },
};
/** Ordena sem mexer no original; valores vazios ficam sempre no fim, qualquer que seja o sentido. */
function ordenar(id, arr) {
  const o = ORD[id], get = o.chaves[o.k];
  return [...arr].sort((a, b) => {
    const x = get(a), y = get(b);
    if (vazio(x) || vazio(y)) { if (!(vazio(x) && vazio(y))) return vazio(x) ? 1 : -1; return o.desempate(a, b); }
    const c = typeof x === "string" ? txtCmp(x, y) : x - y;
    return c !== 0 ? c * o.dir : o.desempate(a, b);
  });
}
function marcarOrdem(id) {
  for (const th of $(id).tHead.rows[0].cells) if (th.dataset.k) th.setAttribute("aria-sort", th.dataset.k === ORD[id].k ? (ORD[id].dir === 1 ? "ascending" : "descending") : "none");
}
for (const id of Object.keys(ORD)) {
  $(id).tHead.addEventListener("click", (e) => {
    const th = e.target && e.target.closest ? e.target.closest("th[data-k]") : null; if (!th) return;
    const o = ORD[id];
    if (o.k === th.dataset.k) o.dir = -o.dir; else { o.k = th.dataset.k; o.dir = th.dataset.tipo === "txt" ? 1 : -1; }
    desenhar();
  });
}

/* ---- desenho ---- */
const selaEquipe = (f) => el("span", equipeTxt(f), "equipe");
function celEquipe(f) { const td = el("td", undefined, "esq"); td.append(selaEquipe(f)); return td; }

function desenharTransferencias(linhas, T) {
  const tb = $("tabela").tBodies[0]; tb.replaceChildren();
  if (!linhas.length) tb.append(vazioTr(8, "Nenhuma mensagem registrada neste período."));
  for (const x of linhas) {
    const pc = el("td", pctTxt(x.a.cb, x.a.tr)); const b = el("span", undefined, "barra"); const i = el("i"); i.style.width = (x.a.tr ? Math.round((x.a.cb / x.a.tr) * 1000) / 10 : 0) + "%"; b.append(i); pc.append(b);
    tb.append(linhaTr(el("td", rotulo(x.f), "esq"), celEquipe(x.f), el("td", String(x.a.tr)), el("td", String(x.a.sem)), el("td", String(x.a.cb)), pc, el("td", durTxt(media(x.a))), el("td", String(x.a.lg))));
  }
  const tf = $("tabela").tFoot; tf.replaceChildren();
  tf.append(linhaTr(el("td", "TOTAL", "esq"), el("td", "", "esq"), el("td", String(T.tr)), el("td", String(T.sem)), el("td", String(T.cb)), el("td", pctTxt(T.cb, T.tr)), el("td", durTxt(media(T))), el("td", String(T.lg))));
}

function desenharLongas(linhas, T) {
  const tb = $("longas").tBodies[0]; tb.replaceChildren();
  if (!linhas.length) tb.append(vazioTr(7, "Nenhuma ligação de 5 minutos neste período."));
  for (const x of linhas) {
    const nao = x.a.lgAv - x.a.lgTr;
    tb.append(linhaTr(el("td", rotulo(x.f), "esq"), celEquipe(x.f), el("td", String(x.a.lg)), el("td", String(x.a.lgTr)), el("td", pctTxt(x.a.lgTr, x.a.lgAv)), el("td", String(nao)), el("td", pctTxt(nao, x.a.lgAv))));
  }
  const tf = $("longas").tFoot; tf.replaceChildren();
  const naoT = T.lgAv - T.lgTr;
  tf.append(linhaTr(el("td", "TOTAL", "esq"), el("td", "", "esq"), el("td", String(T.lg)), el("td", String(T.lgTr)), el("td", pctTxt(T.lgTr, T.lgAv)), el("td", String(naoT)), el("td", pctTxt(naoT, T.lgAv))));
  const semCod = T.lg - T.lgAv;
  $("nota-longas").textContent = "Uma ligação de 5 min conta como transferida se a mesma ligação foi transferida depois (a transferência pode ter vindo de qualquer equipe)." + (semCod > 0 ? " " + semCod + " ligação(ões) antiga(s), sem o código da ligação no registro, não entram nas porcentagens." : "") + " Quem ainda está na ligação aparece como não transferida até ser transferida.";
}

function sinal(n) { return (n > 0 ? "+" : n < 0 ? "−" : "") + Math.abs(n); }
function desenharMeioDia(L, G, linhas) {
  const M = agregar(L.filter((c) => horaBR(c.t) < 12), G.filter((g) => horaBR(g.t) < 12));
  const Tt = agregar(L.filter((c) => horaBR(c.t) >= 12), G.filter((g) => horaBR(g.t) >= 12));
  const cb = $("comparacao").tBodies[0]; cb.replaceChildren();
  const linha = (nome, a, b, dif, destaque) => cb.append(linhaTr(el("td", nome, "esq"), el("td", a), el("td", b), el("td", dif, "dif")));
  const pp = (x, y) => (x === null || y === null ? "—" : sinal(Math.round((y - x) * 1000) / 10).replace(".", ",") + " p.p.");
  linha("Ligações de 5 min", String(M.lg), String(Tt.lg), sinal(Tt.lg - M.lg));
  linha("Transferências", String(M.tr), String(Tt.tr), sinal(Tt.tr - M.tr));
  linha("Callbacks", String(M.cb), String(Tt.cb), sinal(Tt.cb - M.cb));
  linha("Taxa de callback", pctTxt(M.cb, M.tr), pctTxt(Tt.cb, Tt.tr), pp(razao(M.cb, M.tr), razao(Tt.cb, Tt.tr)));
  linha("Ligações de 5 min que viraram transferência", M.lgAv ? pct1(M.lgTr / M.lgAv) + " (" + M.lgTr + " de " + M.lgAv + ")" : "—", Tt.lgAv ? pct1(Tt.lgTr / Tt.lgAv) + " (" + Tt.lgTr + " de " + Tt.lgAv + ")" : "—", pp(razao(M.lgTr, M.lgAv), razao(Tt.lgTr, Tt.lgAv)));
  const dm = media(M), dt = media(Tt);
  linha("Duração média das transferências sem callback", durTxt(dm), durTxt(dt), dm === null || dt === null ? "—" : (dt - dm > 0 ? "+" : dt - dm < 0 ? "−" : "") + durTxt(Math.abs(dt - dm)));

  // por hora (Brasília)
  const h5 = new Array(24).fill(0), hT = new Array(24).fill(0);
  for (const g of G) h5[horaBR(g.t)]++;
  for (const c of L) hT[horaBR(c.t)]++;
  const horas = []; for (let h = 0; h < 24; h++) if (h5[h] || hT[h]) horas.push(h);
  const box = $("horas"); box.replaceChildren();
  if (!horas.length) { box.append(el("div", "Sem movimento neste período.", "vazio")); }
  else {
    const maximo = Math.max(1, ...h5, ...hT);
    box.append(el("div", "Hora", "cab"), el("div", "Ligações de 5 min", "cab"), el("div", "Transferências", "cab"));
    const de = horas[0], ate = horas[horas.length - 1];
    for (let h = de; h <= ate; h++) {
      const cls = h === 12 ? " meio" : "";
      const barra = (n, tipo) => { const b = el("div", undefined, "bar " + tipo + cls); const i = el("i"); i.style.width = Math.round((n / maximo) * 100) + "%"; b.append(i, el("span", String(n))); return b; };
      box.append(el("div", String(h).padStart(2, "0") + "h", "h" + cls), barra(h5[h], "a"), barra(hT[h], "b"));
    }
  }

  // por funcionário
  const mb = $("meio").tBodies[0]; mb.replaceChildren();
  if (!linhas.length) mb.append(vazioTr(8, "Nenhum movimento neste período."));
  for (const x of ordenar("meio", linhas)) {
    mb.append(linhaTr(el("td", rotulo(x.f), "esq"), celEquipe(x.f), el("td", String(x.m.lg)), el("td", String(x.m.tr)), el("td", pctTxt(x.m.lgTr, x.m.lgAv)), el("td", String(x.t.lg)), el("td", String(x.t.tr)), el("td", pctTxt(x.t.lgTr, x.t.lgAv))));
  }
  return { M, T: Tt };
}

function desenhar() {
  const iv = intervalo();
  $("periodo").textContent = iv.rot;
  const todasL = iv.invalido ? [] : D.ligacoes.filter((c) => dentro(c, iv));
  const L = todasL.filter(conta);
  const G = iv.invalido ? [] : D.longas.filter((c) => dentro(c, iv));
  const todos = porFuncionario(L, G);
  const T = agregar(L, G);
  marcarOrdem("tabela"); marcarOrdem("longas"); marcarOrdem("meio"); marcarOrdem("detalhe");

  $("cartoes").replaceChildren(
    cartao("Transferências", T.tr, "com e sem callback"),
    cartao("Sem callback", T.sem, "atendidas e longas o bastante", "ok"),
    cartao("Callbacks", T.cb, "sem atendimento ou muito curtas", "alerta"),
    cartao("Taxa de callback", pctTxt(T.cb, T.tr), "callbacks ÷ transferências"),
    cartao("Duração média", durTxt(media(T)), T.nd ? "de " + T.nd + " transferência" + (T.nd > 1 ? "s" : "") + " sem callback" : "sem duração registrada"),
    cartao("Ligações de 5 min", T.lg, "ainda no Stage 1"),
    cartao("5 min que viraram transferência", pctTxt(T.lgTr, T.lgAv), T.lgAv ? T.lgTr + " de " + T.lgAv + " ligações de 5 min" : "sem dados"),
  );

  desenharTransferencias(ordenar("tabela", todos), T);
  desenharLongas(ordenar("longas", todos), T);
  const mm = desenharMeioDia(L, G, todos);

  const lista = ordenar("detalhe", todasL);
  const db = $("detalhe").tBodies[0]; db.replaceChildren();
  if (!lista.length) db.append(vazioTr(6, "Nenhuma ligação transferida neste período."));
  for (const c of lista) {
    const sel = c.rm ? el("span", "Callback removido", "selo neutro") : el("span", c.r === "c" ? "Callback" : "Atendida", "selo " + (c.r === "c" ? "alerta" : "ok"));
    const r = el("td", undefined, "esq"); r.append(sel);
    if (c.rm) r.append(" ", el("span", "(o cliente foi transferido de novo em " + new Date(c.rm.t).toLocaleString("pt-BR") + " por " + rotulo(c.rm.f) + " e atendido; conta como uma só transferência, na nova)", "explica"));
    if (c.sb) r.append(" ", el("span", "(substitui " + (c.sb > 1 ? c.sb + " callbacks anteriores" : "1 callback anterior") + " do mesmo cliente)", "explica"));
    if (c.m) r.append(" ", el("span", "(marcado no relatório)", "explica"));
    if (c.o) r.append(" ", el("span", "(prévia)", "explica"));
    if (c.s) r.append(" ", el("span", "(sem a mensagem de transferência no registro)", "explica"));
    const acao = el("td", undefined, "esq");
    if (D.srv && c.k && (c.m || c.r === "a")) {
      const b = el("button", c.m ? "Desfazer" : "Marcar como callback", "mini");
      b.type = "button";
      b.addEventListener("click", () => abrirConfirmacao(c));
      acao.append(b);
    }
    db.append(linhaTr(el("td", new Date(c.t).toLocaleString("pt-BR"), "esq"), el("td", rotulo(c.f), "esq"), el("td", c.c || "—", "esq"), r, el("td", c.r === "c" ? "—" : durTxt(c.u)), acao));
    if (c.rm) db.lastChild.classList.add("removida");
  }
  window.__relatorio = {
    linhas: ordenar("tabela", todos), periodo: iv.rot,
    total: { total: T.tr, sem: T.sem, cb: T.cb, lg: T.lg, ds: T.ds, nd: T.nd },
    conv: { lg: T.lg, transferidas: T.lgTr, avaliadas: T.lgAv },
    manha: { lg: mm.M.lg, tr: mm.M.tr, cb: mm.M.cb, lgTr: mm.M.lgTr, lgAv: mm.M.lgAv },
    tarde: { lg: mm.T.lg, tr: mm.T.tr, cb: mm.T.cb, lgTr: mm.T.lgTr, lgAv: mm.T.lgAv },
  };
}

function sincronizar() {
  for (const b of $("filtros").children) b.setAttribute("aria-pressed", String(b.dataset.p === estado.p));
  $("datas").hidden = estado.p !== "personalizado";
  $("de").value = estado.de; $("ate").value = estado.ate; $("obs").checked = estado.obs; $("pk").checked = estado.pk;
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
$("pk").addEventListener("change", () => { estado.pk = $("pk").checked; desenhar(); });
/* ---- planilha Excel (.xlsx) com o que está na tela (mesmo período e filtros) ---- */
const montarXlsx = /*XLSX*/null;
const E = /*ESTILOS*/null;
const serialExcel = (t) => (t - new Date(t).getTimezoneOffset() * 60000) / 86400000 + 25569;
const diaFr = (seg) => (seg === null || seg === undefined || isNaN(seg) ? null : Math.round(seg) / 86400);
const C = (v, e) => ({ v: v === undefined ? null : v, e });
const cab = (...t) => t.map((x) => C(x, E.cabecalho));
const apelido = (f) => D.ap[dig(f)] || "";
const nomeArquivo = (iv) => {
  const ymd = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  if (!iv.de) return "relatorio-transferencias_tudo.xlsx";
  const ult = somar(iv.ate, -1);
  return "relatorio-transferencias_" + (ult.getTime() === iv.de.getTime() ? ymd(iv.de) : ymd(iv.de) + "_a_" + ymd(ult)) + ".xlsx";
};
function abasDaPlanilha() {
  const iv = intervalo();
  const todasL = iv.invalido ? [] : D.ligacoes.filter((c) => dentro(c, iv));
  const L = todasL.filter(conta);
  const G = iv.invalido ? [] : D.longas.filter((c) => dentro(c, iv));
  const T = agregar(L, G);
  const linhas = ordenar("tabela", porFuncionario(L, G));
  const geradoEm = new Date();
  const filtros = "Equipe do paquistanês: " + (estado.pk ? "incluída" : "fora") + " · Prévias do modo observação: " + (estado.obs ? "incluídas" : "fora");
  const abas = [];

  // Resumo
  const M = agregar(L.filter((c) => horaBR(c.t) < 12), G.filter((g) => horaBR(g.t) < 12));
  const Tt = agregar(L.filter((c) => horaBR(c.t) >= 12), G.filter((g) => horaBR(g.t) >= 12));
  const removidos = todasL.filter((c) => c.rm).length;
  const marcados = L.filter((c) => c.m).length;
  const dif = (a, b) => (a === null || b === null ? null : b - a);
  const difDur = (a, b) => (a === null || b === null ? "—" : (b - a > 0 ? "+" : b - a < 0 ? "−" : "") + durTxt(Math.abs(b - a)));
  const r = [
    [C("Relatório de transferências", E.titulo)],
    [C("Período: " + iv.rot, E.subtitulo)],
    [C("Gerado em " + geradoEm.toLocaleString("pt-BR"), E.subtitulo)],
    [C(filtros, E.subtitulo)],
    [],
    cab("Indicador", "Valor", "Detalhe"),
    [C("Transferências", E.texto), C(T.tr, E.inteiro), C("com e sem callback", E.texto)],
    [C("Sem callback (atendidas)", E.texto), C(T.sem, E.inteiro), C("atendidas e longas o bastante", E.texto)],
    [C("Callbacks", E.texto), C(T.cb, E.inteiro), C("sem atendimento ou muito curtas" + (marcados ? "; " + marcados + " marcada(s) no relatório" : ""), E.texto)],
    [C("Taxa de callback", E.texto), C(razao(T.cb, T.tr), E.porcentagem), C("callbacks ÷ transferências", E.texto)],
    [C("Duração média até a transferência", E.texto), C(diaFr(media(T)), E.duracao), C(T.nd ? "de " + T.nd + " transferência(s) sem callback com a duração registrada" : "sem duração registrada", E.texto)],
    [C("Ligações de 5 min", E.texto), C(T.lg, E.inteiro), C("ainda no Stage 1", E.texto)],
    [C("Ligações de 5 min que viraram transferência", E.texto), C(razao(T.lgTr, T.lgAv), E.porcentagem), C(T.lgAv ? T.lgTr + " de " + T.lgAv + " ligações de 5 min" : "sem dados", E.texto)],
    [C("Callbacks removidos (cliente transferido de novo e atendido)", E.texto), C(removidos, E.inteiro), C("não entram nas contas; aparecem riscados na aba Ligações", E.texto)],
    [],
    [C("Antes e depois do meio-dia (horário de Brasília)", E.secao), C(null, E.secao), C(null, E.secao), C(null, E.secao)],
    cab("Indicador", "Antes do meio-dia", "Depois do meio-dia", "Diferença (depois − antes)"),
    [C("Ligações de 5 min", E.texto), C(M.lg, E.inteiro), C(Tt.lg, E.inteiro), C(Tt.lg - M.lg, E.inteiro)],
    [C("Transferências", E.texto), C(M.tr, E.inteiro), C(Tt.tr, E.inteiro), C(Tt.tr - M.tr, E.inteiro)],
    [C("Callbacks", E.texto), C(M.cb, E.inteiro), C(Tt.cb, E.inteiro), C(Tt.cb - M.cb, E.inteiro)],
    [C("Taxa de callback", E.texto), C(razao(M.cb, M.tr), E.porcentagem), C(razao(Tt.cb, Tt.tr), E.porcentagem), C(dif(razao(M.cb, M.tr), razao(Tt.cb, Tt.tr)), E.porcentagem)],
    [C("5 min que viraram transferência", E.texto), C(razao(M.lgTr, M.lgAv), E.porcentagem), C(razao(Tt.lgTr, Tt.lgAv), E.porcentagem), C(dif(razao(M.lgTr, M.lgAv), razao(Tt.lgTr, Tt.lgAv)), E.porcentagem)],
    [C("Duração média até a transferência", E.texto), C(diaFr(media(M)), E.duracao), C(diaFr(media(Tt)), E.duracao), C(difDur(media(M), media(Tt)), E.texto)],
    [],
    [C("Diferenças de porcentagem estão em pontos percentuais. Durações em horas:minutos:segundos.", E.subtitulo)],
  ];
  abas.push({ nome: "Resumo", larguras: [50, 18, 22, 60], linhas: r, mesclar: ["A1:D1", "A16:D16"], paisagem: true });

  // Por funcionário
  const pf = [cab("Funcionário", "Número", "Apelido", "Equipe", "Transferências", "Sem callback", "Callbacks", "% de callback", "Duração média até a transferência", "Transferências com duração", "Ligações de 5 min", "5 min transferidas", "% 5 min transferidas", "5 min não transferidas")];
  const linhaFunc = (nome, num, ap, eq, a, total) => {
    const [tx, ni, pc, du] = total ? [E.totalTexto, E.totalInteiro, E.totalPorcentagem, E.totalDuracao] : [E.texto, E.inteiro, E.porcentagem, E.duracao];
    return [C(nome, tx), C(num, tx), C(ap, tx), C(eq, tx), C(a.tr, ni), C(a.sem, ni), C(a.cb, ni), C(razao(a.cb, a.tr), pc), C(diaFr(media(a)), du), C(a.nd, ni), C(a.lg, ni), C(a.lgTr, ni), C(razao(a.lgTr, a.lgAv), pc), C(a.lgAv - a.lgTr, ni)];
  };
  for (const x of linhas) pf.push(linhaFunc(rotulo(x.f), String(x.f), apelido(x.f), equipeTxt(x.f), x.a, false));
  pf.push(linhaFunc("TOTAL", "", "", "", T, true));
  abas.push({ nome: "Por funcionário", larguras: [30, 14, 18, 14, 15, 14, 12, 13, 18, 15, 13, 13, 14, 14], linhas: pf, congelar: 1, filtro: "A1:N" + (linhas.length + 1), paisagem: true });

  // Ligações transferidas
  const lg = [cab("Data e hora", "Funcionário", "Equipe", "Cliente", "Resultado", "Duração até a transferência", "Duração depois da transferência", "Observações")];
  for (const c of [...todasL].sort((a, b) => a.t - b.t)) {
    const res = c.rm ? "Callback removido" : c.r === "c" ? "Callback" : "Atendida";
    const obs = [];
    if (c.rm) obs.push("cliente transferido de novo em " + new Date(c.rm.t).toLocaleString("pt-BR") + " por " + rotulo(c.rm.f) + " e atendido (não conta)");
    if (c.sb) obs.push("substitui " + (c.sb > 1 ? c.sb + " callbacks anteriores" : "1 callback anterior") + " do mesmo cliente");
    if (c.m) obs.push("marcado como callback no relatório");
    if (c.o) obs.push("prévia do modo observação");
    if (c.s) obs.push("sem a mensagem de transferência no registro");
    const st = c.rm ? E.removido : E.texto;
    lg.push([C(serialExcel(c.t), E.dataHora), C(rotulo(c.f), st), C(equipeTxt(c.f), st), C(c.c || "—", st), C(res, c.rm ? E.removido : c.r === "c" ? E.callback : E.atendida), C(c.r === "c" ? null : diaFr(c.u), E.duracao), C(c.r === "c" ? null : diaFr(c.d), E.duracao), C(obs.join("; "), E.texto)]);
  }
  abas.push({ nome: "Ligações", larguras: [20, 30, 13, 18, 18, 16, 14, 60], linhas: lg, congelar: 1, filtro: "A1:H" + lg.length, paisagem: true });

  // Ligações de 5 min
  const cinco = [cab("Data e hora", "Funcionário", "Equipe", "Cliente", "Virou transferência", "Observações")];
  for (const g of [...G].sort((a, b) => a.t - b.t))
    cinco.push([C(serialExcel(g.t), E.dataHora), C(rotulo(g.f), E.texto), C(equipeTxt(g.f), E.texto), C(g.c || "—", E.texto), C(g.x === null || g.x === undefined ? "Sem código (registro antigo)" : g.x ? "Sim" : "Não", g.x ? E.atendida : E.texto), C(g.o ? "prévia do modo observação" : "", E.texto)]);
  abas.push({ nome: "Ligações de 5 min", larguras: [20, 30, 13, 18, 26, 28], linhas: cinco, congelar: 1, filtro: "A1:F" + cinco.length });

  // Antes e depois do meio-dia, por funcionário
  const md = [cab("Funcionário", "Equipe", "5 min antes do meio-dia", "Transferências antes", "Callbacks antes", "% 5 min transferidas antes", "5 min depois do meio-dia", "Transferências depois", "Callbacks depois", "% 5 min transferidas depois")];
  for (const x of ordenar("meio", linhas))
    md.push([C(rotulo(x.f), E.texto), C(equipeTxt(x.f), E.texto), C(x.m.lg, E.inteiro), C(x.m.tr, E.inteiro), C(x.m.cb, E.inteiro), C(razao(x.m.lgTr, x.m.lgAv), E.porcentagem), C(x.t.lg, E.inteiro), C(x.t.tr, E.inteiro), C(x.t.cb, E.inteiro), C(razao(x.t.lgTr, x.t.lgAv), E.porcentagem)]);
  md.push([C("TOTAL", E.totalTexto), C("", E.totalTexto), C(M.lg, E.totalInteiro), C(M.tr, E.totalInteiro), C(M.cb, E.totalInteiro), C(razao(M.lgTr, M.lgAv), E.totalPorcentagem), C(Tt.lg, E.totalInteiro), C(Tt.tr, E.totalInteiro), C(Tt.cb, E.totalInteiro), C(razao(Tt.lgTr, Tt.lgAv), E.totalPorcentagem)]);
  abas.push({ nome: "Meio-dia por funcionário", larguras: [30, 13, 14, 14, 12, 15, 14, 14, 12, 15], linhas: md, congelar: 1, filtro: "A1:J" + (md.length - 1), paisagem: true });

  // Por hora (Brasília)
  const h5 = new Array(24).fill(0), hT = new Array(24).fill(0), hC = new Array(24).fill(0);
  for (const g of G) h5[horaBR(g.t)]++;
  for (const c of L) { hT[horaBR(c.t)]++; if (c.r === "c") hC[horaBR(c.t)]++; }
  const ph = [cab("Hora (Brasília)", "Ligações de 5 min", "Transferências", "Callbacks", "Taxa de callback")];
  const usadas = []; for (let h = 0; h < 24; h++) if (h5[h] || hT[h]) usadas.push(h);
  if (usadas.length) for (let h = usadas[0]; h <= usadas[usadas.length - 1]; h++)
    ph.push([C(String(h).padStart(2, "0") + "h às " + String(h).padStart(2, "0") + "h59", E.texto), C(h5[h], E.inteiro), C(hT[h], E.inteiro), C(hC[h], E.inteiro), C(razao(hC[h], hT[h]), E.porcentagem)]);
  ph.push([C("TOTAL", E.totalTexto), C(T.lg, E.totalInteiro), C(T.tr, E.totalInteiro), C(T.cb, E.totalInteiro), C(razao(T.cb, T.tr), E.totalPorcentagem)]);
  abas.push({ nome: "Por hora", larguras: [18, 16, 15, 12, 15], linhas: ph, congelar: 1 });

  return { abas, arquivo: nomeArquivo(iv) };
}
window.__abasDaPlanilha = abasDaPlanilha;
$("planilha").addEventListener("click", () => {
  const { abas, arquivo } = abasDaPlanilha();
  const blob = new Blob([montarXlsx(abas)], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = arquivo; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
});

/* ---- marcar como callback (só no relatório; precisa do relatorio.bat aberto) ---- */
let pendente = null;
function abrirConfirmacao(c) {
  pendente = c;
  const marcar = !c.m;
  $("conf-titulo").textContent = marcar ? "Marcar esta ligação como callback?" : "Desfazer a marcação de callback?";
  $("conf-texto").textContent = marcar
    ? "O relatório passa a contar esta transferência como callback. Nada é enviado ao Telegram. Dá para desfazer depois."
    : "A ligação volta a contar como atendida, como o programa registrou.";
  $("conf-sim").textContent = marcar ? "Marcar como callback" : "Desfazer";
  $("conf-quando").textContent = new Date(c.t).toLocaleString("pt-BR");
  $("conf-func").textContent = rotulo(c.f);
  $("conf-cliente").textContent = c.c || "—";
  $("conf-erro").textContent = "";
  $("conf-sim").disabled = false;
  $("confirma").showModal();
}
$("conf-nao").addEventListener("click", () => $("confirma").close());
$("conf-sim").addEventListener("click", async () => {
  const c = pendente; if (!c) return;
  const marcar = !c.m;
  $("conf-sim").disabled = true; $("conf-erro").textContent = "";
  try {
    const resp = await fetch("/marcar", { method: "POST", headers: { "Content-Type": "application/json", "X-Token": D.srv.token }, body: JSON.stringify({ chave: c.k, marcar }) });
    const r = await resp.json().catch(() => ({}));
    if (!resp.ok || !r.ok) throw new Error(r.erro || "falha " + resp.status);
    vivo.versao++;
    if (Array.isArray(r.ligacoes)) D.ligacoes = r.ligacoes; // recalculado no servidor (inclui a regra da religação)
    else for (const x of D.ligacoes) if (x.k === c.k) { x.m = marcar ? 1 : 0; x.r = marcar ? "c" : "a"; }
    $("confirma").close();
    desenhar();
  } catch (e) {
    $("conf-erro").textContent = "Não consegui salvar (" + (e && e.message ? e.message : e) + "). A janela do relatorio.bat foi fechada? Abra o relatorio.bat de novo.";
    $("conf-sim").disabled = false;
  }
});
$("detalhe").classList.toggle("sem-acao", !D.srv);
$("nota-acao").textContent = D.srv
  ? "Se uma ligação registrada como atendida na verdade foi callback, use “Marcar como callback”. A correção vale só para o relatório (nada é enviado ao Telegram) e fica gravada em callbacks-manuais.txt, na pasta de registros."
  : "Para marcar uma ligação como callback, abra o relatório pelo relatorio.bat e deixe a janela dele aberta enquanto usa a página.";

/* ---- atualização automática (só quando aberta pelo relatorio.bat): relê os registros a cada 10 s ---- */
const INTERVALO_VIVO_MS = 10000;
const vivo = { pausado: false, ocupado: false, versao: 0, falhas: 0 };
const hhmmss = (d) => d.toLocaleTimeString("pt-BR", { hour12: false });
function textoVivo(t) { $("vivo-txt").textContent = t; }
async function atualizar() {
  if (!D.srv || vivo.pausado || vivo.ocupado || document.hidden || $("confirma").open) return;
  vivo.ocupado = true;
  const v = vivo.versao; // se uma marcação terminar enquanto isto roda, esta resposta já está velha
  try {
    const resp = await fetch("/dados", { headers: { "X-Token": D.srv.token }, cache: "no-store" });
    if (!resp.ok) throw new Error("falha " + resp.status);
    const r = await resp.json();
    if (v !== vivo.versao || $("confirma").open || !Array.isArray(r.ligacoes) || !Array.isArray(r.longas)) return;
    if (JSON.stringify([r.ligacoes, r.longas]) !== JSON.stringify([D.ligacoes, D.longas])) {
      D.ligacoes = r.ligacoes; D.longas = r.longas; desenhar();
    }
    vivo.falhas = 0;
    $("gerado").textContent = "Atualizado às " + hhmmss(new Date());
    textoVivo("Atualização automática a cada " + INTERVALO_VIVO_MS / 1000 + " s.");
  } catch (e) {
    vivo.falhas++;
    textoVivo("Sem conexão com o relatório (a janela do relatorio.bat foi fechada?). Os números abaixo podem estar desatualizados.");
  } finally { vivo.ocupado = false; }
}
if (D.srv) {
  $("vivo").hidden = false;
  textoVivo("Atualização automática a cada " + INTERVALO_VIVO_MS / 1000 + " s.");
  $("vivo-btn").addEventListener("click", () => {
    vivo.pausado = !vivo.pausado;
    $("vivo-btn").textContent = vivo.pausado ? "Retomar atualização" : "Pausar atualização";
    textoVivo(vivo.pausado ? "Atualização automática pausada." : "Atualização automática a cada " + INTERVALO_VIVO_MS / 1000 + " s.");
    if (!vivo.pausado) void atualizar();
  });
  document.addEventListener("visibilitychange", () => { if (!document.hidden) void atualizar(); });
  window.__atualizarAgora = atualizar;
  setInterval(() => void atualizar(), INTERVALO_VIVO_MS);
}

$("gerado").textContent = "Gerado em " + new Date(D.gerado).toLocaleString("pt-BR");
estado.p = D.inicial.periodo || "hoje"; estado.de = D.inicial.de || ""; estado.ate = D.inicial.ate || "";
sincronizar();
</script>
</body>
</html>
`;
