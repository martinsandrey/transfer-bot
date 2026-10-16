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
import { AdaptadorLoginDoSite } from "./login/adaptador-site.js";
import { GerenciadorLogin } from "./login/login-manager.js";
import { criarConstrutor, ErroDeModelo } from "./mensagem/construtor.js";
import { EnviadorConsole } from "./mensagem/enviadores.js";
import { CallTracker } from "./monitor/call-tracker.js";
import { Monitor } from "./monitor/monitor.js";
import { ClienteGramJS } from "./telegram/cliente-gramjs.js";
import { EnviadorTelegram } from "./telegram/enviador-telegram.js";
import { iniciarNavegador } from "./navegador/navegador.js";
import { criarNotificador } from "./notificador/notificador.js";
import { ConsultaDeCliente } from "./consulta/consulta-cliente.js";
import {
  instalarBloqueioDeEscrita,
  PaginaClientesPlaywright,
} from "./consulta/pagina-clientes-playwright.js";
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

  if (cfg.modo === "live" && simulado) {
    console.error("\nA simulação nunca envia de verdade. Use SEND_MODE=observacao.\n");
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
    // Diário de status no ARQUIVO de log (sem telefones): mostra o que acontece entre o Stage 1 e o Stage 3.
    aoMudarStatus: (i) =>
      log.info("status", { evento: "status_mudou", idCurto: i.id, de: i.de, para: i.para }),
  });
  const opMonitor = {
    pausarDuranteConsulta: true,
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

  // ---- modo real: detecção + consulta ao cadastro (somente leitura); o Telegram ainda não existe ----
  console.log(
    cfg.modo === "live"
      ? "MODO ENVIO REAL: ao detectar uma transferência, o programa consulta o cliente (só leitura) e ENVIA a mensagem pelo Telegram."
      : "Modo observação: ao detectar uma transferência, o programa consulta o cliente (só leitura), mostra aqui a mensagem preparada e NÃO envia nada.",
  );
  console.log(
    cfg.site.loginAutomatico
      ? "Login automático ligado: se aparecer a verificação (botão para clicar), clique você; o usuário e a senha do .env são preenchidos sozinhos, uma única vez."
      : "Login manual: faça o login na janela do navegador.",
  );
  let sender: MessageSender = new EnviadorConsole();
  let clienteTg: ClienteGramJS | undefined;
  if (cfg.modo === "live") {
    const { apiId, apiHash, destino, timeoutEnvioMs, arquivoSessao } = cfg.telegram;
    const resposta = await new Promise<string>((r) =>
      rl.question(
        `\nENVIO REAL ativado. As mensagens serão enviadas para "${destino}" no Telegram.\nDigite ENVIAR (em maiúsculas) para confirmar, ou qualquer outra coisa para cancelar: `,
        r,
      ),
    );
    if (resposta.trim() !== "ENVIAR") {
      console.log("Cancelado. Nada foi enviado. Para só observar, use SEND_MODE=observacao.");
      rl.close();
      return;
    }
    try {
      clienteTg = await ClienteGramJS.conectar(
        { apiId: apiId as number, apiHash: apiHash as string, arquivoSessao },
        { loginInterativo: false },
      );
    } catch (e) {
      console.error(`\n${e instanceof Error ? e.message : String(e)}\n`);
      process.exitCode = 1;
      rl.close();
      return;
    }
    const telegram = new EnviadorTelegram(clienteTg, {
      destino,
      timeoutEnvioMs,
      esperaMaximaFloodMs: 60_000,
    });
    sender = {
      send: async (texto, chave) => {
        const r = await telegram.send(texto, chave);
        const hora = new Date().toLocaleTimeString("pt-BR", { hour12: false });
        if (r.tipo === "enviada") console.log(`[${hora}] Mensagem enviada ao Telegram.`);
        return r;
      },
      verify: (chave) => telegram.verify(chave),
    };
    console.log("Telegram conectado.");
  }
  const host = await iniciarNavegador(cfg);
  host.contexto.on("close", encerrar);
  const leitor = new LeitorTabelaHtml(host.paginaPrincipal(), {
    tolerarSemTabela: Math.max(3, Math.ceil(5000 / cfg.monitor.intervaloMs)),
  });
  const adaptador = new AdaptadorLoginDoSite(host.paginaPrincipal(), leitor, {
    timeoutMs: cfg.timeouts.navegacaoMs,
  });
  const login = new GerenciadorLogin(
    adaptador,
    {
      loginAutomatico: cfg.site.loginAutomatico,
      usuario: cfg.site.usuario,
      senha: cfg.site.senha,
      esperaAposEnvioMs: 20_000,
      intervaloVerificacaoMs: 1000,
      intervaloAvisoMs: 30_000,
    },
    log,
    notificador,
  );
  const garantir = async (): Promise<void> => {
    console.log("Aguardando o login e a tabela de chamadas...");
    await login.garantirLogin(sinal.signal);
    console.log("Tabela encontrada.");
  };

  try {
    await instalarBloqueioDeEscrita(host.contexto, (metodo, caminho) =>
      log.warn("requisição de escrita bloqueada", { metodo, caminho }),
    );
    await host
      .abrirUrl(cfg.site.url)
      .catch(() => console.warn("Não consegui abrir o endereço configurado em SITE_URL."));
    await garantir();
    ajuda();
    const fila = new TaskQueue(
      {
        lookup: new ConsultaDeCliente(
          new PaginaClientesPlaywright(host.paginaPrincipal(), {
            timeoutMs: cfg.timeouts.consultaMs,
          }),
          (e) => {
            console.error(
              "Não consegui voltar para a Voice Call Status. Clique nela no menu da esquerda.",
            );
            log.error("falha ao voltar", { erro: e instanceof Error ? e.message : String(e) });
          },
        ),
        construtor,
        sender,
        log,
        notificador,
      },
      {
        modo: cfg.modo,
        validadeMensagemMs: cfg.validadeMensagemMin * 60_000,
        maxTentativasConsulta: 2,
        maxTentativasEnvio: 2,
        backoffMs: 5000,
        ttlTarefasMs: 3_600_000,
        previa: (t) => {
          const hora = new Date().toLocaleTimeString("pt-BR", { hour12: false });
          console.log(
            `
===== TRANSFERÊNCIA DETECTADA ${hora} — mensagem preparada =====
${t}
===== NÃO ENVIADA (modo observação) =====
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
    const pendentes = await fila.encerrar();
    for (const t of pendentes)
      console.log(
        t.estado === "incerta"
          ? `Atenção: ${t.id} ficou com envio INCERTO; confira o destino no Telegram antes de reiniciar.`
          : `Atenção: ${t.id} estava na fila e NÃO foi processada.`,
      );
  } catch (e) {
    if (!sinal.signal.aborted) console.error("Erro:", e instanceof Error ? e.message : e);
  } finally {
    rl.close();
    await clienteTg?.encerrar();
    await host.encerrar();
  }
}

principal().catch((e: unknown) => {
  console.error("Erro inesperado:", e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
