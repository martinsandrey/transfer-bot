import type { MessageSender, ResultadoEnvio } from "../dominio/tipos.js";

/** Enviador de console (simulação): apenas imprime. O Telegram real será outra implementação (Fase 5). */
export class EnviadorConsole implements MessageSender {
  constructor(private readonly escrever: (t: string) => void = (t) => console.log(t)) {}
  send(texto: string): Promise<ResultadoEnvio> {
    this.escrever(`----- [SIMULAÇÃO DE ENVIO] -----\n${texto}\n--------------------------------`);
    return Promise.resolve({ tipo: "enviada", confirmacao: "console" });
  }
}

/** Enviador programável para testes. */
export class EnviadorFalso implements MessageSender {
  readonly enviados: Array<{ texto: string; chave: string }> = [];
  constructor(
    private readonly respostas: Array<ResultadoEnvio | Error> = [],
    public verificacao: "entregue" | "nao_encontrada" | "indeterminado" | null = null,
  ) {}
  async send(texto: string, chave: string): Promise<ResultadoEnvio> {
    this.enviados.push({ texto, chave });
    const r = this.respostas.shift() ?? { tipo: "enviada", confirmacao: "ok" };
    if (r instanceof Error) throw r;
    return r;
  }
  async verify(): Promise<"entregue" | "nao_encontrada" | "indeterminado"> {
    return this.verificacao ?? "indeterminado";
  }
}
