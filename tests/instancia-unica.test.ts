import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { adquirirTrava } from "../src/util/instancia-unica.js";

describe("trava de instância única (evita mensagens em dobro por duas cópias abertas)", () => {
  const pasta = () => mkdtempSync(join(tmpdir(), "tb-trava-"));

  it("a 1ª cópia pega a trava; a 2ª (outra cópia viva) é recusada com o PID da 1ª; ao liberar, outra pode entrar", () => {
    const f = join(pasta(), "bot.lock");
    const a = adquirirTrava(f, process.pid);
    expect(a.ok).toBe(true);
    // simula "outra cópia": pid diferente, mas o dono (este processo) está vivo
    const b = adquirirTrava(f, process.pid + 100000);
    expect(b).toEqual({ ok: false, pid: process.pid });
    if (a.ok) a.liberar();
    expect(existsSync(f)).toBe(false);
    const c = adquirirTrava(f, process.pid + 100000);
    expect(c.ok).toBe(true);
    if (c.ok) c.liberar();
  });

  it("trava velha de um programa que caiu (PID inexistente) é substituída", () => {
    const f = join(pasta(), "bot.lock");
    writeFileSync(f, "99999999");
    const r = adquirirTrava(f, process.pid);
    expect(r.ok).toBe(true);
    if (r.ok) r.liberar();
  });

  it("arquivo de trava com lixo não impede de iniciar", () => {
    const f = join(pasta(), "bot.lock");
    writeFileSync(f, "isso não é um PID");
    expect(adquirirTrava(f).ok).toBe(true);
  });

  it("liberar duas vezes, ou liberar a trava de outro, não apaga nada indevido", () => {
    const f = join(pasta(), "bot.lock");
    const a = adquirirTrava(f, process.pid);
    writeFileSync(f, "12345"); // outro dono apareceu
    if (a.ok) a.liberar();
    expect(existsSync(f)).toBe(true);
  });
});
