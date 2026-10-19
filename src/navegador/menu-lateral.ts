import type { Frame, Page } from "playwright";

/**
 * Menu lateral (árvore dhtmlx, linhas `standartTreeRow`). Depois do login ele vem TODO RECOLHIDO: os itens "Voice Call Status" e
 * "Customer Data List" só ficam visíveis depois de abrir os grupos pelos botões de "mais" (+) à esquerda (relato do usuário:
 * três botões). Abrir/fechar grupos do menu é só navegação visual: não altera nada no sistema.
 *
 * TODO(confirmar): o HTML exato do botão "+" ainda não foi capturado. A suposição (padrão do dhtmlxTree) é um `<img>` cujo `src`
 * contém "plus" (e não "minus"), no mesmo frame das linhas `standartTreeRow`. Se o site usar outra marcação, o diagnóstico
 * (`descreverMenu`) mostra o que existe no frame para ajustar o seletor com evidência.
 */
export const LINHA_DA_ARVORE = ".standartTreeRow";
const BOTAO_MAIS = 'img[src*="plus" i]:not([src*="minus" i])';
const MAX_CLIQUES = 15;

async function esperarAte(condicao: () => Promise<boolean>, timeoutMs: number): Promise<boolean> {
  const fim = Date.now() + timeoutMs;
  for (;;) {
    if (await condicao().catch(() => false)) return true;
    if (Date.now() >= fim) return false;
    await new Promise((r) => setTimeout(r, 50));
  }
}

async function itemVisivel(frame: Frame, texto: string): Promise<boolean> {
  const item = frame.getByText(texto, { exact: true }).first();
  return (await item.count()) > 0 && (await item.isVisible().catch(() => false));
}

/** Frames que têm a árvore do menu. */
async function framesDoMenu(pagina: Page): Promise<Frame[]> {
  const saida: Frame[] = [];
  for (const f of pagina.frames()) {
    try {
      if ((await f.locator(LINHA_DA_ARVORE).count()) > 0) saida.push(f);
    } catch {
      /* frame navegando */
    }
  }
  return saida;
}

/**
 * Abre os grupos recolhidos do menu (clicando nos botões "+", um por vez, do de cima para o de baixo, e olhando de novo depois
 * de cada clique porque abrir um grupo pode revelar outro). Para quando o item pedido ficar visível, quando não houver mais
 * "+" ou após `MAX_CLIQUES` cliques. Devolve se o item ficou visível. Nunca lança erro.
 */
export async function abrirMenusAte(
  pagina: Page,
  textoDoItem: string,
  timeoutDoCliqueMs = 5000,
): Promise<boolean> {
  try {
    const frames = await framesDoMenu(pagina);
    for (const f of frames) {
      if (await itemVisivel(f, textoDoItem)) return true;
      for (let i = 0; i < MAX_CLIQUES; i++) {
        const botoes = f.locator(BOTAO_MAIS);
        let alvo = null;
        const total = await botoes.count();
        for (let k = 0; k < total; k++) {
          const b = botoes.nth(k);
          if (await b.isVisible().catch(() => false)) {
            alvo = b;
            break;
          }
        }
        if (!alvo) break;
        const antes = await f
          .locator(LINHA_DA_ARVORE)
          .evaluateAll((els) => els.filter((e) => (e as HTMLElement).offsetParent !== null).length);
        await alvo.click({ timeout: timeoutDoCliqueMs }).catch(() => undefined);
        // espera por condição: apareceram mais linhas do menu, ou o botão clicado deixou de ser "+"
        await esperarAte(
          async () =>
            (await f
              .locator(LINHA_DA_ARVORE)
              .evaluateAll(
                (els) => els.filter((e) => (e as HTMLElement).offsetParent !== null).length,
              )) > antes,
          1500,
        );
        if (await itemVisivel(f, textoDoItem)) return true;
      }
    }
    for (const f of frames) if (await itemVisivel(f, textoDoItem)) return true;
  } catch {
    /* nunca atrapalha o fluxo principal */
  }
  return false;
}

/** Resumo do que existe nos frames do menu (sem dados de pessoas): serve para ajustar o seletor do "+" com evidência. */
export async function descreverMenu(pagina: Page): Promise<string> {
  try {
    const partes: string[] = [];
    for (const f of await framesDoMenu(pagina)) {
      const info = await f.evaluate((linha) => {
        const imgs = Array.from(document.querySelectorAll("img")).map((i) =>
          (i.getAttribute("src") ?? "").split("/").pop(),
        );
        const contagem: Record<string, number> = {};
        for (const s of imgs) contagem[s ?? ""] = (contagem[s ?? ""] ?? 0) + 1;
        return {
          linhas: document.querySelectorAll(linha).length,
          imagens: contagem,
        };
      }, LINHA_DA_ARVORE);
      partes.push(`linhas=${info.linhas} imagens=${JSON.stringify(info.imagens)}`);
    }
    return partes.length ? partes.join(" | ") : "nenhum frame com o menu (standartTreeRow)";
  } catch {
    return "não foi possível descrever o menu";
  }
}
