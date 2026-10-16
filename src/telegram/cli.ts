import { carregarConfig, ErroDeConfiguracao } from "../config/config.js";
import { descreverFalhaDeEnvio } from "../fila/task-queue.js";
import { normalizarTitulo } from "./cliente.js";
import { ClienteGramJS, sessaoExiste } from "./cliente-gramjs.js";
import { EnviadorTelegram } from "./enviador-telegram.js";

const AJUDA = `
Uso: telegram.bat <comando>
  login   faz o login da sua conta pessoal (telefone, código e senha 2FA digitados aqui; nada disso é gravado, só a sessão)
  chats   lista suas conversas com o ID para usar em TELEGRAM_DESTINO (opcional: um trecho do nome para filtrar, ex.: telegram.bat chats Line)
  teste   envia UMA mensagem de teste (sem dados de cliente) para o TELEGRAM_DESTINO
`;

async function principal(): Promise<void> {
  const comando = process.argv[2] ?? "";
  if (!["login", "chats", "teste"].includes(comando)) {
    console.log(AJUDA);
    return;
  }
  const cfg = carregarConfig();
  const t = cfg.telegram;
  if (t.apiId === undefined || !t.apiHash) {
    console.error(
      '\nPreencha TELEGRAM_API_ID e TELEGRAM_API_HASH no arquivo .env (crie em https://my.telegram.org, "API development tools").\n',
    );
    process.exitCode = 1;
    return;
  }
  const cliente = await ClienteGramJS.conectar(
    { apiId: t.apiId, apiHash: t.apiHash, arquivoSessao: t.arquivoSessao },
    { loginInterativo: comando === "login" || !sessaoExiste(t.arquivoSessao) },
  );
  try {
    if (comando === "login") {
      console.log(
        `\nLogin feito. Sessão salva em: ${t.arquivoSessao}\nProteja esse arquivo: ele dá acesso à sua conta.\n`,
      );
    } else if (comando === "chats") {
      console.log("\nID (use em TELEGRAM_DESTINO) | tipo | título");
      const filtro = normalizarTitulo(process.argv[3] ?? "");
      const lista = (await cliente.dialogos(500)).filter((d) =>
        normalizarTitulo(d.titulo).includes(filtro),
      );
      for (const d of lista) console.log(`${d.id} | ${d.tipo} | ${d.titulo}`);
      if (lista.length === 0) console.log("(nenhuma conversa com esse trecho no nome)");
      console.log("\nPara as suas Mensagens Salvas use: TELEGRAM_DESTINO=me\n");
    } else {
      const envio = new EnviadorTelegram(cliente, {
        destino: t.destino,
        timeoutEnvioMs: t.timeoutEnvioMs,
        esperaMaximaFloodMs: 60_000,
      });
      const r = await envio.send(
        "Teste do Transfer Bot: se você leu isto, o envio funciona.",
        "teste",
      );
      console.log(
        r.tipo === "enviada"
          ? `\nMensagem de teste enviada para "${t.destino}".\n`
          : `\nO envio não foi confirmado (${r.tipo}${r.tipo === "falhou" ? ": " + descreverFalhaDeEnvio(r.motivo) : ""}). Confira o destino "${t.destino}".\n`,
      );
    }
  } finally {
    await cliente.encerrar();
  }
}

principal().then(
  () => process.exit(process.exitCode ?? 0),
  (e: unknown) => {
    console.error(
      e instanceof ErroDeConfiguracao
        ? `\n${e.message}\n`
        : `\nErro: ${e instanceof Error ? e.message : String(e)}\n`,
    );
    process.exit(1);
  },
);
