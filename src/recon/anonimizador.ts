import { mascararTexto } from "../util/mascara.js";

/** Cabeçalhos informados pelo usuário (normalizados) e a política aplicada a cada coluna. */
export type PoliticaColuna =
  "funcionario" | "cliente" | "status" | "inicio" | "duracao" | "generica";

export function normalizarCabecalho(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

export function politicaDaColuna(cabecalho: string): PoliticaColuna {
  switch (normalizarCabecalho(cabecalho)) {
    case "callback number":
      return "funcionario";
    case "callee number":
      return "cliente";
    case "call status":
      return "status";
    case "start time":
      return "inicio";
    case "call duration":
      return "duracao";
    default:
      return "generica";
  }
}

/** Troca dígitos por 9, letras por a/A; preserva pontuação e espaços (mostra o formato, não o conteúdo). */
export function formaDoValor(valor: string, limite = 48): string {
  return valor
    .slice(0, limite)
    .replace(/\d/g, "9")
    .replace(/\p{Ll}/gu, "a")
    .replace(/\p{Lu}/gu, "A");
}

/**
 * Substitui valores por marcadores estáveis (o mesmo valor → o mesmo marcador durante toda a execução),
 * o que preserva "igual/diferente" sem revelar o conteúdo.
 */
export class Anonimizador {
  private readonly mapas = new Map<string, Map<string, string>>();
  private readonly formatos = new Map<string, Set<string>>();

  /** `sensiveis`: textos que nunca podem aparecer na saída (ex.: o usuário de login). */
  constructor(private readonly sensiveis: string[] = []) {}

  marcador(prefixo: string, valor: string): string {
    let mapa = this.mapas.get(prefixo);
    if (!mapa) {
      mapa = new Map();
      this.mapas.set(prefixo, mapa);
    }
    let m = mapa.get(valor);
    if (!m) {
      m = `${prefixo}_${String(mapa.size + 1).padStart(2, "0")}`;
      mapa.set(valor, m);
    }
    return m;
  }

  registrarFormato(categoria: string, forma: string): void {
    let s = this.formatos.get(categoria);
    if (!s) {
      s = new Set();
      this.formatos.set(categoria, s);
    }
    if (s.size < 20) s.add(forma);
  }

  /** Texto livre de interface (rótulos, menus): remove sensíveis conhecidos e mascara telefone/CPF/e-mail. */
  limparTexto(texto: string): string {
    let t = texto;
    for (const s of this.sensiveis) {
      if (s.length >= 2) t = t.split(s).join("<USUARIO>");
    }
    return mascararTexto(t);
  }

  /** Atributos HTML: números longos viram marcador estável por nome do atributo; resto passa limpo. */
  limparAtributo(nome: string, valor: string): string {
    const v = valor.slice(0, 120);
    if (/\d{4,}/.test(v) || /@/.test(v)) {
      return v
        .replace(/\d{4,}/g, (n) => `<${this.marcador(`ATTR_${nome}`, n)}>`)
        .replace(/\S+@\S+/g, "<EMAIL>");
    }
    return this.limparTexto(v);
  }

  /** Valor de célula conforme a política da coluna. */
  celula(politica: PoliticaColuna, indiceColuna: number, texto: string): string {
    const t = texto.trim();
    if (t === "") return "";
    switch (politica) {
      case "funcionario":
        this.registrarFormato("Callback Number", formaDoValor(t));
        return this.marcador("FUNC", t);
      case "cliente":
        this.registrarFormato("Callee Number", formaDoValor(t));
        return this.marcador("CLIENTE", t);
      case "inicio":
        this.registrarFormato("Start Time", formaDoValor(t));
        return this.marcador("INICIO", t);
      case "status":
        return this.limparTexto(t); // valores de status não são pessoais e são o objeto do estudo
      case "duracao":
        this.registrarFormato("Call Duration", formaDoValor(t));
        return this.limparTexto(t);
      case "generica":
        this.registrarFormato(`coluna ${indiceColuna}`, formaDoValor(t));
        return this.marcador(`COL${indiceColuna}`, t);
    }
  }

  /** Relatório para o LEIAME-REVISAO: contagens e formatos, nunca os valores. */
  estatisticas(): { marcadores: Record<string, number>; formatos: Record<string, string[]> } {
    const marcadores: Record<string, number> = {};
    for (const [k, v] of this.mapas) marcadores[k] = v.size;
    const formatos: Record<string, string[]> = {};
    for (const [k, v] of this.formatos) formatos[k] = [...v];
    return { marcadores, formatos };
  }
}
