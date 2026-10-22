import { createInterface, type Interface } from "node:readline";
import { senhaDoEnvioEstaCorreta } from "./senha.js";

type ComSaida = Interface & {
  _writeToOutput?: (texto: string) => void;
  output?: NodeJS.WritableStream;
};

/** Lê uma linha do console mostrando `*` no lugar do que é digitado. */
export function lerSenhaOculta(rl: Interface, pergunta: string): Promise<string> {
  const r = rl as ComSaida;
  return new Promise((resolve) => {
    const original = r._writeToOutput;
    let escrevendoPergunta = true;
    r._writeToOutput = (texto: string): void => {
      if (escrevendoPergunta) r.output?.write(texto);
      else if (texto === "\r\n" || texto === "\n") r.output?.write(texto);
      else r.output?.write("*".repeat([...texto].length));
    };
    rl.question(pergunta, (resposta) => {
      if (original) r._writeToOutput = original;
      else delete r._writeToOutput;
      resolve(resposta);
    });
    escrevendoPergunta = false;
  });
}

/**
 * Pergunta a senha de liberação (até 3 tentativas) e devolve a senha correta, ou `null`. Serve para abrir/proteger a sessão do
 * Telegram nos comandos fora do programa principal. A senha fica só na memória.
 */
export async function pedirSenhaDeLiberacao(texto: string): Promise<string | null> {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  try {
    for (let tentativa = 1; tentativa <= 3; tentativa++) {
      const digitada = await lerSenhaOculta(rl, texto);
      if (senhaDoEnvioEstaCorreta(digitada)) return digitada;
      if (tentativa < 3) console.log("Senha incorreta. Tente de novo.");
    }
    return null;
  } finally {
    rl.close();
  }
}
