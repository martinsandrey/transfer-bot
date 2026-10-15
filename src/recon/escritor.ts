import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pareceTerPii } from "../util/mascara.js";
import type { Anonimizador } from "./anonimizador.js";

export interface Suspeita {
  arquivo: string;
  linha: number;
  motivo: string;
}

/** Sequências feitas só de 9 (formato de telefone/data) não são dados reais. */
const SO_NOVES = /[+(]?9[9\s().:/-]{6,}9/g;

/** Varre o texto procurando algo que pareça dado pessoal ou os textos sensíveis informados. */
export function varrerTexto(arquivo: string, texto: string, sensiveis: string[]): Suspeita[] {
  const achados: Suspeita[] = [];
  texto.split(/\r?\n/).forEach((linha, i) => {
    const semFormas = linha.replace(SO_NOVES, "");
    if (pareceTerPii(semFormas))
      achados.push({ arquivo, linha: i + 1, motivo: "parece telefone, CPF ou e-mail" });
    for (const s of sensiveis) {
      if (s.length >= 2 && linha.includes(s))
        achados.push({ arquivo, linha: i + 1, motivo: "contém texto sensível configurado" });
    }
  });
  return achados;
}

export class EscritorSaida {
  readonly pasta: string;
  private contador = 0;
  private readonly arquivos: string[] = [];

  constructor(pastaBase: string, agora: Date = new Date()) {
    const carimbo = agora.toISOString().replace(/[:.]/g, "-").slice(0, 19);
    this.pasta = join(pastaBase, carimbo);
    mkdirSync(this.pasta, { recursive: true });
  }

  gravar(nome: string, conteudo: unknown): string {
    const arquivo = `${String(++this.contador).padStart(2, "0")}-${nome}.json`;
    writeFileSync(join(this.pasta, arquivo), JSON.stringify(conteudo, null, 2), "utf8");
    this.arquivos.push(arquivo);
    return arquivo;
  }

  /** Gera LEIAME-REVISAO.txt (contagens e suspeitas, nunca valores) e devolve as suspeitas. */
  finalizar(anon: Anonimizador, sensiveis: string[]): Suspeita[] {
    const suspeitas: Suspeita[] = [];
    for (const f of readdirSync(this.pasta).filter((n) => n.endsWith(".json"))) {
      suspeitas.push(...varrerTexto(f, readFileSync(join(this.pasta, f), "utf8"), sensiveis));
    }
    const est = anon.estatisticas();
    const linhas = [
      "REVISÃO OBRIGATÓRIA ANTES DE ENVIAR — este arquivo não contém dados pessoais, apenas contagens.",
      "",
      "Arquivos gerados:",
      ...this.arquivos.map((a) => `  - ${a}`),
      "",
      "Valores substituídos por marcadores (categoria: quantidade de valores distintos):",
      ...Object.entries(est.marcadores).map(([k, v]) => `  - ${k}: ${v}`),
      "",
      "Formatos observados (letras viram a/A, dígitos viram 9):",
      ...Object.entries(est.formatos).flatMap(([k, v]) => [`  ${k}:`, ...v.map((x) => `    ${x}`)]),
      "",
      suspeitas.length === 0
        ? "Varredura automática: nada suspeito encontrado (isso NÃO dispensa a sua revisão)."
        : `ATENÇÃO — varredura automática encontrou ${suspeitas.length} trecho(s) suspeito(s):`,
      ...suspeitas.map((s) => `  - ${s.arquivo}, linha ${s.linha}: ${s.motivo}`),
      "",
      "O que revisar manualmente:",
      "  1. Procure nomes de pessoas, cidades, e-mails e o nome do usuário logado em menus, títulos e rótulos.",
      "  2. Procure números longos, tokens e textos que não sejam marcadores (FUNC_01, CLIENTE_01, INICIO_01, COLn_01...).",
      "  3. Se encontrar algo, apague ou troque por <REMOVIDO> antes de enviar.",
    ];
    writeFileSync(join(this.pasta, "LEIAME-REVISAO.txt"), linhas.join("\r\n"), "utf8");
    return suspeitas;
  }
}
