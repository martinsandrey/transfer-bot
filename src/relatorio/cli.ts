import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseEnv } from "node:util";
import {
  ARQUIVOS_DO_RELATORIO,
  formatarCsv,
  formatarTabela,
  lerRegistro,
  periodoNomeado,
  periodoPorDatas,
  resumir,
  type Entrada,
  type Periodo,
} from "./relatorio.js";

const AJUDA = `
Uso: relatorio.bat [periodo] [opções]
  hoje | ontem | semana (desde segunda) | 7dias | mes (desde o dia 1) | tudo
  de=AAAA-MM-DD [ate=AAAA-MM-DD]   intervalo de datas (inclusive); só "de" = um dia
  observacao                       inclui também o que foi só prévia (modo observação, nada enviado)
Sem argumentos o padrão é "hoje". Cada execução também grava um .csv (abre no Excel) na pasta "relatorios" dentro de PASTA_REGISTROS.
`;

function pastaDeRegistros(): string {
  let pasta = "registros";
  try {
    if (existsSync(".env")) {
      const env = parseEnv(readFileSync(".env", "utf8").replace(/^\uFEFF/, ""));
      const v = (env["PASTA_REGISTROS"] ?? "").trim();
      if (v) pasta = v;
    }
  } catch {
    /* usa o padrão */
  }
  return resolve(pasta);
}

function principal(): void {
  const args = process.argv
    .slice(2)
    .map((a) => a.trim())
    .filter((a) => a !== "");
  if (args.some((a) => ["-h", "--help", "ajuda"].includes(a.toLowerCase()))) {
    console.log(AJUDA);
    return;
  }
  const incluirObservacao = args.some((a) => a.toLowerCase().replace(/^-+/, "") === "observacao");
  const resto = args.filter((a) => a.toLowerCase().replace(/^-+/, "") !== "observacao");
  const valorDe = (nome: string): string | undefined =>
    resto.find((a) => a.toLowerCase().replace(/^-+/, "").startsWith(`${nome}=`))?.split("=")[1];
  let periodo: Periodo | null;
  const de = valorDe("de");
  if (de !== undefined) {
    periodo = periodoPorDatas(de, valorDe("ate"));
    if (!periodo) {
      console.error(
        '\nData inválida. Use o formato AAAA-MM-DD, ex.: de=2026-10-01 ate=2026-10-19 ("ate" não pode ser antes de "de").\n',
      );
      process.exitCode = 1;
      return;
    }
  } else {
    const nome = (resto[0] ?? "hoje").toLowerCase().replace(/^-+/, "");
    periodo = periodoNomeado(nome, new Date());
    if (!periodo) {
      console.error(`\nPeríodo "${resto[0]}" desconhecido.${AJUDA}`);
      process.exitCode = 1;
      return;
    }
  }

  const pasta = pastaDeRegistros();
  const entradas: Entrada[] = [];
  let achou = false;
  for (const { arquivo, padrao } of new Map(
    ARQUIVOS_DO_RELATORIO.map((x) => [x.arquivo + x.padrao, x]),
  ).values()) {
    const caminho = join(pasta, arquivo);
    if (!existsSync(caminho)) continue;
    achou = true;
    entradas.push(...lerRegistro(readFileSync(caminho, "utf8"), padrao));
  }
  if (!achou) {
    console.log(
      `\nNenhum registro encontrado em "${pasta}". O programa grava os registros enquanto roda (REGISTRAR_MENSAGENS=true).\n`,
    );
    return;
  }
  const linhas = resumir(entradas, periodo, incluirObservacao);
  console.log(`\n${formatarTabela(linhas, periodo)}\n`);
  if (!incluirObservacao)
    console.log(
      "(Só mensagens realmente enviadas. Para incluir as prévias do modo observação: observacao)",
    );
  try {
    const dir = join(pasta, "relatorios");
    mkdirSync(dir, { recursive: true });
    const nome = `relatorio-${new Date().toISOString().slice(0, 10)}-${periodo.rotulo
      .normalize("NFD")
      .replace(/[^A-Za-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")}.csv`;
    writeFileSync(join(dir, nome), formatarCsv(linhas), "utf8");
    console.log(`Planilha salva em: ${join(dir, nome)}\n`);
  } catch {
    console.log("Não consegui salvar a planilha (.csv); a tabela acima continua valendo.\n");
  }
}

principal();
