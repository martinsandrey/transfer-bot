import { formaDoValor } from "./anonimizador.js";

/** Descreve a estrutura (chaves e tipos) de um JSON, sem nenhum valor. */
export function formaJson(valor: unknown, profundidade = 0): unknown {
  if (profundidade > 6) return "…";
  if (valor === null) return "null";
  if (Array.isArray(valor)) {
    return {
      __array: valor.length,
      item: valor.length ? formaJson(valor[0], profundidade + 1) : "vazio",
    };
  }
  switch (typeof valor) {
    case "string":
      return `string:${formaDoValor(valor, 24)}`;
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "object": {
      const saida: Record<string, unknown> = {};
      let n = 0;
      for (const [k, v] of Object.entries(valor as Record<string, unknown>)) {
        if (++n > 60) {
          saida["…"] = "mais chaves omitidas";
          break;
        }
        const chave = /\d{4,}/.test(k) ? "<CHAVE_NUMERICA>" : k.slice(0, 60);
        saida[chave] = formaJson(v, profundidade + 1);
      }
      return saida;
    }
    default:
      return typeof valor;
  }
}

/** Troca segmentos que parecem identificadores por marcadores genéricos. */
export function padraoCaminho(caminho: string): string {
  return caminho
    .split("/")
    .map((seg) => {
      if (/^\d{4,}$/.test(seg)) return ":num";
      if (/^[0-9a-f]{12,}$/i.test(seg) || /^[0-9a-f-]{32,}$/i.test(seg)) return ":id";
      if (/\d{4,}/.test(seg) || seg.includes("@")) return ":var";
      return seg;
    })
    .join("/");
}
