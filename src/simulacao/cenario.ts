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
  "5521900000101": {
    nome: "Maria Exemplo",
    cpf: "000.000.000-01",
    location: "Cidade Exemplo, UF",
    age: "41",
    phone: "5521900000101",
  },
  "5521900000102": {
    nome: "João Exemplo",
    cpf: "000.000.000-02",
    location: "Outra Cidade, UF",
    age: "57",
    phone: "5521900000102",
  },
  "5521900000103": "varios",
  "5521900000104": "divergente",
  // 5521900000105: sem cadastro (0 resultados)
};

/** Linhas da tabela no tick `n` (a ordem muda a cada tick, como na tabela real descrita pelo usuário). */
export function linhasDoCenario(n: number): CallRow[] {
  const l: CallRow[] = [];
  // Base: já em Stage 3 ao iniciar (ignorada) e uma em Stage 1 que vai a Stage 2 (ignorada)
  l.push(linha("5511900000010", "5521900000110", "Stage 3 Agent", "08:00:00"));
  l.push(
    linha("5511900000011", "5521900000111", n < 4 ? "Stage 1 Agent" : "Stage 2 Agent", "08:01:00"),
  );
  // Funcionário 1: transferência normal (Stage 1 → 3 no tick 3); depois sai e faz outra ligação (outra transferência)
  if (n < 8)
    l.push(
      linha(
        "5511900000001",
        "5521900000101",
        n < 3 ? "Stage 1 Agent" : "Stage 3 Agent",
        "09:00:00",
      ),
    );
  if (n >= 10)
    l.push(
      linha(
        "5511900000001",
        "5521900000102",
        n < 12 ? "Stage 1 Agent" : "Stage 3 Agent",
        "09:30:00",
      ),
    );
  // Funcionário 2: cliente com vários resultados
  if (n >= 2)
    l.push(
      linha(
        "5511900000002",
        "5521900000103",
        n < 6 ? "Stage 1 Agent" : "Stage 3 Agent",
        "09:05:00",
      ),
    );
  // Funcionário 3: telefone divergente
  if (n >= 2)
    l.push(
      linha(
        "5511900000003",
        "5521900000104",
        n < 7 ? "Stage 1 Agent" : "Stage 3 Agent",
        "09:06:00",
      ),
    );
  // Funcionário 4: cliente sem cadastro
  if (n >= 2)
    l.push(
      linha(
        "5511900000004",
        "5521900000105",
        n < 9 ? "Stage 1 Agent" : "Stage 3 Agent",
        "09:07:00",
      ),
    );
  // Funcionário 5: visto pela primeira vez já em Stage 3 (só aviso)
  if (n >= 5) l.push(linha("5511900000005", "5521900000106", "Stage 3 Agent", "09:08:00"));
  return l.sort(
    (a, b) =>
      ((Number(a.callbackNumber.slice(-3)) * 7 + n) % 11) -
      ((Number(b.callbackNumber.slice(-3)) * 7 + n) % 11),
  );
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
