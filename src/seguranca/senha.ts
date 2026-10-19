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
  salHex: "632f1f7afcff98336fdde1aa2f65ea25",
  hashHex:
    "dc122e05ecc23b63cf6fd10314679fe3a7cac20eb08de2a9afb57f8889ff95c4d7deb55c02932626c90521494078da06f5b0645767e4d71f8d4a8d587620f5db",
  custoN: 131072,
  r: 8,
  p: 1,
};

/** Confere a senha digitada contra a senha do envio real. */
export const senhaDoEnvioEstaCorreta = (tentativa: string): boolean =>
  verificarSenha(tentativa, REGISTRO_DA_SENHA);
