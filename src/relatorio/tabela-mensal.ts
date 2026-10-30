/**
 * Tabela simples do mês (pedido do usuário, 2026-10-30): uma linha por funcionário, identificado só pelos 2 últimos números do
 * número da linha 1, e uma coluna por dia do mês com quantas transferências concluídas ele fez naquele dia; última linha (`總計`) com
 * o total de cada dia. A página monta com isso uma planilha .xlsx (colunas de verdade, em qualquer idioma do Excel; o CSV separado
 * por ";" não abriu em colunas no Excel do usuário). Cabeçalhos em chinês ("編號" e "總計"), como no modelo do usuário.
 *
 * Também separa cada dia em "antes de 12:00" e "depois de 12:00" (horário do fuso; 12:00 em ponto já é depois), para a segunda planilha,
 * que mostra os dois valores com barra ("1/2").
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
): {
  dias: number;
  linhas: Array<{ chave: string; contagem: number[]; antes: number[]; depois: number[] }>;
  totais: number[];
  totaisAntes: number[];
  totaisDepois: number[];
} {
  const [ano, mesNum] = mes.split("-").map(Number) as [number, number];
  const dias = new Date(Date.UTC(ano, mesNum, 0)).getUTCDate();
  const porChave = new Map<string, { antes: number[]; depois: number[] }>();
  for (const c of ligacoes) {
    if (c.r !== "a" || c.rm || c.s) continue;
    const dia = new Date(c.t).toLocaleDateString("sv-SE", { timeZone: fuso }); // AAAA-MM-DD
    if (dia.slice(0, 7) !== mes) continue;
    const numero = String(c.f).replace(/\D+/g, "");
    const chave = numero === "" ? "?" : numero.slice(-2).padStart(2, "0");
    const turnos = porChave.get(chave) ?? {
      antes: new Array<number>(dias).fill(0),
      depois: new Array<number>(dias).fill(0),
    };
    const i = Number(dia.slice(8, 10)) - 1;
    const hora = Number(
      new Date(c.t).toLocaleString("en-GB", { timeZone: fuso, hour: "2-digit", hourCycle: "h23" }),
    );
    const turno = hora < 12 ? turnos.antes : turnos.depois;
    turno[i] = (turno[i] ?? 0) + 1;
    porChave.set(chave, turnos);
  }
  const totaisAntes = new Array<number>(dias).fill(0);
  const totaisDepois = new Array<number>(dias).fill(0);
  const linhas = [...porChave.keys()].sort().map((chave) => {
    const { antes, depois } = porChave.get(chave) as { antes: number[]; depois: number[] };
    antes.forEach((n, i) => (totaisAntes[i] = (totaisAntes[i] ?? 0) + n));
    depois.forEach((n, i) => (totaisDepois[i] = (totaisDepois[i] ?? 0) + n));
    return { chave, contagem: antes.map((n, i) => n + (depois[i] ?? 0)), antes, depois };
  });
  const totais = totaisAntes.map((n, i) => n + (totaisDepois[i] ?? 0));
  return { dias, linhas, totais, totaisAntes, totaisDepois };
}
