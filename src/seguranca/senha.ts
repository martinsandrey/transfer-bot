import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

/**
 * Senha de liberação do envio real (pedido do usuário: fixa, NÃO configurável e que não possa ser descoberta lendo o código).
 *
 * O código guarda só um resumo irreversível (scrypt com sal aleatório e custo alto de memória/tempo), nunca a senha nem uma
 * versão que se possa desfazer ("criptografar" de forma reversível exigiria guardar a chave no mesmo lugar). Quem lê o código
 * não consegue "decifrar" a senha; só consegue testar palpites um a um, e cada palpite custa ~0,3 s e 128 MB de memória.
 * Uma senha mais longa e menos previsível aumenta muito esse custo: para trocá-la, rode `npm run gerar-hash-senha`
 * e cole o resultado em `REGISTRO_DA_SENHA`.
 */
export interface RegistroDeSenha {
  salHex: string;
  hashHex: string;
  custoN: number;
  r: number;
  p: number;
}

const TAMANHO = 64;

export function gerarRegistro(senha: string, custoN = 2 ** 17, r = 8, p = 1): RegistroDeSenha {
  const sal = randomBytes(16);
  return {
    salHex: sal.toString("hex"),
    hashHex: derivar(senha, sal, custoN, r, p).toString("hex"),
    custoN,
    r,
    p,
  };
}

function derivar(senha: string, sal: Buffer, N: number, r: number, p: number): Buffer {
  return scryptSync(senha.normalize("NFKC"), sal, TAMANHO, {
    N,
    r,
    p,
    maxmem: 256 * N * r + 32 * 1024 * 1024,
  });
}

export function verificarSenha(tentativa: string, registro: RegistroDeSenha): boolean {
  try {
    const esperado = Buffer.from(registro.hashHex, "hex");
    const obtido = derivar(
      tentativa,
      Buffer.from(registro.salHex, "hex"),
      registro.custoN,
      registro.r,
      registro.p,
    );
    return esperado.length === obtido.length && timingSafeEqual(esperado, obtido);
  } catch {
    return false;
  }
}

/** Registro da senha de liberação do envio real. Gerado com `gerarRegistro`; a senha em si não está em lugar nenhum. */
export const REGISTRO_DA_SENHA: RegistroDeSenha = {
  salHex: "2f426f2b202787165b029c0dc32a7c4f",
  hashHex:
    "7d1cc4c76f37bb177786cfcf2c4e4f3c5bc77d7a3f7808dbde2dfc89e16bc535e32ab2e2523f589afb6406963b28364b168d64add06e373415e1b639862f15b4",
  custoN: 131072,
  r: 8,
  p: 1,
};

/** Confere a senha digitada contra a senha do envio real. */
export const senhaDoEnvioEstaCorreta = (tentativa: string): boolean =>
  verificarSenha(tentativa, REGISTRO_DA_SENHA);
