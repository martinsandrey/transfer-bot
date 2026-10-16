import type { BrowserContext, Frame, Page } from "playwright";
import type { CamposDoCadastro, PaginaClientes } from "./consulta-cliente.js";
import { deveBloquear } from "./bloqueio.js";
import { camposPorRotulo, type ParRotuloValor } from "./rotulos.js";

/**
 * Adaptador real (Playwright) da Customer Data List. Só usa o que o recon de 2026-10-16 confirmou (docs/EVIDENCIAS.md):
 * - menu lateral: item com o texto "Customer Data List" / "Voice Call Status" (clique substitui a página; nenhum aviso ao sair);
 * - lista em iframe `/modules/cc_cds/`: campo de busca `ft[phone]` (o `ft[mob_phone]` é outro campo), botão `#submitButton` (Search),
 *   linhas de resultado = linhas com checkbox `checkboxes[]`, ação "Edit" = link com esse texto na linha;
 * - edição em iframe `/modules/cc_cds/edit.php`: pares "rótulo： valor" em células vizinhas.
 * NUNCA clica em Delete/Confirm/Add/Import/One-Click/Back nem no botão "Edit" (submit) do formulário de edição.
 */
export interface OpcoesPaginaClientes {
  timeoutMs: number;
}

const CAMINHO_LISTA = "/modules/cc_cds/";
const CAMINHO_EDICAO = "/modules/cc_cds/edit.php";

function caminhoDe(f: Frame): string {
  try {
    return new URL(f.url()).pathname;
  } catch {
    return "";
  }
}

/** Liga a proteção de escrita: aborta qualquer requisição que possa alterar cadastro. Chamar uma vez por contexto. */
export async function instalarBloqueioDeEscrita(
  contexto: BrowserContext,
  aoBloquear: (metodo: string, caminho: string) => void = () => undefined,
): Promise<void> {
  await contexto.route("**/*", async (rota) => {
    const req = rota.request();
    let caminho = "";
    try {
      caminho = new URL(req.url()).pathname;
    } catch {
      /* URL sem caminho (data:, about:) segue */
    }
    if (caminho !== "" && deveBloquear({ metodo: req.method(), caminho })) {
      aoBloquear(req.method(), caminho);
      await rota.abort("blockedbyclient");
      return;
    }
    await rota.continue();
  });
}

export class PaginaClientesPlaywright implements PaginaClientes {
  constructor(
    private readonly pagina: Page,
    private readonly op: OpcoesPaginaClientes,
  ) {}

  private frame(caminho: string): Frame | undefined {
    return this.pagina.frames().find((f) => caminhoDe(f) === caminho);
  }

  private async esperarFrame(caminho: string): Promise<Frame> {
    const limite = Date.now() + this.op.timeoutMs;
    while (Date.now() < limite) {
      const f = this.frame(caminho);
      if (f) {
        await f.waitForLoadState("domcontentloaded", { timeout: this.op.timeoutMs });
        return f;
      }
      await this.pagina.waitForTimeout(100);
    }
    throw new Error(`A tela esperada (${caminho}) não apareceu a tempo.`);
  }

  /** Clica no item de menu com o texto exato, procurando na página e em todos os iframes (o menu fica na página principal). */
  private async clicarMenu(texto: string): Promise<void> {
    for (const f of this.pagina.frames()) {
      const alvo = f.getByText(texto, { exact: true }).first();
      if ((await alvo.count()) > 0 && (await alvo.isVisible().catch(() => false))) {
        await alvo.click({ timeout: this.op.timeoutMs });
        return;
      }
    }
    throw new Error(`Item de menu "${texto}" não encontrado.`);
  }

  async abrir(): Promise<void> {
    await this.clicarMenu("Customer Data List");
    const f = await this.esperarFrame(CAMINHO_LISTA);
    await f.locator('input[name="ft[phone]"]').waitFor({ timeout: this.op.timeoutMs });
  }

  async pesquisarPorTelefone(telefone: string): Promise<{ resultados: number }> {
    const f = await this.esperarFrame(CAMINHO_LISTA);
    await f.locator('input[name="ft[phone]"]').fill(telefone);
    // A busca recarrega o iframe: marca o documento atual e espera a marca sumir (documento novo).
    await f.evaluate(() => {
      (window as unknown as Record<string, unknown>)["__tbMarca"] = true;
    });
    await f.locator("#submitButton").first().click({ timeout: this.op.timeoutMs });
    await f.waitForFunction(
      () => !(window as unknown as Record<string, unknown>)["__tbMarca"],
      undefined,
      { timeout: this.op.timeoutMs },
    );
    const novo = await this.esperarFrame(CAMINHO_LISTA);
    await novo.waitForLoadState("load", { timeout: this.op.timeoutMs });
    return {
      resultados: await novo.locator('input[type="checkbox"][name="checkboxes[]"]').count(),
    };
  }

  async abrirEdicaoDoPrimeiro(): Promise<void> {
    const f = await this.esperarFrame(CAMINHO_LISTA);
    const linha = f.locator("tr", { has: f.locator('input[name="checkboxes[]"]') }).first();
    // Link com o texto exato "Edit" (nunca o "Delete" ao lado).
    await linha.getByText("Edit", { exact: true }).first().click({ timeout: this.op.timeoutMs });
    const e = await this.esperarFrame(CAMINHO_EDICAO);
    await e.locator("form").first().waitFor({ state: "attached", timeout: this.op.timeoutMs });
  }

  async lerCampos(): Promise<CamposDoCadastro> {
    const e = await this.esperarFrame(CAMINHO_EDICAO);
    const pares = await e.evaluate((): ParRotuloValor[] => {
      const saida: { rotulo: string; valor: string | undefined }[] = [];
      for (const td of Array.from(document.querySelectorAll("td"))) {
        const rotulo = (td.textContent ?? "").trim();
        if (td.querySelector("td, input, select") || !/[:：]\s*$/.test(rotulo)) continue;
        const vizinha = td.nextElementSibling;
        const campo = vizinha?.querySelector("input:not([type=hidden]), textarea, select");
        if (!campo) continue;
        let valor: string | undefined;
        if (campo instanceof HTMLSelectElement) {
          valor = campo.selectedOptions[0]?.textContent ?? "";
        } else if (campo instanceof HTMLInputElement || campo instanceof HTMLTextAreaElement) {
          valor = campo.value;
        }
        saida.push({ rotulo, valor });
      }
      return saida;
    });
    return camposPorRotulo(pares);
  }

  async voltarParaVoiceCallStatus(): Promise<void> {
    await this.clicarMenu("Voice Call Status");
    // Não espera a tabela aqui: o monitor volta a ler e tolera alguns segundos sem tabela.
    await this.pagina.waitForLoadState("domcontentloaded", { timeout: this.op.timeoutMs });
  }
}
