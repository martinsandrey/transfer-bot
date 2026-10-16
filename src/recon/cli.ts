import { createInterface } from "node:readline";
import { stdin, stdout } from "node:process";
import type { Page } from "playwright";
import { carregarConfig, ErroDeConfiguracao } from "../config/config.js";
import { iniciarNavegador } from "../navegador/navegador.js";
import { Anonimizador } from "./anonimizador.js";
import {
  amostrarAbas,
  analisarSerie,
  capturarPagina,
  capturarSerie,
  diagnosticarPagina,
  type TipoCaptura,
} from "./captura.js";
import { EscritorSaida } from "./escritor.js";
import { ObservadorRede } from "./rede.js";

const AJUDA = `
Comandos (digite e aperte Enter). Em cada um, ANTES de digitar, deixe a tela do navegador no estado indicado:
  login      tela de login (ainda SEM logar)
  tabela     tela da tabela de chamadas (já logado); grava estrutura + uma série de leituras ao longo do tempo
  menu       qualquer tela com o menu lateral visível
  clientes   tela Customer Data List (antes de pesquisar)
  resultado  Customer Data List depois de pesquisar (tente com 1 resultado; repita com 0 e com vários)
  edicao     tela de edição de um cliente (NÃO clique em salvar; apenas abra e olhe)
  abas       acompanha as abas por alguns segundos (teste de 2ª aba e de janela minimizada)
  diagnostico  use se o comando 'tabela' não achar a tabela: mostra ONDE ela está (frames, ancestrais), sem dados
  rede       grava o resumo do tráfego de rede observado até agora
  ajuda      mostra esta lista
  sair       grava o resumo, a revisão e fecha
O programa só LÊ a tela. Ele nunca clica, digita nem salva nada.
`;

async function escolherPagina(
  paginas: Page[],
  pergunta: (t: string) => Promise<string>,
): Promise<Page | null> {
  if (paginas.length === 0) return null;
  if (paginas.length === 1) return paginas[0] ?? null;
  console.log("Abas abertas:");
  for (const [i, p] of paginas.entries())
    console.log(`  ${i + 1}) ${new URL(p.url(), "http://x").pathname}`);
  const r = Number((await pergunta("Qual aba (número)? ")).trim());
  return paginas[r - 1] ?? null;
}

async function principal(): Promise<void> {
  let cfg;
  try {
    cfg = carregarConfig();
  } catch (e) {
    if (e instanceof ErroDeConfiguracao) {
      console.error(`\n${e.message}\n`);
      process.exitCode = 1;
      return;
    }
    throw e;
  }

  const sensiveis = [cfg.site.usuario].filter((s): s is string => !!s);
  const anon = new Anonimizador(sensiveis);
  const saida = new EscritorSaida("saida-reconhecimento");
  const rl = createInterface({ input: stdin, output: stdout });
  // Fila de linhas: o que for digitado enquanto o navegador abre não se perde.
  const fila: string[] = [];
  const esperando: Array<(linha: string) => void> = [];
  rl.on("line", (l) => {
    const quem = esperando.shift();
    if (quem) quem(l);
    else fila.push(l);
  });
  rl.on("close", () => {
    for (const quem of esperando.splice(0)) quem("sair");
  });
  const perguntar = (t: string): Promise<string> => {
    stdout.write(t);
    const pronta = fila.shift();
    return pronta !== undefined ? Promise.resolve(pronta) : new Promise((r) => esperando.push(r));
  };

  console.log(`\nReconhecimento — a saída será gravada em: ${saida.pasta}`);
  // TB_CHROMIUM_PATH / TB_HEADLESS: usados só para testar na nuvem (Linux); no Windows não são necessários.
  const host = await iniciarNavegador(cfg, {
    ...(process.env["TB_CHROMIUM_PATH"] ? { executablePath: process.env["TB_CHROMIUM_PATH"] } : {}),
    headless: process.env["TB_HEADLESS"] === "1",
    ...(process.env["TB_HEADLESS"] === "1" ? { args: ["--no-sandbox"] } : {}),
  });
  const rede = new ObservadorRede(host.contexto);
  rede.iniciar();
  await host.abrirUrl(cfg.site.url).catch((e: unknown) => {
    console.warn("Não consegui abrir o endereço configurado:", e instanceof Error ? e.message : e);
  });
  console.log(
    "O navegador foi aberto. Faça o login MANUALMENTE quando chegar a hora (a captura 'login' vem antes).",
  );
  console.log(AJUDA);

  let encerrar = false;
  host.contexto.on("close", () => {
    encerrar = true;
    rl.close();
  });

  try {
    while (!encerrar) {
      const cmd = (await perguntar("recon> ")).trim().toLowerCase();
      if (cmd === "") continue;
      if (cmd === "ajuda") {
        console.log(AJUDA);
      } else if (cmd === "sair") {
        break;
      } else if (cmd === "rede") {
        console.log("Gravado:", saida.gravar("rede", rede.resumo()));
      } else if (cmd === "diagnostico") {
        const page = await escolherPagina(host.contexto.pages(), perguntar);
        if (!page) {
          console.log("Nenhuma aba disponível.");
          continue;
        }
        console.log("Gravado:", saida.gravar("diagnostico", await diagnosticarPagina(page, anon)));
      } else if (cmd === "abas") {
        const seg = Number(
          (await perguntar("Quantos segundos acompanhar [120]? ")).trim() || "120",
        );
        console.log(
          "Agora: abra a Customer Data List em uma 2ª aba; depois minimize a janela por ~1 min e volte. Acompanhando...",
        );
        const amostras = await amostrarAbas(() => host.contexto.pages(), seg * 1000);
        console.log("Gravado:", saida.gravar("abas", amostras));
      } else if (["login", "tabela", "menu", "clientes", "resultado", "edicao"].includes(cmd)) {
        const page = await escolherPagina(host.contexto.pages(), perguntar);
        if (!page) {
          console.log("Nenhuma aba disponível.");
          continue;
        }
        const tipo = cmd as TipoCaptura;
        console.log("Gravado:", saida.gravar(tipo, await capturarPagina(page, anon, tipo)));
        if (tipo === "tabela") {
          const seg = Number(
            (await perguntar("Quantos segundos de leituras [60]? ")).trim() || "60",
          );
          console.log(
            `Lendo a tabela a cada 1 s por ${seg} s (deixe o navegador visível, sem mexer)...`,
          );
          const serie = await capturarSerie(page, anon, {
            duracaoMs: seg * 1000,
            intervaloMs: 1000,
            indiceTabela: null,
          });
          console.log("Gravado:", saida.gravar("tabela-serie", serie));
          console.log("Gravado:", saida.gravar("tabela-analise", analisarSerie(serie)));
        }
      } else {
        console.log('Comando desconhecido. Digite "ajuda".');
      }
    }
  } catch (e) {
    console.error("Erro durante o reconhecimento:", e instanceof Error ? e.message : e);
  } finally {
    console.log("Gravado:", saida.gravar("rede", rede.resumo()));
    const suspeitas = saida.finalizar(anon, sensiveis);
    console.log(`\nPronto. Revise a pasta antes de enviar: ${saida.pasta}`);
    console.log(
      suspeitas.length
        ? `ATENÇÃO: a varredura automática achou ${suspeitas.length} trecho(s) suspeito(s). Veja LEIAME-REVISAO.txt.`
        : "Leia LEIAME-REVISAO.txt e revise os arquivos.",
    );
    rl.close();
    await host.encerrar();
  }
}

principal().catch((e: unknown) => {
  console.error("Erro inesperado:", e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
