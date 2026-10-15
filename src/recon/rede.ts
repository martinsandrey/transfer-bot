import type { BrowserContext, Page, Request, Response, WebSocket } from "playwright";
import { formaJson, padraoCaminho } from "./forma-json.js";

export interface RegistroRede {
  metodo: string;
  caminho: string;
  tipo: string;
  externoHost?: string;
  chavesConsulta: string[];
  chavesCorpoEnviado: string[];
  status: number[];
  contentType: string;
  ocorrencias: number;
  intervaloMedianoMs: number | null;
  formaResposta?: unknown;
}

interface Interno extends RegistroRede {
  instantes: number[];
  amostras: number;
}

const TIPOS = new Set(["xhr", "fetch", "eventsource", "websocket"]);

function mediana(v: number[]): number | null {
  if (v.length === 0) return null;
  const o = [...v].sort((a, b) => a - b);
  return o[Math.floor(o.length / 2)] ?? null;
}

/**
 * Observação PASSIVA do tráfego que a própria página já faz. Guarda apenas método, caminho (padronizado),
 * NOMES de parâmetros e a ESTRUTURA (chaves/tipos) das respostas. Nunca guarda valores, cabeçalhos ou cookies.
 */
export class ObservadorRede {
  private readonly registros = new Map<string, Interno>();
  private readonly paginasObservadas = new WeakSet<Page>();

  constructor(
    private readonly contexto: BrowserContext,
    private readonly agora: () => number = Date.now,
  ) {}

  iniciar(): void {
    this.contexto.on("response", (r) => void this.aoResponder(r));
    this.contexto.on("page", (p) => this.observarPagina(p));
    for (const p of this.contexto.pages()) this.observarPagina(p);
  }

  private observarPagina(p: Page): void {
    if (this.paginasObservadas.has(p)) return;
    this.paginasObservadas.add(p);
    p.on("websocket", (ws) => this.aoAbrirWebSocket(ws));
  }

  private registro(chave: string, base: () => Interno): Interno {
    let r = this.registros.get(chave);
    if (!r) {
      r = base();
      this.registros.set(chave, r);
    }
    r.ocorrencias++;
    r.instantes.push(this.agora());
    if (r.instantes.length > 500) r.instantes.shift();
    return r;
  }

  private localizar(req: Request): { caminho: string; chaves: string[]; externoHost?: string } {
    const u = new URL(req.url());
    const principal = new URL(req.frame()?.page()?.url() ?? req.url());
    const externo = u.host !== principal.host;
    return {
      caminho: padraoCaminho(u.pathname),
      chaves: [...new Set([...u.searchParams.keys()])].sort(),
      ...(externo ? { externoHost: u.hostname } : {}),
    };
  }

  private async aoResponder(resp: Response): Promise<void> {
    try {
      const req = resp.request();
      const tipo = req.resourceType();
      const escrita = req.method() !== "GET" && req.method() !== "HEAD";
      if (!TIPOS.has(tipo) && !escrita) return;
      const loc = this.localizar(req);
      const chave = `${req.method()} ${loc.externoHost ?? ""}${loc.caminho} ${loc.chaves.join(",")}`;
      const ct = (resp.headers()["content-type"] ?? "").split(";")[0] ?? "";
      const r = this.registro(chave, () => ({
        metodo: req.method(),
        caminho: loc.caminho,
        tipo,
        ...(loc.externoHost ? { externoHost: loc.externoHost } : {}),
        chavesConsulta: loc.chaves,
        chavesCorpoEnviado: chavesDoCorpo(req),
        status: [],
        contentType: ct,
        ocorrencias: 0,
        intervaloMedianoMs: null,
        instantes: [],
        amostras: 0,
      }));
      if (!r.status.includes(resp.status())) r.status.push(resp.status());
      if (r.amostras < 2 && ct.includes("json") && !loc.externoHost) {
        r.amostras++;
        const texto = await resp.text();
        if (texto.length < 2_000_000) r.formaResposta = formaJson(JSON.parse(texto));
      }
    } catch {
      /* resposta indisponível/fechada: ignorar */
    }
  }

  private aoAbrirWebSocket(ws: WebSocket): void {
    const u = new URL(ws.url());
    const chave = `WS ${padraoCaminho(u.pathname)}`;
    const r = this.registro(chave, () => ({
      metodo: "WS",
      caminho: padraoCaminho(u.pathname),
      tipo: "websocket",
      chavesConsulta: [...new Set([...u.searchParams.keys()])].sort(),
      chavesCorpoEnviado: [],
      status: [],
      contentType: "",
      ocorrencias: 0,
      intervaloMedianoMs: null,
      instantes: [],
      amostras: 0,
    }));
    ws.on("framereceived", (f) => {
      r.instantes.push(this.agora());
      r.ocorrencias++;
      if (r.amostras < 2 && typeof f.payload === "string") {
        r.amostras++;
        try {
          r.formaResposta = formaJson(JSON.parse(f.payload));
        } catch {
          r.formaResposta = `texto não-JSON (${f.payload.length} caracteres)`;
        }
      }
    });
  }

  resumo(): RegistroRede[] {
    return [...this.registros.values()].map((r) => {
      const deltas = r.instantes.slice(1).map((t, i) => t - (r.instantes[i] ?? t));
      return {
        metodo: r.metodo,
        caminho: r.caminho,
        tipo: r.tipo,
        ...(r.externoHost ? { externoHost: r.externoHost } : {}),
        chavesConsulta: r.chavesConsulta,
        chavesCorpoEnviado: r.chavesCorpoEnviado,
        status: r.status,
        contentType: r.contentType,
        ocorrencias: r.ocorrencias,
        intervaloMedianoMs: mediana(deltas),
        ...(r.formaResposta !== undefined ? { formaResposta: r.formaResposta } : {}),
      };
    });
  }
}

function chavesDoCorpo(req: Request): string[] {
  const dados = req.postData();
  if (!dados) return [];
  try {
    const j: unknown = JSON.parse(dados);
    if (j && typeof j === "object")
      return Object.keys(j as object).map((k) => (/\d{4,}/.test(k) ? "<CHAVE_NUMERICA>" : k));
  } catch {
    /* não é JSON */
  }
  try {
    return [...new Set([...new URLSearchParams(dados).keys()])];
  } catch {
    return [];
  }
}
