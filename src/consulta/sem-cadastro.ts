import type { CustomerLookup, ResultadoBusca } from "../dominio/tipos.js";

/**
 * Provisório até a consulta real ao cadastro existir (depende da evidência da Customer Data List, Fase 4).
 * Não acessa o site: devolve um registro só com o telefone (= Callee Number, regra do usuário) e deixa
 * nome, CPF, location e age em branco. A mensagem sai incompleta de propósito e o console avisa.
 */
export class BuscaSemCadastro implements CustomerLookup {
  async find(calleeNumber: string): Promise<ResultadoBusca> {
    return {
      tipo: "ok",
      registro: { nome: "", cpf: "", location: "", age: "", phone: calleeNumber },
      multiplos: false,
    };
  }
}
