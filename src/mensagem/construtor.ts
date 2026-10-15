import type { CustomerRecord } from "../dominio/tipos.js";

/** Placeholders aceitos no modelo (diferenciam maiúsculas/minúsculas, exatamente como em config/mensagem.txt). */
export const PLACEHOLDERS = ["nome", "cpf", "location", "age", "Phone", "callback number"] as const;
export type Placeholder = (typeof PLACEHOLDERS)[number];

export class ErroDeModelo extends Error {
  constructor(public readonly problemas: string[]) {
    super(`Modelo de mensagem inválido:\n - ${problemas.join("\n - ")}`);
    this.name = "ErroDeModelo";
  }
}

const PADRAO = /\{\{([^{}]*)\}\}/g;

/** Valida o texto do modelo e devolve um construtor. Quebras de linha viram "\n"; o texto não é reformatado. */
export function criarConstrutor(textoModelo: string): ConstrutorDeMensagem {
  // Remove BOM e quebras de linha finais (editores costumam acrescentá-las); espaços são preservados.
  const modelo = textoModelo
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .replace(/\n+$/, "");
  const problemas: string[] = [];
  const usados = new Set<string>();
  for (const m of modelo.matchAll(PADRAO)) {
    const nome = m[1] ?? "";
    if ((PLACEHOLDERS as readonly string[]).includes(nome)) usados.add(nome);
    else {
      const dica = (PLACEHOLDERS as readonly string[]).find(
        (p) => p.toLowerCase() === nome.trim().toLowerCase(),
      );
      problemas.push(
        `placeholder desconhecido "{{${nome}}}"${dica ? ` (você quis dizer "{{${dica}}}"? Escreva exatamente assim, sem espaços extras)` : ""}.`,
      );
    }
  }
  for (const p of PLACEHOLDERS)
    if (!usados.has(p)) problemas.push(`placeholder obrigatório ausente: "{{${p}}}".`);
  const semPares = modelo.replace(PADRAO, "");
  if (/\{\{|\}\}/.test(semPares))
    problemas.push('há "{{" ou "}}" sem par; verifique as chaves duplas.');
  if (problemas.length) throw new ErroDeModelo(problemas);
  return new ConstrutorDeMensagem(modelo);
}

export class ConstrutorDeMensagem {
  constructor(private readonly modelo: string) {}

  /**
   * Cópia literal dos valores do cadastro (apenas `trim`). Uma única passada: valores que contenham "{{...}}"
   * não são expandidos novamente.
   */
  build(r: CustomerRecord, callbackNumber: string): string {
    const valores: Record<Placeholder, string> = {
      nome: r.nome.trim(),
      cpf: r.cpf.trim(),
      location: r.location.trim(),
      age: r.age.trim(),
      Phone: r.phone.trim(),
      "callback number": callbackNumber.trim(),
    };
    return this.modelo.replace(PADRAO, (_m, nome: string) => valores[nome as Placeholder]);
  }
}
