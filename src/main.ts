import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { stdin, stdout } from "node:process";
import {
  carregarConfig,
  ErroDeConfiguracao,
  validarConfig,
  type AppConfig,
} from "./config/config.js";
import type { MessageSender } from "./dominio/tipos.js";
import { TaskQueue, descreverFalhaDeEnvio } from "./fila/task-queue.js";
import { LeitorTabelaHtml } from "./leitura/leitor-tabela.js";
import { criarLogger } from "./log/logger.js";
import { AdaptadorLoginDoSite } from "./login/adaptador-site.js";
import { GerenciadorLogin } from "./login/login-manager.js";
import { criarConstrutor, ErroDeModelo } from "./mensagem/construtor.js";
import { EnviadorConsole } from "./mensagem/enviadores.js";
import { CallTracker } from "./monitor/call-tracker.js";
import { Monitor } from "./monitor/monitor.js";
import { adquirirTrava } from "./util/instancia-unica.js";
import { senhaDoEnvioEstaCorreta } from "./seguranca/senha.js";
import { lerSenhaOculta } from "./seguranca/senha-console.js";
import { RegistroEmArquivo } from "./registro/registro-arquivo.js";
import { ClienteGramJS } from "./telegram/cliente-gramjs.js";
import { comAviso } from "./telegram/com-aviso.js";
import { EnviadorTelegram } from "./telegram/enviador-telegram.js";
import { iniciarNavegador } from "./navegador/navegador.js";
import { criarNotificador } from "./notificador/notificador.js";
import { criarToastWindows } from "./notificador/toast-windows.js";
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

const TENTATIVAS_DE_SENHA = 3;

/** `testar-notificacao.bat`: mostra duas notificações de exemplo para você conferir se o Windows as exibe. */
async function testarNotificacao(): Promise<void> {
  const n = criarNotificador({ toast: criarToastWindows() });
  console.log("Enviando notificações de teste ao Windows...");
  n.alerta("erro", "TESTE: assim aparece um erro (ex.: envio que falhou).");
  await new Promise((r) => setTimeout(r, 1500));
  n.alerta("aviso", "TESTE: assim aparece um aviso relevante (ex.: login necessário).", {
    windows: true,
  });
  await new Promise((r) => setTimeout(r, 3000));
  console.log(
    '\nSe nenhuma notificação apareceu: abra Configurações > Sistema > Notificações, ligue "Notificações" e o modo "Não incomodar"/Assistente de foco desligado (e confira a permissão do "Windows PowerShell").',
  );
}

async function principal(): Promise<void> {
  if (process.argv.includes("--teste-notificacao")) return testarNotificacao();
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
  const notificador = criarNotificador({
    ...(cfg.notificacoes.windows && !simulado ? { toast: criarToastWindows() } : {}),
    toastInformativos: cfg.notificacoes.informativas,
    toastLigacoesLongas: cfg.notificacoes.longas,
  });
  // Rede de segurança: uma promessa rejeitada e esquecida nunca derruba o programa; fica registrada no log.
  process.on("unhandledRejection", (motivo) => {
    log.error("Promessa rejeitada sem tratamento", {
      evento: "unhandled_rejection",
      motivo: motivo instanceof Error ? motivo.message : "desconhecido",
    });
  });
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
    esperaCallbackMs: cfg.monitor.callbackEsperaMs,
    // Segundo grupo: ligação que chega ao tempo mínimo AINDA em Stage 1 (só se TELEGRAM_DESTINO_5MIN estiver preenchido).
    ...(!simulado && cfg.telegram.destinoLonga
      ? { duracaoLongaSeg: cfg.duracaoLongaMin * 60 }
      : {}),
    // Diário de status no ARQUIVO de log (sem telefones): mostra o que acontece entre o Stage 1 e o Stage 3.
    aoMudarStatus: (i) =>
      log.info("status", { evento: "status_mudou", idCurto: i.id, de: i.de, para: i.para }),
  });
  const opMonitor = {
    pausarDuranteConsulta: true,
    intervaloMs: cfg.monitor.intervaloMs,
    ...(!simulado ? { filtroFuncionarios: cfg.filtroFuncionarios } : {}),
    invalidasParaAlertar: 10,
    falhasParaAlertar: 5,
    limpezaMs: 60_000,
  };

  console.log(
    `\nModo: ${cfg.modo === "observacao" ? "OBSERVAÇÃO (nada é enviado)" : "ENVIO REAL"}${simulado ? " — SIMULAÇÃO com dados fictícios" : ""}`,
  );

  if (!simulado) {
    const desc = (d: ReadonlySet<string> | null): string =>
      d === null ? "todos os funcionários" : `penúltimo dígito ${[...d].join(" ou ")}`;
    console.log(
      `Funcionários: transferências = ${desc(cfg.filtroFuncionarios.transferencia)}; 5 minutos = ${desc(cfg.filtroFuncionarios.longa)}.`,
    );
  }

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
  // Uma única cópia por vez: duas cópias mandariam cada mensagem duas vezes.
  if (!simulado) {
    const trava = adquirirTrava(join(cfg.pastas.dados, "bot.lock"));
    if (!trava.ok) {
      console.error(
        `\nJá existe outra cópia do programa aberta${trava.pid > 0 ? ` (processo ${trava.pid})` : ""}. Feche a outra janela antes de abrir esta.\nSe tiver certeza de que não há outra, apague o arquivo "bot.lock" na pasta de dados (${cfg.pastas.dados}).\n`,
      );
      process.exitCode = 1;
      rl.close();
      return;
    }
    process.on("exit", trava.liberar);
  }
  const registro = cfg.pastaRegistros
    ? new RegistroEmArquivo(cfg.pastaRegistros, () =>
        console.error(
          `Aviso: não consegui gravar o registro de mensagens em "${cfg.pastaRegistros}". O envio continua normalmente.`,
        ),
      )
    : undefined;
  if (registro) console.log(`Registro das mensagens em: ${cfg.pastaRegistros}`);
  let sender: MessageSender = new EnviadorConsole();
  let senderLonga: MessageSender | undefined;
  let clienteTg: ClienteGramJS | undefined;
  if (cfg.modo === "live") {
    const { apiId, apiHash, destino, timeoutEnvioMs, arquivoSessao } = cfg.telegram;
    console.log(
      `\nENVIO REAL ativado. As transferências serão enviadas para "${destino}"${cfg.telegram.destinoLonga ? ` e as ligações de ${cfg.duracaoLongaMin} min (ainda em Stage 1) para "${cfg.telegram.destinoLonga}"` : ""}.`,
    );
    let liberado = false;
    for (let tentativa = 1; tentativa <= TENTATIVAS_DE_SENHA && !liberado; tentativa++) {
      const digitada = await lerSenhaOculta(rl, "Digite a senha para liberar o envio real: ");
      liberado = senhaDoEnvioEstaCorreta(digitada);
      if (!liberado && tentativa < TENTATIVAS_DE_SENHA)
        console.log("Senha incorreta. Tente de novo.");
    }
    if (!liberado) {
      console.log(
        "Senha incorreta. Cancelado: nada foi enviado. Para só observar, use SEND_MODE=observacao.",
      );
      rl.close();
      return;
    }
    try {
      clienteTg = await ClienteGramJS.conectar(
        { apiId: apiId as number, apiHash: apiHash as string, arquivoSessao },
        { loginInterativo: false },
      );
      await clienteTg.validarDestino(destino);
      if (cfg.telegram.destinoLonga) await clienteTg.validarDestino(cfg.telegram.destinoLonga);
    } catch (e) {
      const motivo = e instanceof Error ? e.message : String(e);
      console.error(`\nTelegram: ${descreverFalhaDeEnvio(motivo)}\n`);
      await clienteTg?.encerrar();
      process.exitCode = 1;
      rl.close();
      return;
    }
    const telegram = new EnviadorTelegram(clienteTg, {
      destino,
      timeoutEnvioMs,
      esperaMaximaFloodMs: 60_000,
    });
    sender = comAviso(telegram, "transferência");
    if (cfg.telegram.destinoLonga) {
      senderLonga = comAviso(
        new EnviadorTelegram(clienteTg, {
          destino: cfg.telegram.destinoLonga,
          timeoutEnvioMs,
          esperaMaximaFloodMs: 60_000,
        }),
        `${cfg.duracaoLongaMin} min`,
      );
    }
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
            notificador.alerta(
              "erro",
              "Não consegui voltar para a Voice Call Status. Clique nela no menu da esquerda.",
            );
            log.error("falha ao voltar", { erro: e instanceof Error ? e.message : String(e) });
          },
        ),
        construtor,
        sender,
        ...(senderLonga ? { senderLonga } : {}),
        ...(registro ? { registrar: (r) => registro.registrar(r) } : {}),
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
        previa: (t, tipo) => {
          const hora = new Date().toLocaleTimeString("pt-BR", { hour12: false });
          const titulo =
            tipo === "longa"
              ? `LIGAÇÃO DE ${cfg.duracaoLongaMin} MIN (STAGE 1) ${hora} — mensagem do 2º grupo`
              : tipo === "callback"
                ? `CALLBACK (ninguém atendeu) ${hora} — resposta à mensagem de transferência`
                : `TRANSFERÊNCIA DETECTADA ${hora} — mensagem preparada`;
          console.log(
            `
===== ${titulo} =====
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
    if (!sinal.signal.aborted) {
      notificador.alerta(
        "erro",
        `O programa parou por um erro: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  } finally {
    rl.close();
    await clienteTg?.encerrar();
    await host.encerrar();
  }
}

principal().catch((e: unknown) => {
  console.error("Erro inesperado:", e instanceof Error ? e.message : e);
  criarNotificador({ toast: criarToastWindows() }).alerta(
    "erro",
    `O programa parou por um erro inesperado: ${e instanceof Error ? e.message : String(e)}`,
  );
  process.exitCode = 1;
});
