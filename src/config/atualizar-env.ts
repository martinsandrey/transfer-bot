import { parseEnv } from "node:util";

const nomes = (texto: string): Set<string> =>
  new Set(Object.keys(parseEnv(texto.replace(/^\uFEFF/, ""))));

/**
 * Acrescenta ao `.env` as variáveis do `.env.example` que ele ainda não tem (com o comentário que as explica e o valor padrão).
 * Nunca altera nem remove nada do que já existe: os valores do usuário ficam exatamente como estão.
 */
export function acrescentarFaltantes(
  textoEnv: string,
  textoExemplo: string,
): { texto: string; adicionadas: string[] } {
  const tem = nomes(textoEnv);
  const linhas = textoExemplo.replace(/^\uFEFF/, "").split(/\r?\n/);
  const blocos: string[] = [];
  const adicionadas: string[] = [];
  linhas.forEach((linha, i) => {
    const m = /^([A-Za-z_][A-Za-z0-9_]*)=/.exec(linha);
    if (!m || tem.has(m[1] as string)) return;
    const comentarios: string[] = [];
    for (let j = i - 1; j >= 0 && /^\s*#/.test(linhas[j] as string); j--)
      comentarios.unshift(linhas[j] as string);
    blocos.push([...comentarios, linha].join("\n"));
    adicionadas.push(m[1] as string);
  });
  if (blocos.length === 0) return { texto: textoEnv, adicionadas };
  const crlf =
    textoEnv.includes("\r\n") || (!textoEnv.includes("\n") && textoExemplo.includes("\r\n"));
  const quebra = crlf ? "\r\n" : "\n";
  const base = textoEnv === "" || /\r?\n$/.test(textoEnv) ? textoEnv : textoEnv + quebra;
  const adicao =
    `${quebra}# --- Variáveis novas, acrescentadas automaticamente pelo atualizar.bat (valor padrão; ajuste se quiser) ---${quebra}` +
    blocos
      .join(quebra + quebra)
      .split("\n")
      .join(quebra) +
    quebra;
  return { texto: base + adicao, adicionadas };
}
