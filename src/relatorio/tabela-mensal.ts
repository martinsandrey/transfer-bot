/**
 * Tabela simples do mês (pedido do usuário, 2026-10-30): uma linha por funcionário, identificado só pelos 2 últimos números do
 * número da linha 1, e uma coluna por dia do mês com quantas transferências concluídas ele fez naquele dia; última linha (`總計`) com
 * o total de cada dia. A página monta com isso uma planilha .xlsx (colunas de verdade, em qualquer idioma do Excel; o CSV separado
 * por ";" não abriu em colunas no Excel do usuário). Cabeçalhos em chinês ("編號" e "總計"), como no modelo do usuário.
 *
 * Esta função é copiada para dentro da página do relatório (`Function.toString`), então NÃO pode usar nada de fora dela.
 *
 * - `ligacoes`: no formato compacto da página (`t` instante em ms, `f` funcionário, `r` "a" atendida/"c" callback, `rm` desconsiderada,
 *   `s` sem a transferência no registro). Só conta a transferência concluída (sem callback) que vale (a última do cliente no dia).
 * - `mes`: `AAAA-MM`; o dia de cada transferência vem do fuso `fuso`.
 */
export function montarTabelaMensal(
  ligacoes: ReadonlyArray<{ t: number; f: string; r: string; rm?: unknown; s?: number }>,
  mes: string,
  fuso: string,
): { dias: number; linhas: Array<{ chave: string; contagem: number[] }>; totais: number[] } {
  const [ano, mesNum] = mes.split("-").map(Number) as [number, number];
  const dias = new Date(Date.UTC(ano, mesNum, 0)).getUTCDate();
  const porChave = new Map<string, number[]>();
  for (const c of ligacoes) {
    if (c.r !== "a" || c.rm || c.s) continue;
    const dia = new Date(c.t).toLocaleDateString("sv-SE", { timeZone: fuso }); // AAAA-MM-DD
    if (dia.slice(0, 7) !== mes) continue;
    const numero = String(c.f).replace(/\D+/g, "");
    const chave = numero === "" ? "?" : numero.slice(-2).padStart(2, "0");
    const contagem = porChave.get(chave) ?? new Array<number>(dias).fill(0);
    const i = Number(dia.slice(8, 10)) - 1;
    contagem[i] = (contagem[i] ?? 0) + 1;
    porChave.set(chave, contagem);
  }
  const totais = new Array<number>(dias).fill(0);
  const linhas = [...porChave.keys()].sort().map((chave) => {
    const contagem = porChave.get(chave) as number[];
    contagem.forEach((n, i) => (totais[i] = (totais[i] ?? 0) + n));
    return { chave, contagem };
  });
  return { dias, linhas, totais };
}
