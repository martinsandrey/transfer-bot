/**
 * Código executado DENTRO da página (via page.evaluate). Precisa ser autocontido: não pode usar nada do módulo.
 * Só lê o DOM; nunca clica, digita nem lê o conteúdo (`value`) de campos. Os dados brutos retornados ficam
 * apenas em memória e passam pelo Anonimizador antes de qualquer gravação.
 */

export interface OpcoesExtracao {
  maxLinhas: number;
  /** Se informado, devolve só a tabela com esse índice. */
  indice: number | null;
  /** Também procura grades feitas de `div` (sem <table>) a partir dos cabeçalhos conhecidos e entra em Shadow DOM aberto. */
  heuristicas: boolean;
  /** Textos de cabeçalho informados pelo usuário (usados só nas heurísticas). */
  cabecalhosConhecidos: string[];
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
  const normalizar = (t: string): string =>
    t
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
  function raizes(): ParentNode[] {
    const todas: ParentNode[] = [document];
    if (!op.heuristicas) return todas;
    const fila: ParentNode[] = [document];
    while (fila.length) {
      const no = fila.pop() as ParentNode;
      for (const el of Array.from(no.querySelectorAll("*"))) {
        const sr = el.shadowRoot;
        if (sr) {
          todas.push(sr);
          fila.push(sr);
        }
      }
    }
    return todas;
  }
  function consultar(sel: string): Element[] {
    return raizes().flatMap((r) => Array.from(r.querySelectorAll(sel)));
  }

  interface Candidata {
    tipo: string;
    raiz: Element;
    cabecalhos: string[];
    linhasEl: Element[];
    celulasDe: (r: Element) => Element[];
  }
  const celulasPadrao = (r: Element): Element[] =>
    Array.from(r.querySelectorAll("td, [role=cell], [role=gridcell]"));

  function candidatasPadrao(): Candidata[] {
    return consultar("table, [role=table], [role=grid], [role=treegrid]").map((t) => ({
      tipo:
        t.tagName.toLowerCase() +
        (t.getAttribute("role") ? `[role=${t.getAttribute("role")}]` : ""),
      raiz: t,
      cabecalhos: cabecalhosDe(t),
      linhasEl: Array.from(t.querySelectorAll("tbody tr, [role=row]")).filter(
        (r) =>
          !r.querySelector("th, [role=columnheader]") ||
          r.querySelector("td, [role=cell], [role=gridcell]"),
      ),
      celulasDe: celulasPadrao,
    }));
  }

  /** Heurística: acha a "linha de cabeçalho" como o menor ancestral que contém 3+ cabeçalhos conhecidos distintos. */
  function candidatasDiv(): Candidata[] {
    const conhecidos = new Set(op.cabecalhosConhecidos.map(normalizar));
    const folhas = consultar("*").filter(
      (el) => el.children.length === 0 && conhecidos.has(normalizar(el.textContent ?? "")),
    );
    const vistos = new Set<Element>();
    const saida: Candidata[] = [];
    for (const f of folhas) {
      let a: Element | null = f.parentElement;
      while (a) {
        const distintos = new Set(
          folhas.filter((x) => a?.contains(x)).map((x) => normalizar(x.textContent ?? "")),
        );
        if (distintos.size >= 3) break;
        a = a.parentElement;
      }
      if (!a || vistos.has(a) || a.children.length < 3) continue;
      vistos.add(a);
      const cabecalho = a;
      const cabecalhos = Array.from(cabecalho.children).map((c) =>
        limpo((c as HTMLElement).innerText ?? c.textContent),
      );
      const pai = cabecalho.parentElement;
      let linhasEl: Element[] = [];
      if (pai) {
        const irmaos = Array.from(pai.children).filter(
          (x) => x !== cabecalho && x.tagName === cabecalho.tagName,
        );
        if (irmaos.length && irmaos[0]?.children.length === cabecalhos.length) linhasEl = irmaos;
        else {
          const seguinte = pai.nextElementSibling;
          const filhos = seguinte ? Array.from(seguinte.children) : [];
          if (filhos.length && filhos[0]?.children.length === cabecalhos.length) linhasEl = filhos;
        }
      }
      saida.push({
        tipo: "grade_div(heuristica)",
        raiz: pai ?? cabecalho,
        cabecalhos,
        linhasEl,
        celulasDe: (r) => Array.from(r.children),
      });
    }
    return saida;
  }

  const candidatas = [...candidatasPadrao(), ...(op.heuristicas ? candidatasDiv() : [])];
  const tabelas: TabelaBruta[] = [];
  candidatas.forEach((c, indice) => {
    if (op.indice !== null && op.indice !== indice) return;
    const linhas: LinhaBruta[] = c.linhasEl.slice(0, op.maxLinhas).map((r) => ({
      atributos: atributosDe(r),
      celulas: c.celulasDe(r).map((cel) => {
        const h = cel as HTMLElement;
        const visivelTxt = limpo(h.innerText ?? cel.textContent);
        const todo = limpo(cel.textContent);
        return {
          texto: visivelTxt,
          textoOculto: todo !== visivelTxt ? todo : null,
          atributos: atributosDe(cel),
          esqueleto: esqueleto(cel),
        };
      }),
    }));
    tabelas.push({
      indice,
      tipo: c.tipo,
      atributos: atributosDe(c.raiz),
      cabecalhos: c.cabecalhos,
      totalLinhas: c.linhasEl.length,
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

export interface AchadoDiagnostico {
  texto: string;
  frame: string;
  emShadowDom: boolean;
  visivel: boolean;
  tag: string;
  ehTh: boolean;
  cadeia: Array<{ tag: string; id: string; classes: string; role: string }>;
  irmaos: string[];
}
export interface DiagnosticoBruto {
  frame: string;
  totais: {
    tables: number;
    roleTables: number;
    roleRows: number;
    iframes: number;
    hostsShadow: number;
  };
  achados: AchadoDiagnostico[];
}

/** Descreve ONDE aparecem os textos de cabeçalho (estrutura apenas; nenhum valor de célula). */
export function diagnosticarNoNavegador(textos: string[]): DiagnosticoBruto {
  const normalizar = (t: string): string =>
    t
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
  const alvos = textos.map(normalizar);
  const raizes: Array<{ raiz: ParentNode; shadow: boolean }> = [{ raiz: document, shadow: false }];
  const fila: ParentNode[] = [document];
  while (fila.length) {
    const no = fila.pop() as ParentNode;
    for (const el of Array.from(no.querySelectorAll("*"))) {
      if (el.shadowRoot) {
        raizes.push({ raiz: el.shadowRoot, shadow: true });
        fila.push(el.shadowRoot);
      }
    }
  }
  const achados: AchadoDiagnostico[] = [];
  for (const { raiz, shadow } of raizes) {
    for (const el of Array.from(raiz.querySelectorAll("*"))) {
      if (achados.length >= 40) break;
      if (el.children.length !== 0) continue;
      const t = normalizar(el.textContent ?? "");
      if (!t || t.length > 40 || !alvos.some((a) => t === a || t.includes(a))) continue;
      const cadeia: AchadoDiagnostico["cadeia"] = [];
      let a: Element | null = el;
      for (let i = 0; a && i < 8; i++) {
        cadeia.push({
          tag: a.tagName.toLowerCase(),
          id: a.id,
          classes: (a.getAttribute("class") ?? "").slice(0, 80),
          role: a.getAttribute("role") ?? "",
        });
        a = a.parentElement ?? (a.getRootNode() as ShadowRoot).host ?? null;
      }
      const pai = el.parentElement;
      achados.push({
        texto: t,
        frame: "",
        emShadowDom: shadow,
        visivel: !!((el as HTMLElement).offsetWidth || (el as HTMLElement).offsetHeight),
        tag: el.tagName.toLowerCase(),
        ehTh: el.tagName === "TH" || el.closest("th") !== null,
        cadeia,
        irmaos: pai
          ? Array.from(pai.children)
              .slice(0, 8)
              .map((c) => c.tagName.toLowerCase())
          : [],
      });
    }
  }
  return {
    frame: location.pathname,
    totais: {
      tables: document.querySelectorAll("table").length,
      roleTables: document.querySelectorAll("[role=table], [role=grid], [role=treegrid]").length,
      roleRows: document.querySelectorAll("[role=row]").length,
      iframes: document.querySelectorAll("iframe").length,
      hostsShadow: raizes.length - 1,
    },
    achados,
  };
}
