import { timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { chaveValida } from "./callbacks-manuais.js";

/**
 * Servidor local do relatório (`relatorio.bat`): serve a página e recebe o "Marcar como callback". Só escuta em 127.0.0.1 (o
 * próprio computador) e exige um token aleatório, que vai na página: outro site aberto no navegador não consegue ler a página
 * nem gravar marcações (o cabeçalho X-Token obriga o navegador a pedir permissão antes, e este servidor nunca a dá).
 */
export interface OpcoesServidor {
  token: string;
  /** Monta a página com os registros atuais (lidos de novo a cada abertura). */
  pagina: () => string;
  /** Grava a marcação. `false` = a ligação não existe nos registros. */
  marcar: (chave: string, marcar: boolean) => boolean;
  /** Ligações recalculadas depois da marcação (a página troca as suas por estas). */
  ligacoes?: () => unknown[];
  porta?: number;
}

export interface ServidorRelatorio {
  url: string;
  fechar(): Promise<void>;
}

const LIMITE_CORPO = 4096;

function igual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function responder(res: ServerResponse, status: number, tipo: string, corpo: string): void {
  res.writeHead(status, {
    "Content-Type": tipo,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "X-Frame-Options": "DENY",
  });
  res.end(corpo);
}
const json = (res: ServerResponse, status: number, v: unknown): void =>
  responder(res, status, "application/json; charset=utf-8", JSON.stringify(v));

function lerCorpo(req: IncomingMessage): Promise<string | null> {
  return new Promise((resolver) => {
    let total = 0;
    const partes: Buffer[] = [];
    req.on("data", (p: Buffer) => {
      total += p.length;
      if (total <= LIMITE_CORPO) partes.push(p); // o excesso é lido e descartado (para poder responder)
    });
    req.on("end", () =>
      resolver(total > LIMITE_CORPO ? null : Buffer.concat(partes).toString("utf8")),
    );
    req.on("error", () => resolver(null));
  });
}

export function iniciarServidor(op: OpcoesServidor): Promise<ServidorRelatorio> {
  let porta = 0;
  const servidor = createServer((req, res) => {
    void (async () => {
      // Só aceita o endereço do próprio servidor (barra sites que apontam um nome qualquer para 127.0.0.1).
      if (req.headers.host !== `127.0.0.1:${porta}` && req.headers.host !== `localhost:${porta}`)
        return responder(res, 403, "text/plain; charset=utf-8", "Acesso negado.");
      const url = new URL(req.url ?? "/", `http://127.0.0.1:${porta}`);
      if (req.method === "GET" && url.pathname === "/") {
        if (!igual(url.searchParams.get("k") ?? "", op.token))
          return responder(
            res,
            403,
            "text/plain; charset=utf-8",
            "Link vencido. Abra o relatorio.bat de novo.",
          );
        return responder(res, 200, "text/html; charset=utf-8", op.pagina());
      }
      if (req.method === "POST" && url.pathname === "/marcar") {
        if (!igual(String(req.headers["x-token"] ?? ""), op.token))
          return json(res, 403, { ok: false, erro: "link vencido; abra o relatorio.bat de novo" });
        if (!String(req.headers["content-type"] ?? "").startsWith("application/json"))
          return json(res, 415, { ok: false, erro: "formato inválido" });
        const corpo = await lerCorpo(req);
        let dados: unknown;
        try {
          dados = corpo === null ? null : JSON.parse(corpo);
        } catch {
          dados = null;
        }
        const d = dados as { chave?: unknown; marcar?: unknown } | null;
        if (
          !d ||
          typeof d.chave !== "string" ||
          typeof d.marcar !== "boolean" ||
          !chaveValida(d.chave)
        )
          return json(res, 400, { ok: false, erro: "pedido inválido" });
        try {
          return op.marcar(d.chave, d.marcar)
            ? json(res, 200, { ok: true, ...(op.ligacoes ? { ligacoes: op.ligacoes() } : {}) })
            : json(res, 404, { ok: false, erro: "ligação não encontrada nos registros" });
        } catch {
          return json(res, 500, { ok: false, erro: "não consegui gravar o arquivo de registro" });
        }
      }
      responder(res, 404, "text/plain; charset=utf-8", "Não encontrado.");
    })();
  });
  return new Promise((resolver, rejeitar) => {
    servidor.once("error", rejeitar);
    servidor.listen(op.porta ?? 0, "127.0.0.1", () => {
      porta = (servidor.address() as AddressInfo).port;
      resolver({
        url: `http://127.0.0.1:${porta}/?k=${op.token}`,
        fechar: () =>
          new Promise((r) => {
            servidor.closeAllConnections();
            servidor.close(() => r());
          }),
      });
    });
  });
}
