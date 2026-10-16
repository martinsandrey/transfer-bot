import type { CustomerLookup, ResultadoBusca } from "../dominio/tipos.js";
import { somenteDigitos } from "../util/mascara.js";

/** Campos lidos do formulário do cliente. Qualquer um pode faltar (é normal): vira texto vazio na mensagem. */
export interface CamposDoCadastro {
  nome?: string | undefined;
  cpf?: string | undefined;
  location?: string | undefined;
  age?: string | undefined;
  phone?: string | undefined;
}

/**
 * Contato com a página Customer Data List. É a ÚNICA parte que depende do site (menu, campo Phone, botão Search,
 * tabela de resultados, formulário de edição) e só será escrita com a evidência do `npm run recon` (perguntas R1/R2).
 * Propositalmente NÃO existe método de salvar/atualizar/excluir: o bot só lê.
 */
export interface PaginaClientes {
  /** Chega à Customer Data List pelo menu. */
  abrir(): Promise<void>;
  /** Digita o telefone no campo Phone, aciona Search e espera o resultado. Devolve quantos clientes apareceram. */
  pesquisarPorTelefone(telefone: string): Promise<{ resultados: number }>;
  /**
   * Clica no botão **Edit** da LINHA do cliente pesquisado (o primeiro resultado) para abrir o formulário, somente para LER.
   * É a única ação de clique no cadastro: nunca clicar em Salvar/Save/Update/Delete. O botão certo é o da linha do resultado, e só
   * depois da pesquisa ter terminado. TODO(confirmar) (R2): aparência/rótulo do botão Edit na linha de resultados.
   */
  abrirEdicaoDoPrimeiro(): Promise<void>;
  /** Lê os campos do formulário, sem alterá-los. Campo ausente = `undefined`. */
  lerCampos(): Promise<CamposDoCadastro>;
  /**
   * Volta para a página **Voice Call Status** clicando no botão "Voice Call Status" do menu lateral esquerdo. Isso SUBSTITUI a página
   * atual e descarta o formulário de edição SEM confirmar (informado pelo usuário: o sistema não faz nenhuma pergunta ao sair).
   * Sempre chamado ao fim da consulta, com ou sem resultado, para o monitoramento continuar.
   */
  voltarParaVoiceCallStatus(): Promise<void>;
}

/**
 * Compara telefones só pelos dígitos, ignorando zeros à esquerda (prefixo de tronco).
 * TODO(confirmar) (P11): formato do telefone no cadastro versus o Callee Number.
 */
export function telefonesIguais(a: string, b: string): boolean {
  const limpa = (t: string): string => somenteDigitos(t).replace(/^0+/, "");
  const x = limpa(a);
  return x !== "" && x === limpa(b);
}

/**
 * Fluxo combinado com o usuário: Callee Number → Customer Data List → pesquisa por Phone → clica em Edit na linha do cliente
 * → lê o cadastro → clica em "Voice Call Status" no menu (descarta a edição sem confirmar).
 * - 0 resultados: não gera mensagem. Vários: segue com o primeiro (a fila alerta).
 * - Campo faltando no cadastro: fica VAZIO (regra do usuário); não é erro.
 * - Telefone do cadastro diferente do Callee Number: cliente errado, não envia. Telefone ausente no cadastro: não dá para
 *   conferir, e como a busca foi feita justamente por ele, segue com o campo `Ph` vazio.
 * Erros de navegação são repassados (a fila tenta de novo, de forma limitada).
 */
export class ConsultaDeCliente implements CustomerLookup {
  /** `aoFalharAoVoltar`: avisa quando não foi possível voltar à Voice Call Status (o monitoramento pode ficar cego). */
  constructor(
    private readonly pagina: PaginaClientes,
    private readonly aoFalharAoVoltar: (e: unknown) => void = () => undefined,
  ) {}

  async find(calleeNumber: string): Promise<ResultadoBusca> {
    try {
      await this.pagina.abrir();
      const { resultados } = await this.pagina.pesquisarPorTelefone(calleeNumber);
      if (resultados <= 0) return { tipo: "nenhum" };
      await this.pagina.abrirEdicaoDoPrimeiro();
      const c = await this.pagina.lerCampos();
      const telefone = (c.phone ?? "").trim();
      if (telefone !== "" && !telefonesIguais(telefone, calleeNumber)) {
        return { tipo: "telefone_divergente" };
      }
      return {
        tipo: "ok",
        multiplos: resultados > 1,
        registro: {
          nome: (c.nome ?? "").trim(),
          cpf: (c.cpf ?? "").trim(),
          location: (c.location ?? "").trim(),
          age: (c.age ?? "").trim(),
          phone: telefone,
        },
      };
    } finally {
      // Sempre: volta para a Voice Call Status pelo menu (o que descarta a edição sem confirmar), seja qual for o resultado.
      await this.pagina.voltarParaVoiceCallStatus().catch((e: unknown) => this.aoFalharAoVoltar(e));
    }
  }
}
