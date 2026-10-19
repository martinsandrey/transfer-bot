import type { Frame, Page } from "playwright";
import { abrirMenusAte, descreverMenu } from "../navegador/menu-lateral.js";
import type { AdaptadorLogin, EstadoSessao } from "./login-manager.js";

/**
 * Login do site real. Evidência (recon de 2026-10-16): o formulário envia por POST `/logincheck.php` os campos
 * `verify_key` (preenchido por script da própria página), `done`, `username`, `password` e `submit`.
 * O programa só PREENCHE `username`/`password` e aciona o botão de envio UMA vez; não toca na verificação "clique no botão"
 * (captcha): essa parte é sempre da pessoa. Credenciais nunca são registradas em log.
 * Depois do login, a página mostra o menu; o adaptador abre "Voice Call Status" pelo menu para a tabela de chamadas aparecer.
 */
export interface SinaisDaPagina {
  tabelaPresente(): Promise<boolean>;
}

const CAMPO_SENHA = 'input[name="password"]';
const CAMPO_USUARIO = 'input[name="username"]';
const BOTAO_ENVIAR =
  'input[name="submit"], button[name="submit"], input[type="submit"], button[type="submit"]';

export class AdaptadorLoginDoSite implements AdaptadorLogin {
  private ultimoCliqueMenu = 0;
  private diagnosticou = false;
  constructor(
    private readonly pagina: Page,
    private readonly leitor: SinaisDaPagina,
    private readonly op: {
      timeoutMs: number;
      agora?: () => number;
      /** Chamado uma vez se o menu não pôde ser aberto (texto sem dados pessoais, para ajustar o seletor). */
      diagnostico?: (texto: string) => void;
    } = { timeoutMs: 15000 },
  ) {}

  private async frameComFormulario(): Promise<Frame | null> {
    for (const f of this.pagina.frames()) {
      try {
        if (await f.locator(CAMPO_SENHA).first().isVisible()) return f;
      } catch {
        /* frame navegando */
      }
    }
    return null;
  }

  async detectar(): Promise<EstadoSessao> {
    if (await this.leitor.tabelaPresente()) return "logado";
    if (await this.frameComFormulario()) return "nao_logado";
    await this.abrirVoiceCallStatusSePossivel();
    return "desconhecido"; // verificação na tela, página carregando ou menu sendo aberto
  }

  /** Já logado (menu visível) mas sem a tabela na tela: clica em "Voice Call Status" (navegação somente leitura), no máximo a cada 5 s. */
  private async abrirVoiceCallStatusSePossivel(): Promise<void> {
    const agora = (this.op.agora ?? Date.now)();
    if (agora - this.ultimoCliqueMenu < 5000) return;
    // O menu vem recolhido depois do login: abre os grupos (botões "+") para o item ficar visível antes de clicar nele.
    if (!(await abrirMenusAte(this.pagina, "Voice Call Status", this.op.timeoutMs))) {
      if (!this.diagnosticou) {
        this.diagnosticou = true;
        this.op.diagnostico?.(
          `Não achei o item "Voice Call Status" no menu nem abrindo os botões "+". Estrutura vista: ${await descreverMenu(this.pagina)}`,
        );
      }
      return;
    }
    for (const f of this.pagina.frames()) {
      try {
        const item = f.getByText("Voice Call Status", { exact: true }).first();
        if ((await item.count()) > 0 && (await item.isVisible())) {
          this.ultimoCliqueMenu = agora;
          await item.click({ timeout: this.op.timeoutMs });
          return;
        }
      } catch {
        /* tenta o próximo frame */
      }
    }
  }

  async preencherEEnviar(usuario: string, senha: string): Promise<void> {
    const f = await this.frameComFormulario();
    if (!f) throw new Error("formulário de login não encontrado");
    await f.locator(CAMPO_USUARIO).first().fill(usuario, { timeout: this.op.timeoutMs });
    await f.locator(CAMPO_SENHA).first().fill(senha, { timeout: this.op.timeoutMs });
    await f.locator(BOTAO_ENVIAR).first().click({ timeout: this.op.timeoutMs });
  }
}
