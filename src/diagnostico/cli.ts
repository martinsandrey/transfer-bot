import { execFile } from "node:child_process";
import { chromium } from "playwright";
import type { AppConfig } from "../config/config.js";
import { descreverFalhaDeEnvio } from "../fila/task-queue.js";
import { pedirSenhaDeLiberacao } from "../seguranca/senha-console.js";
import { ClienteGramJS, sessaoProtegida } from "../telegram/cliente-gramjs.js";
import { processoVivo } from "../util/instancia-unica.js";
import { executarDiagnostico, formatar } from "./verificacoes.js";

/** Abre o navegador sem janela e com perfil temporário (não mexe no perfil do bot) e só CARREGA o endereço do site. */
async function abrirSite(cfg: AppConfig): Promise<number | null> {
  const navegador = await chromium.launch({
    headless: true,
    ...(cfg.navegador === "msedge" ? { channel: "msedge" } : {}),
  });
  try {
    const pagina = await navegador.newPage();
    const resposta = await pagina.goto(cfg.site.url, {
      waitUntil: "domcontentloaded",
      timeout: cfg.timeouts.navegacaoMs,
    });
    return resposta?.status() ?? null;
  } finally {
    await navegador.close().catch(() => undefined);
  }
}

async function testarTelegram(cfg: AppConfig): Promise<{ destino: string; erro: string | null }[]> {
  const t = cfg.telegram;
  let senhaDaSessao: string | undefined;
  if (sessaoProtegida(t.arquivoSessao)) {
    const senha = await pedirSenhaDeLiberacao("Senha de liberação (abre a sessão do Telegram): ");
    if (senha === null) throw new Error("senha de liberação não informada");
    senhaDaSessao = senha;
  }
  const cliente = await ClienteGramJS.conectar(
    {
      apiId: t.apiId as number,
      apiHash: t.apiHash as string,
      arquivoSessao: t.arquivoSessao,
      ...(senhaDaSessao !== undefined ? { senhaDaSessao } : {}),
    },
    { loginInterativo: false },
  );
  try {
    const saida: { destino: string; erro: string | null }[] = [];
    for (const destino of [t.destino, ...(t.destinoLonga ? [t.destinoLonga] : [])]) {
      try {
        await cliente.validarDestino(destino);
        saida.push({ destino, erro: null });
      } catch (e) {
        saida.push({
          destino,
          erro: descreverFalhaDeEnvio(e instanceof Error ? e.message : String(e)),
        });
      }
    }
    return saida;
  } finally {
    await cliente.encerrar();
  }
}

/** Valor `ToastEnabled` do registro do Windows (0 = notificações desligadas). Sem o valor = padrão do Windows (ligadas). */
function notificacoesDoSistemaLigadas(): Promise<boolean | null> {
  return new Promise((resolver) => {
    execFile(
      "reg",
      [
        "query",
        "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\PushNotifications",
        "/v",
        "ToastEnabled",
      ],
      { windowsHide: true, timeout: 10_000 },
      (erro, saida) => {
        if (erro) return resolver(null);
        const m = /ToastEnabled\s+REG_DWORD\s+0x([0-9a-f]+)/i.exec(saida);
        resolver(m ? parseInt(m[1] ?? "1", 16) !== 0 : null);
      },
    );
  });
}

async function principal(): Promise<void> {
  console.log(
    "\n=== Transfer Bot: diagnóstico ===\nConferindo (leva alguns segundos; nada é enviado e nenhum login é feito)...\n",
  );
  const resultados = await executarDiagnostico({
    caminhoEnv: ".env",
    caminhoExemplo: ".env.example",
    env: process.env,
    versaoNode: process.versions.node,
    plataforma: process.platform,
    agora: Date.now,
    fusoLocal: Intl.DateTimeFormat().resolvedOptions().timeZone,
    processoVivo,
    abrirSite,
    testarTelegram,
    notificacoesDoSistemaLigadas,
  });
  console.log(formatar(resultados) + "\n");
  if (resultados.some((r) => r.situacao === "erro")) process.exitCode = 1;
}

principal().then(
  () => process.exit(process.exitCode ?? 0),
  (e: unknown) => {
    console.error(`\nErro no diagnóstico: ${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(1);
  },
);
