import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cifrar, decifrar, estaCifrada } from "../src/seguranca/cofre.js";
import { sessaoProtegida } from "../src/telegram/cliente-gramjs.js";

const SESSAO = "1BAAOMTQ5LjE1NC4xNjcuNTAAAA-sessao-ficticia";
const SENHA = "senha-de-teste-ficticia";

describe("cofre da sessão do Telegram", () => {
  it("cifra e decifra com a mesma senha; o texto da sessão não aparece no arquivo", () => {
    const c = cifrar(SESSAO, SENHA);
    expect(estaCifrada(c)).toBe(true);
    expect(c).not.toContain(SESSAO);
    expect(c).not.toContain(SENHA);
    expect(decifrar(c, SENHA)).toBe(SESSAO);
  });

  it("senha errada, texto adulterado ou texto sem cifra não abrem (null)", () => {
    const c = cifrar(SESSAO, SENHA);
    expect(decifrar(c, SENHA + "x")).toBeNull();
    expect(decifrar(c, "")).toBeNull();
    const adulterado = c.slice(0, -4) + (c.endsWith("AAAA") ? "BBBB" : "AAAA");
    expect(decifrar(adulterado, SENHA)).toBeNull();
    expect(decifrar(SESSAO, SENHA)).toBeNull();
    expect(decifrar("TBSESS1:curto", SENHA)).toBeNull();
  });

  it("cada cifra é diferente (sal e iv aleatórios), mas todas abrem", () => {
    const a = cifrar(SESSAO, SENHA);
    const b = cifrar(SESSAO, SENHA);
    expect(a).not.toBe(b);
    expect(decifrar(b, SENHA)).toBe(SESSAO);
  });

  it("sessaoProtegida diferencia arquivo cifrado, em texto simples e inexistente", () => {
    const pasta = mkdtempSync(join(tmpdir(), "cofre-"));
    const cifrado = join(pasta, "a.txt");
    const simples = join(pasta, "b.txt");
    writeFileSync(cifrado, cifrar(SESSAO, SENHA));
    writeFileSync(simples, SESSAO);
    expect(sessaoProtegida(cifrado)).toBe(true);
    expect(sessaoProtegida(simples)).toBe(false);
    expect(sessaoProtegida(join(pasta, "nao-existe.txt"))).toBe(false);
    expect(readFileSync(simples, "utf8")).toBe(SESSAO);
  });
});
