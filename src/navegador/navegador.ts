import { mkdirSync } from "node:fs";
import { chromium, type BrowserContext, type Page } from "playwright";
import type { AppConfig } from "../config/config.js";

/**
 * Flags contra a redução de timers de janelas em segundo plano/cobertas.
 * TODO(confirmar no Windows): efeito real sobre a atualização da tabela (roteiro da Fase 2).
 */
export const FLAGS_ANTI_THROTTLING = [
  "--disable-background-timer-throttling",
  "--disable-renderer-backgrounding",
  "--disable-backgrounding-occluded-windows",
  "--disable-features=CalculateNativeWinOcclusion",
];

export interface OpcoesNavegador {
  /** Somente para testes na nuvem (Linux): navegador instalado e/ou modo sem janela. */
  executablePath?: string;
  headless?: boolean;
  args?: string[];
}

export interface HospedeNavegador {
  readonly contexto: BrowserContext;
  /** Primeira aba (a que mostra o site). */
  paginaPrincipal(): Page;
  abrirUrl(url: string): Promise<void>;
  encerrar(): Promise<void>;
}

export async function iniciarNavegador(
  cfg: Pick<AppConfig, "navegador" | "pastas" | "timeouts">,
  op: OpcoesNavegador = {},
): Promise<HospedeNavegador> {
  mkdirSync(cfg.pastas.perfilNavegador, { recursive: true });
  const contexto = await chromium.launchPersistentContext(cfg.pastas.perfilNavegador, {
    headless: op.headless ?? false,
    viewport: null,
    ...(op.executablePath
      ? { executablePath: op.executablePath }
      : cfg.navegador === "msedge"
        ? { channel: "msedge" }
        : {}),
    args: [...FLAGS_ANTI_THROTTLING, ...(op.args ?? [])],
  });
  contexto.setDefaultNavigationTimeout(cfg.timeouts.navegacaoMs);
  contexto.setDefaultTimeout(cfg.timeouts.navegacaoMs);

  const pagina = contexto.pages()[0] ?? (await contexto.newPage());
  return {
    contexto,
    paginaPrincipal: () => pagina,
    abrirUrl: async (url) => {
      await pagina.goto(url, { waitUntil: "domcontentloaded" });
    },
    encerrar: async () => {
      await contexto.close().catch(() => undefined);
    },
  };
}
