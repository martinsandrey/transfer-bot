import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { stdin, stdout } from "node:process";
import {
  carregarConfig,
  ErroDeConfiguracao,
  validarConfig,
  type AppConfig,
} from "./config/config.js";
import type { MessageSender } from "./dominio/tipos.js";
import { TaskQueue } from "./fila/task-queue.js";
import { LeitorTabelaHtml } from "./leitura/leitor-tabela.js";
import { criarLogger } from "./log/logger.js";
import { GerenciadorLogin, type AdaptadorLogin } from "./login/login-manager.js";
import { criarConstrutor, ErroDeModelo } from "./mensagem/construtor.js";
import { EnviadorConsole } from "./mensagem/enviadores.js";
import { CallTracker } from "./monitor/call-tracker.js";
import { Monitor } from "./monitor/monitor.js";
import { iniciarNavegador } from "./navegador/navegador.js";
import { criarNotificador } from "./notificador/notificador.js";
import { BuscaSemCadastro } from "./consulta/sem-cadastro.js";
import { BuscaSimulada, LeitorSimulado } from "./simulacao/cenario.js";

const simulado = process.argv.includes("--simular");

function ajuda(): void {
  console.log(`
Comandos durante a execução (digite e Enter):
  status    mostra quantas chamadas estão sendo acompanhadas
  sair      encerra (ou Ctrl+C)
`);
}

async function principal(): Promise<void> {
  let cfg: AppConfig;
  try {
    cfg = simulado
      ? validarConfig({ SITE_URL: "http://simulado.invalid/", INTERVALO_LEITURA_MS: "500" })
      : carregarConfig();
  } catch (e) {
    if (e instanceof ErroDeConfiguracao) {
      console.error(`\n${e.message}\n`);
      process.exitCode = 1;
      return;
    }
    throw e;
  }

  let construtor;
  try {
    construtor = criarConstrutor(readFileSync(cfg.arquivoMensagem, "utf8"));
  } catch (e) {
    console.error(
      e instanceof ErroDeModelo
        ? `\n${e.message}\n`
        : `\nNão consegui ler o modelo "${cfg.arquivoMensagem}".\n`,
    );
    process.exitCode = 1;
    return;
  }

  if (cfg.modo === "live") {
    console.error(
      "\nSEND_MODE=live ainda não pode ser usado: o envio ao Telegram não foi implementado (Fase 5).\nUse SEND_MODE=observacao.\n",
    );
    process.exitCode = 1;
    return;
  }

  // No modo real o console mostra só o essencial (avisos em português + mensagens preparadas); o detalhe vai para o arquivo de log.
  const log = criarLogger({
    pastaLogs: cfg.pastas.logs,
    nivel: cfg.nivelLog,
    ...(simulado ? {} : { nivelConsole: "error" as const }),
  });
  const notificador = criarNotificador();
  const sinal = new AbortController();
  const rl = createInterface({ input: stdin, output: stdout });
  const encerrar = (): void => {
    if (!sinal.signal.aborted) {
      console.log("\nEncerrando...");
      sinal.abort();
    }
  };
  process.on("SIGINT", encerrar);
  rl.on("SIGINT", encerrar);

  const tracker = new CallTracker({
    leiturasConfirmacao: cfg.monitor.leiturasConfirmacao,
    ausenciaMaxLeituras: cfg.monitor.ausenciaMaxLeituras,
    ttlOcorrenciasMs: cfg.monitor.ttlOcorrenciasMin * 60_000,
    janelaTransferenciaMs: cfg.monitor.janelaTransferenciaMs,
  });
  const opMonitor = {
    intervaloMs: cfg.monitor.intervaloMs,
    invalidasParaAlertar: 10,
    falhasParaAlertar: 5,
    limpezaMs: 60_000,
  };

  console.log(
    `\nModo: ${cfg.modo === "observacao" ? "OBSERVAÇÃO (nada é enviado)" : "ENVIO REAL"}${simulado ? " — SIMULAÇÃO com dados fictícios" : ""}`,
  );

  if (simulado) {
    const sender: MessageSender = new EnviadorConsole();
    const fila = new TaskQueue(
      { lookup: new BuscaSimulada(), construtor, sender, log, notificador },
      {
        modo: "observacao",
        maxTentativasConsulta: 2,
        maxTentativasEnvio: 2,
        backoffMs: 200,
        ttlTarefasMs: 3_600_000,
        previa: (t) =>
          console.log(`----- PRÉVIA (não enviada) -----\n${t}\n--------------------------------`),
      },
    );
    const monitor = new Monitor(
      { reader: new LeitorSimulado(), tracker, fila, log, notificador },
      opMonitor,
    );
    console.log("Cenário fictício rodando por ~20 leituras. Ctrl+C para parar antes.\n");
    setTimeout(encerrar, 20 * cfg.monitor.intervaloMs + 3000);
    await monitor.executar(sinal.signal);
    await fila.drenar();
    console.log("\nResumo das tarefas:", fila.todas.map((t) => `${t.id}=${t.estado}`).join(", "));
    rl.close();
    return;
  }

  // ---- modo real (parcial): detecção de transferências; consulta ao cliente e Telegram ainda não existem ----
  console.log(
    "ATENÇÃO: a consulta ao cadastro do cliente e o envio ao Telegram ainda não existem. Ao detectar uma transferência, o programa mostra aqui a mensagem preparada (só com o telefone do cliente e o Callback Number; NAME, CPF, Location e Age ficam em branco) e NÃO envia nada.",
  );
  if (cfg.site.loginAutomatico) {
    console.log(
      "Aviso: o login automático ainda não está disponível (depende da evidência do site). O login será manual.",
    );
  }
  const host = await iniciarNavegador(cfg);
  host.contexto.on("close", encerrar);
  const leitor = new LeitorTabelaHtml(host.paginaPrincipal(), {
    tolerarSemTabela: Math.max(3, Math.ceil(5000 / cfg.monitor.intervaloMs)),
  });
  const adaptador: AdaptadorLogin = {
    detectar: async () => ((await leitor.tabelaPresente()) ? "logado" : "nao_logado"),
    preencherEEnviar: () => Promise.reject(new Error("login automático indisponível")),
  };
  const login = new GerenciadorLogin(
    adaptador,
    {
      loginAutomatico: false,
      usuario: undefined,
      senha: undefined,
      esperaAposEnvioMs: 0,
      intervaloVerificacaoMs: 1000,
      intervaloAvisoMs: 30_000,
    },
    log,
    notificador,
  );
  const garantir = async (): Promise<void> => {
    console.log(
      "Faça o login na janela do navegador e abra a tela com a tabela de chamadas. Aguardando a tabela aparecer...",
    );
    await login.garantirLogin(sinal.signal);
    console.log("Tabela encontrada.");
  };

  try {
    await host
      .abrirUrl(cfg.site.url)
      .catch(() => console.warn("Não consegui abrir o endereço configurado em SITE_URL."));
    await garantir();
    ajuda();
    const fila = new TaskQueue(
      {
        lookup: new BuscaSemCadastro(),
        construtor,
        sender: new EnviadorConsole(),
        log,
        notificador,
      },
      {
        modo: "observacao",
        maxTentativasConsulta: 1,
        maxTentativasEnvio: 1,
        backoffMs: 200,
        ttlTarefasMs: 3_600_000,
        previa: (t) => {
          const hora = new Date().toLocaleTimeString("pt-BR", { hour12: false });
          console.log(
            `
===== TRANSFERÊNCIA DETECTADA ${hora} — mensagem preparada =====
${t}
===== NÃO ENVIADA (Telegram não conectado; NAME/CPF/Location/Age em branco: cadastro ainda não consultado) =====
`,
          );
        },
      },
    );
    const monitor = new Monitor(
      { reader: leitor, tracker, fila, log, notificador, aoPerderSessao: garantir },
      opMonitor,
    );
    rl.on("line", (l) => {
      if (l.trim().toLowerCase() === "sair") encerrar();
      else if (l.trim().toLowerCase() === "status")
        console.log("Ocorrências acompanhadas:", tracker.ocorrenciasAtivas);
    });
    await monitor.executar(sinal.signal);
  } catch (e) {
    if (!sinal.signal.aborted) console.error("Erro:", e instanceof Error ? e.message : e);
  } finally {
    rl.close();
    await host.encerrar();
  }
}

principal().catch((e: unknown) => {
  console.error("Erro inesperado:", e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
