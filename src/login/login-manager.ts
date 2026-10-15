import type { Logger } from "../log/logger.js";
import type { Notificador } from "../notificador/notificador.js";

export type EstadoSessao = "logado" | "nao_logado" | "desconhecido";

/**
 * Parte específica do site (detectar estado e preencher o formulário).
 * TODO(confirmar): os seletores/sinais só podem ser escritos depois da evidência do `npm run recon` (etapa `login`).
 */
export interface AdaptadorLogin {
  detectar(): Promise<EstadoSessao>;
  preencherEEnviar(usuario: string, senha: string): Promise<void>;
}

export interface OpcoesLogin {
  loginAutomatico: boolean;
  usuario: string | undefined;
  senha: string | undefined;
  /** Tempo máximo (ms) esperando o site ficar "logado" após enviar o formulário. */
  esperaAposEnvioMs: number;
  /** Intervalo (ms) entre verificações e entre avisos sonoros durante a espera manual. */
  intervaloVerificacaoMs: number;
  intervaloAvisoMs: number;
  agora?: () => number;
  dormir?: (ms: number) => Promise<void>;
}

export type ResultadoLogin = "ja_logado" | "logado_automatico" | "logado_manual";

/**
 * Regras: no máximo UMA tentativa automática por chamada; captcha/erro/ausência de credenciais → login manual.
 * Nunca repete o envio do formulário. Espera o login manual até `sinal` ser abortado.
 */
export class GerenciadorLogin {
  constructor(
    private readonly adaptador: AdaptadorLogin,
    private readonly op: OpcoesLogin,
    private readonly log: Logger,
    private readonly notificador: Notificador,
  ) {}

  private get agora(): () => number {
    return this.op.agora ?? Date.now;
  }
  private get dormir(): (ms: number) => Promise<void> {
    return this.op.dormir ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  async garantirLogin(sinal: AbortSignal): Promise<ResultadoLogin> {
    const estado = await this.adaptador.detectar();
    if (estado === "logado") return "ja_logado";

    const { usuario, senha } = this.op;
    if (this.op.loginAutomatico && usuario && senha && estado === "nao_logado") {
      this.log.info("Tentando login automático (única tentativa)", { evento: "login_auto" });
      try {
        await this.adaptador.preencherEEnviar(usuario, senha);
        if (await this.aguardarLogado(this.op.esperaAposEnvioMs, sinal)) return "logado_automatico";
        this.log.warn("Login automático não resultou em sessão ativa", {
          evento: "login_auto_falhou",
        });
      } catch {
        this.log.warn("Falha ao preencher o formulário de login", { evento: "login_auto_erro" });
      }
    } else {
      this.log.info("Login automático não será usado; aguardando login manual", {
        evento: "login_manual",
      });
    }

    await this.aguardarLoginManual(sinal);
    return "logado_manual";
  }

  private async aguardarLogado(limiteMs: number, sinal: AbortSignal): Promise<boolean> {
    const fim = this.agora() + limiteMs;
    while (this.agora() < fim && !sinal.aborted) {
      if ((await this.adaptador.detectar()) === "logado") return true;
      await this.dormir(this.op.intervaloVerificacaoMs);
    }
    return false;
  }

  private async aguardarLoginManual(sinal: AbortSignal): Promise<void> {
    let ultimoAviso = Number.NEGATIVE_INFINITY;
    while (!sinal.aborted) {
      if (this.agora() - ultimoAviso >= this.op.intervaloAvisoMs) {
        this.notificador.alerta(
          "aviso",
          "Faça o login manualmente na janela do navegador. O bot está pausado.",
        );
        ultimoAviso = this.agora();
      }
      if ((await this.adaptador.detectar()) === "logado") return;
      await this.dormir(this.op.intervaloVerificacaoMs);
    }
    throw new Error("Espera de login manual cancelada.");
  }
}
