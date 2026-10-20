import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  ARQUIVO_CALLBACKS_MANUAIS,
  lerCallbacksManuais,
  linhaDeMarcacao,
} from "./callbacks-manuais.js";
import { dadosDasLigacoes, dadosDasLongas, paginaHtml } from "./pagina.js";
import { lerEnv } from "./env.js";
import { iniciarServidor } from "./servidor.js";
import {
  ARQUIVOS_DO_RELATORIO,
  ARQUIVO_DURACOES,
  lerDuracoes,
  lerDuracoesAteTransferencia,
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

Enquanto a janela do relatorio.bat estiver aberta, a página se atualiza sozinha a cada 10 s e permite marcar uma ligação como callback (só no relatório).
`;

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

async function principal(): Promise<void> {
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

  const { pasta, apelidos, equipePaquistanesDigitos, religacao } = lerEnv();
  const ler = (arquivo: string): string | null => {
    const caminho = join(pasta, arquivo);
    return existsSync(caminho) ? readFileSync(caminho, "utf8") : null;
  };
  /** Lê os registros de novo (o bot pode ter gravado ligações novas desde a última vez). */
  const montar = (): ReturnType<typeof montarLigacoes> | null => {
    const entradas: Entrada[] = [];
    let achou = false;
    for (const { arquivo, padrao } of ARQUIVOS_DO_RELATORIO) {
      const texto = ler(arquivo);
      if (texto === null) continue;
      achou = true;
      entradas.push(...lerRegistro(texto, padrao));
    }
    if (!achou) return null;
    return montarLigacoes(
      entradas,
      lerDuracoes(ler(ARQUIVO_DURACOES) ?? ""),
      lerCallbacksManuais(ler(ARQUIVO_CALLBACKS_MANUAIS) ?? ""),
      { religacao, ateTransferencia: lerDuracoesAteTransferencia(ler(ARQUIVO_DURACOES) ?? "") },
    );
  };
  const pagina = (servidor?: { token: string }): string | null => {
    const m = montar();
    return m
      ? paginaHtml({
          geradoEm: new Date(),
          ...m,
          inicial,
          apelidos,
          equipePaquistanesDigitos,
          ...(servidor ? { servidor } : {}),
        })
      : null;
  };

  const html = pagina();
  if (html === null) {
    console.log(
      `\nNenhum registro encontrado em "${pasta}". O programa grava os registros enquanto roda (REGISTRAR_MENSAGENS=true).\n`,
    );
    return;
  }
  const dir = join(pasta, "relatorios");
  mkdirSync(dir, { recursive: true });
  const arquivo = join(dir, "relatorio.html");
  writeFileSync(arquivo, html, "utf8");
  console.log(`\nRelatório gerado: ${arquivo}`);
  if (naoAbrir) return;

  // Servidor local: a página aberta por ele permite marcar callbacks (gravados em callbacks-manuais.txt).
  const token = randomBytes(24).toString("hex");
  const servidor = await iniciarServidor({
    token,
    pagina: () => pagina({ token }) ?? "",
    ligacoes: () => dadosDasLigacoes(montar()?.ligacoes ?? []),
    dados: () => {
      const m = montar();
      return {
        ligacoes: dadosDasLigacoes(m?.ligacoes ?? []),
        longas: dadosDasLongas(m?.longas ?? []),
      };
    },
    marcar: (chave, marcar) => {
      if (!(montar()?.ligacoes ?? []).some((l) => l.chave === chave)) return false;
      mkdirSync(pasta, { recursive: true });
      appendFileSync(
        join(pasta, ARQUIVO_CALLBACKS_MANUAIS),
        linhaDeMarcacao(chave, marcar, new Date()),
        {
          encoding: "utf8",
        },
      );
      console.log(
        `${marcar ? "Marcada como callback" : "Marcação desfeita"} (${new Date().toLocaleTimeString("pt-BR", { hour12: false })}).`,
      );
      return true;
    },
  });
  console.log(
    `Abrindo no navegador...\nSe fechar a aba, abra de novo este endereço: ${servidor.url}\n\nDeixe esta janela aberta enquanto usa o relatório: é ela que grava as ligações marcadas como callback.\nPara terminar, feche esta janela (ou Ctrl+C).\n`,
  );
  abrirNoNavegador(servidor.url);
  const parar = (): void => {
    void servidor.fechar().then(() => process.exit(0));
  };
  process.on("SIGINT", parar);
  process.on("SIGTERM", parar);
}

principal().catch((e: unknown) => {
  console.error(`\nErro no relatório: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exitCode = 1;
});
