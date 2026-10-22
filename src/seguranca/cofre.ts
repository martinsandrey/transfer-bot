import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

/**
 * Proteção do arquivo da sessão do Telegram (que dá acesso TOTAL à conta). O texto é cifrado com AES-256-GCM; a chave sai da
 * senha de liberação do envio real (scrypt com sal aleatório). A senha nunca é gravada: sem ela o arquivo não abre, e quem só
 * copiar o arquivo ou ler o código não consegue usar a sessão. Quanto mais longa a senha, mais caro é testar palpites.
 *
 * Formato do arquivo: `TBSESS1:` + base64(sal[16] + iv[12] + etiqueta[16] + texto cifrado).
 */
const PREFIXO = "TBSESS1:";
const N = 2 ** 16;
const R = 8;
const P = 1;

const chaveDe = (senha: string, sal: Buffer): Buffer =>
  scryptSync(senha.normalize("NFKC"), sal, 32, {
    N,
    r: R,
    p: P,
    maxmem: 256 * N * R + 32 * 1024 * 1024,
  });

export const estaCifrada = (texto: string): boolean => texto.startsWith(PREFIXO);

export function cifrar(texto: string, senha: string): string {
  const sal = randomBytes(16);
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", chaveDe(senha, sal), iv);
  c.setAAD(Buffer.from(PREFIXO));
  const dados = Buffer.concat([c.update(texto, "utf8"), c.final()]);
  return PREFIXO + Buffer.concat([sal, iv, c.getAuthTag(), dados]).toString("base64");
}

/** Devolve o texto original, ou `null` se a senha estiver errada ou o arquivo estiver corrompido. */
export function decifrar(cifrado: string, senha: string): string | null {
  try {
    if (!estaCifrada(cifrado)) return null;
    const b = Buffer.from(cifrado.slice(PREFIXO.length).trim(), "base64");
    if (b.length < 16 + 12 + 16 + 1) return null;
    const d = createDecipheriv(
      "aes-256-gcm",
      chaveDe(senha, b.subarray(0, 16)),
      b.subarray(16, 28),
    );
    d.setAAD(Buffer.from(PREFIXO));
    d.setAuthTag(b.subarray(28, 44));
    return Buffer.concat([d.update(b.subarray(44)), d.final()]).toString("utf8");
  } catch {
    return null;
  }
}
