/**
 * Código executado DENTRO da página (via page.evaluate). Precisa ser autocontido: não pode usar nada do módulo.
 * Só lê o DOM; nunca clica, digita nem lê o conteúdo (`value`) de campos. Os dados brutos retornados ficam
 * apenas em memória e passam pelo Anonimizador antes de qualquer gravação.
 */

export interface OpcoesExtracao {
  maxLinhas: number;
  /** Se informado, devolve só a tabela com esse índice. */
  indice: number | null;
}

export interface CelulaBruta {
  texto: string;
  /** Texto presente no DOM mas invisível (possível ID oculto); `null` se não há diferença. */
  textoOculto: string | null;
  atributos: Record<string, string>;
  esqueleto: string;
}
export interface LinhaBruta {
  atributos: Record<string, string>;
  celulas: CelulaBruta[];
}
export interface TabelaBruta {
  indice: number;
  tipo: string;
  atributos: Record<string, string>;
  cabecalhos: string[];
  totalLinhas: number;
  linhas: LinhaBruta[];
}
export interface ControleBruto {
  tag: string;
  tipo: string | null;
  atributos: Record<string, string>;
  rotulo: string | null;
  texto: string | null;
  visivel: boolean;
  dentroDe: string | null;
  dentroDeTabela: boolean;
}
export interface PaginaBruta {
  titulo: string;
  caminho: string;
  tabelas: TabelaBruta[];
  controles: ControleBruto[];
  folhasDeMenu: Array<{ tag: string; texto: string; atributos: Record<string, string> }>;
  titulos: string[];
  captcha: { hostsDeIframe: string[]; elementos: number };
  formularios: Array<{ atributos: Record<string, string>; totalControles: number }>;
}

export function extrairNoNavegador(op: OpcoesExtracao): PaginaBruta {
  const EXCLUIDOS = new Set(["style", "value", "srcdoc", "nonce"]);

  function relativo(url: string): string {
    try {
      const u = new URL(url, location.href);
      if (u.origin === location.origin) {
        const chaves = [...new Set([...u.searchParams.keys()])].sort().join(",");
        return u.pathname + (chaves ? `?${chaves}=…` : "") + (u.hash ? "#…" : "");
      }
      return `externo:${u.hostname}`;
    } catch {
      return "<url inválida>";
    }
  }
  function atributosDe(el: Element): Record<string, string> {
    const r: Record<string, string> = {};
    for (const a of Array.from(el.attributes)) {
      if (EXCLUIDOS.has(a.name) || a.name.startsWith("on")) continue;
      r[a.name] = ["href", "src", "action", "data-href", "data-url"].includes(a.name)
        ? relativo(a.value)
        : a.value.slice(0, 120);
    }
    return r;
  }
  function visivel(el: Element): boolean {
    const h = el as HTMLElement;
    return !!(h.offsetWidth || h.offsetHeight || h.getClientRects().length);
  }
  function limpo(t: string | null | undefined): string {
    return (t ?? "").replace(/\s+/g, " ").trim();
  }
  function esqueleto(el: Element, nivel = 0): string {
    if (nivel > 2 || el.children.length === 0) return el.tagName.toLowerCase();
    const filhos = Array.from(el.children)
      .slice(0, 4)
      .map((c) => esqueleto(c, nivel + 1));
    return `${el.tagName.toLowerCase()}>(${filhos.join(",")})`;
  }
  function rotuloDe(el: Element): string | null {
    const aria = el.getAttribute("aria-label");
    if (aria) return limpo(aria);
    const ids = el.getAttribute("aria-labelledby");
    if (ids) {
      const t = ids
        .split(/\s+/)
        .map((id) => limpo(document.getElementById(id)?.textContent))
        .join(" ")
        .trim();
      if (t) return t;
    }
    const labels = (el as HTMLInputElement).labels;
    if (labels && labels.length)
      return limpo(
        Array.from(labels)
          .map((l) => l.textContent)
          .join(" "),
      );
    const pai = el.closest("label");
    if (pai) return limpo(pai.textContent);
    const anterior = el.previousElementSibling;
    if (anterior && limpo(anterior.textContent).length <= 40) return limpo(anterior.textContent);
    return null;
  }
  function cabecalhosDe(t: Element): string[] {
    const hs = Array.from(t.querySelectorAll("th, [role=columnheader]"));
    if (hs.length) return hs.map((h) => limpo((h as HTMLElement).innerText ?? h.textContent));
    const primeira = t.querySelector("thead tr, tr");
    return primeira ? Array.from(primeira.children).map((c) => limpo(c.textContent)) : [];
  }

  // ---- tabelas ----
  const seletorTabelas = "table, [role=table], [role=grid], [role=treegrid]";
  const candidatos = Array.from(document.querySelectorAll(seletorTabelas));
  const tabelas: TabelaBruta[] = [];
  candidatos.forEach((t, indice) => {
    if (op.indice !== null && op.indice !== indice) return;
    const linhasEl = Array.from(t.querySelectorAll("tbody tr, [role=row]")).filter(
      (r) =>
        !r.querySelector("th, [role=columnheader]") ||
        r.querySelector("td, [role=cell], [role=gridcell]"),
    );
    const linhas: LinhaBruta[] = linhasEl.slice(0, op.maxLinhas).map((r) => ({
      atributos: atributosDe(r),
      celulas: Array.from(r.querySelectorAll("td, [role=cell], [role=gridcell]")).map((c) => {
        const h = c as HTMLElement;
        const visivelTxt = limpo(h.innerText ?? c.textContent);
        const todo = limpo(c.textContent);
        return {
          texto: visivelTxt,
          textoOculto: todo !== visivelTxt ? todo : null,
          atributos: atributosDe(c),
          esqueleto: esqueleto(c),
        };
      }),
    }));
    tabelas.push({
      indice,
      tipo:
        t.tagName.toLowerCase() +
        (t.getAttribute("role") ? `[role=${t.getAttribute("role")}]` : ""),
      atributos: atributosDe(t),
      cabecalhos: cabecalhosDe(t),
      totalLinhas: linhasEl.length,
      linhas,
    });
  });

  // ---- controles ----
  const contentorMenu =
    "nav, aside, [role=navigation], [role=menu], [class*=sidebar i], [class*=menu i]";
  const controles: ControleBruto[] = Array.from(
    document.querySelectorAll(
      "input, select, textarea, button, a[href], [role=button], [role=tab], [role=menuitem], [role=link], summary",
    ),
  )
    .slice(0, 500)
    .map((el) => {
      const tag = el.tagName.toLowerCase();
      const dentroDeTabela = !!el.closest("tbody tr, [role=row]");
      const eCampo = tag === "input" || tag === "select" || tag === "textarea";
      const contentor = el.closest(contentorMenu);
      return {
        tag,
        tipo: el.getAttribute("type"),
        atributos: atributosDe(el),
        rotulo: eCampo ? rotuloDe(el) : null,
        texto:
          eCampo || dentroDeTabela
            ? null
            : limpo((el as HTMLElement).innerText ?? el.textContent).slice(0, 60),
        visivel: visivel(el),
        dentroDe: contentor ? contentor.tagName.toLowerCase() : null,
        dentroDeTabela,
      };
    });

  const folhasDeMenu = Array.from(
    document.querySelectorAll(
      `${contentorMenu
        .split(",")
        .map((s) => `${s.trim()} *`)
        .join(", ")}`,
    ),
  )
    .filter(
      (el) =>
        el.children.length === 0 &&
        limpo(el.textContent).length > 0 &&
        limpo(el.textContent).length <= 40,
    )
    .slice(0, 300)
    .map((el) => ({
      tag: el.tagName.toLowerCase(),
      texto: limpo(el.textContent),
      atributos: atributosDe(el),
    }));

  const hostsDeIframe = Array.from(document.querySelectorAll("iframe"))
    .map((f) => relativo(f.getAttribute("src") ?? ""))
    .filter((s) => /captcha|turnstile|arkose|recaptcha/i.test(s));

  return {
    titulo: document.title,
    caminho: location.pathname,
    tabelas,
    controles,
    folhasDeMenu,
    titulos: Array.from(document.querySelectorAll("h1, h2, h3, h4"))
      .map((h) => limpo(h.textContent).slice(0, 80))
      .filter(Boolean)
      .slice(0, 30),
    captcha: {
      hostsDeIframe,
      elementos: document.querySelectorAll("[class*=captcha i], [id*=captcha i]").length,
    },
    formularios: Array.from(document.querySelectorAll("form")).map((f) => ({
      atributos: atributosDe(f),
      totalControles: f.querySelectorAll("input, select, textarea, button").length,
    })),
  };
}

/** Instala (uma vez) um contador de mutações do DOM na página; devolve e zera o total acumulado. */
export function lerContadorMutacoes(): { mutacoes: number; visibilidade: string; foco: boolean } {
  const w = window as unknown as { __reconMut?: { n: number } };
  if (!w.__reconMut) {
    const estado = { n: 0 };
    w.__reconMut = estado;
    new MutationObserver((lista) => {
      estado.n += lista.length;
    }).observe(document.documentElement, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
    });
  }
  const n = w.__reconMut.n;
  w.__reconMut.n = 0;
  return { mutacoes: n, visibilidade: document.visibilityState, foco: document.hasFocus() };
}
