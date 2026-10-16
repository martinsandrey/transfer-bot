import type {
  CallRow,
  CustomerLookup,
  CustomerRecord,
  ResultadoBusca,
  TableReader,
  TableSnapshot,
} from "../dominio/tipos.js";

/**
 * Cenário FICTÍCIO para o modo `--simular` e para testes: não representa o site real.
 * Números e nomes são inventados. Cada "tick" corresponde a uma leitura.
 */
const linha = (cb: string, ce: string, status: string, inicio: string): CallRow => ({
  callbackNumber: cb,
  calleeNumber: ce,
  callStatus: status,
  startTime: inicio,
  callDurationSec: 0,
});

export const CLIENTES_FICTICIOS: Record<string, CustomerRecord | "varios" | "divergente"> = {
  "011900000101": {
    nome: "Maria Exemplo",
    cpf: "000.000.000-01",
    location: "Cidade Exemplo, UF",
    age: "41",
    phone: "011900000101",
  },
  "011900000102": {
    nome: "João Exemplo",
    cpf: "000.000.000-02",
    location: "Outra Cidade, UF",
    age: "57",
    phone: "011900000102",
  },
  "011900000103": "varios",
  "011900000104": "divergente",
  // 011900000105: sem cadastro (0 resultados)
};

/** Linhas da tabela no tick `n` (a ordem muda a cada tick, como na tabela real descrita pelo usuário). */
export function linhasDoCenario(n: number): CallRow[] {
  const l: CallRow[] = [];
  /**
   * COMPORTAMENTO REAL (evidência do usuário): Ringing → Agent no Stage 1; na transferência a linha do Stage 1 SOME e surge
   * OUTRA linha em "Stage 3 Agent" com outro Callback Number (9083xx) e o MESMO Callee.
   * `s1`: tick em que passa a Agent; `transf`: tick da transferência; `fim`: tick em que a linha do Stage 3 some.
   */
  const chamada = (
    n0: number,
    s1: number,
    transf: number,
    fim: number,
    cbStage1: string,
    cbStage3: string,
    callee: string,
    inicio: string,
  ): void => {
    if (n < n0 || n >= fim) return;
    if (n < n0 + s1) l.push(linha(cbStage1, callee, "Stage 1 Ringing", inicio));
    else if (n < n0 + transf) l.push(linha(cbStage1, callee, "Stage 1 Agent", inicio));
    else l.push(linha(cbStage3, callee, "Stage 3 Agent", inicio));
  };
  // Base: já em Stage 3 ao iniciar (ignorada) e uma em Stage 1 que vai a Stage 2 (ignorada)
  l.push(linha("908310", "011900000110", "Stage 3 Agent", "08:00:00"));
  l.push(linha("908011", "011900000111", n < 4 ? "Stage 1 Agent" : "Stage 2 Agent", "08:01:00"));
  // Funcionário 1: transferência normal; depois outra ligação (outra transferência)
  chamada(0, 2, 5, 8, "908001", "908301", "011900000101", "09:00:00");
  chamada(10, 2, 5, 40, "908001", "908302", "011900000102", "09:30:00");
  // Funcionário 2: cliente com vários resultados
  chamada(2, 2, 5, 40, "908002", "908303", "011900000103", "09:05:00");
  // Funcionário 3: telefone divergente
  chamada(2, 2, 6, 40, "908003", "908304", "011900000104", "09:06:00");
  // Funcionário 4: cliente sem cadastro
  chamada(2, 2, 8, 40, "908004", "908305", "011900000105", "09:07:00");
  // Chamada que aparece direto em Stage 3, sem origem em Stage 1 (só aviso)
  if (n >= 5) l.push(linha("908306", "011900000106", "Stage 3 Agent", "09:08:00"));
  // Chamada manual: aparece e some (não é transferência)
  if (n >= 3 && n < 6) l.push(linha("908006", "011900000107", "Stage 1 Manual Call", "09:09:00"));
  return l;
}

export class LeitorSimulado implements TableReader {
  private n = 0;
  constructor(private readonly agora: () => number = Date.now) {}
  async read(): Promise<TableSnapshot> {
    return { readAt: this.agora(), rows: linhasDoCenario(this.n++), valid: true };
  }
}

export class BuscaSimulada implements CustomerLookup {
  async find(callee: string): Promise<ResultadoBusca> {
    await new Promise((r) => setTimeout(r, 50));
    const c = CLIENTES_FICTICIOS[callee];
    if (c === undefined) return { tipo: "nenhum" };
    if (c === "divergente") return { tipo: "telefone_divergente" };
    if (c === "varios")
      return {
        tipo: "ok",
        registro: {
          nome: "Primeiro Resultado",
          cpf: "000.000.000-03",
          location: "Cidade Exemplo, UF",
          age: "30",
          phone: callee,
        },
        multiplos: true,
      };
    return { tipo: "ok", registro: c, multiplos: false };
  }
}
