import { crc32 } from "node:zlib";
import { expect } from "vitest";

/** Lê um ZIP sem compressão (o que `montarXlsx` gera), conferindo assinatura e CRC de cada arquivo. */
export function lerZip(b: Uint8Array): Map<string, string> {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const fim = b.length - 22;
  expect(v.getUint32(fim, true)).toBe(0x06054b50);
  const n = v.getUint16(fim + 10, true);
  let p = v.getUint32(fim + 16, true);
  const dec = new TextDecoder();
  const arquivos = new Map<string, string>();
  for (let i = 0; i < n; i++) {
    expect(v.getUint32(p, true)).toBe(0x02014b50);
    const crc = v.getUint32(p + 16, true);
    const tam = v.getUint32(p + 20, true);
    const tn = v.getUint16(p + 28, true);
    const nome = dec.decode(b.subarray(p + 46, p + 46 + tn));
    const local = v.getUint32(p + 42, true);
    expect(v.getUint32(local, true)).toBe(0x04034b50);
    const ini = local + 30 + v.getUint16(local + 26, true);
    const dados = b.subarray(ini, ini + tam);
    expect(crc32(dados)).toBe(crc);
    arquivos.set(nome, dec.decode(dados));
    p += 46 + tn;
  }
  return arquivos;
}
