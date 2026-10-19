import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseEnv } from "node:util";
import { paginaHtml } from "./pagina.js";
import {
  ARQUIVOS_DO_RELATORIO,
  ARQUIVO_DURACOES,
  lerDuracoes,
  lerRegistro,
  montarLigacoes,
  NOMES_DE_PERIODO,
  periodoPorDatas,
  type Entrada,
} from "./relatorio.js";

const AJUDA = `
Uso: relatorio.bat [periodo]
  Abre uma página no navegador com o relatório. Os filtros (hoje, ontem, semana, 7 dias, mês, tudo, datas) ficam na própria página.
  O argumento só escolhe o filtro que já vem marcado ao abrir:
  hoje | ontem | semana | 7dias | mes | tudo | de=AAAA-MM-DD [ate=AAAA-MM-DD]
  --nao-abrir   só grava o arquivo, sem abrir o navegador
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

function abrirNoNavegador(arquivo: string): void {
  try {
    const [cmd, args]: [string, string[]] =
      process.platform === "win32"
        ? ["cmd", ["/c", "start", "", arquivo]]
        : process.platform === "darwin"
          ? ["open", [arquivo]]
          : ["xdg-open", [arquivo]];
    const filho = spawn(cmd, args, { detached: true, stdio: "ignore", windowsHide: true });
    filho.on("error", () => undefined);
    filho.unref();
  } catch {
    /* o arquivo continua gravado; o caminho é mostrado abaixo */
  }
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
  const naoAbrir = args.includes("--nao-abrir");
  const resto = args
    .filter((a) => a !== "--nao-abrir")
    .map((a) => a.toLowerCase().replace(/^-+/, ""));
  const valorDe = (nome: string): string | undefined =>
    resto.find((a) => a.startsWith(`${nome}=`))?.split("=")[1];
  let inicial: { periodo: string; de?: string; ate?: string } = { periodo: "hoje" };
  const de = valorDe("de");
  if (de !== undefined) {
    const ate = valorDe("ate");
    if (!periodoPorDatas(de, ate)) {
      console.error(
        '\nData inválida. Use o formato AAAA-MM-DD, ex.: de=2026-10-01 ate=2026-10-19 ("ate" não pode ser antes de "de").\n',
      );
      process.exitCode = 1;
      return;
    }
    inicial = { periodo: "personalizado", de, ...(ate !== undefined ? { ate } : {}) };
  } else if (resto[0] !== undefined) {
    if (!(NOMES_DE_PERIODO as readonly string[]).includes(resto[0])) {
      console.error(`\nPeríodo "${resto[0]}" desconhecido.${AJUDA}`);
      process.exitCode = 1;
      return;
    }
    inicial = { periodo: resto[0] };
  }

  const pasta = pastaDeRegistros();
  const entradas: Entrada[] = [];
  let achou = false;
  for (const { arquivo, padrao } of ARQUIVOS_DO_RELATORIO) {
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
  const arquivoDuracoes = join(pasta, ARQUIVO_DURACOES);
  const duracoes = existsSync(arquivoDuracoes)
    ? lerDuracoes(readFileSync(arquivoDuracoes, "utf8"))
    : new Map<string, number>();
  const { ligacoes, longas } = montarLigacoes(entradas, duracoes);
  const dir = join(pasta, "relatorios");
  mkdirSync(dir, { recursive: true });
  const arquivo = join(dir, "relatorio.html");
  writeFileSync(arquivo, paginaHtml({ geradoEm: new Date(), ligacoes, longas, inicial }), "utf8");
  console.log(`\nRelatório gerado: ${arquivo}`);
  if (naoAbrir) return;
  console.log("Abrindo no navegador...\n");
  abrirNoNavegador(arquivo);
}

principal();
