import type { Interface } from "node:readline";

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
