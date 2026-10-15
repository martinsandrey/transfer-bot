import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { criarConstrutor, ErroDeModelo } from "../src/mensagem/construtor.js";

const REG = {
  nome: "  Fulano de Tal ",
  cpf: "000.000.000-00",
  location: "Cidade X, UF",
  age: "42",
  phone: "5521900000101",
};

describe("MessageBuilder", () => {
  const modelo = readFileSync("config/mensagem.txt", "utf8");

  it("config/mensagem.txt é válido e gera exatamente o texto esperado", () => {
    const msg = criarConstrutor(modelo).build(REG, "5511900000001");
    expect(msg).toBe(
      [
        "NAME: Fulano de Tal",
        "CPF : 000.000.000-00",
        "Location: Cidade X, UF",
        "Age: 42",
        "Occupation: ",
        "Ph: 5521900000101",
        "Line 1 number: 5511900000001",
        "NOTE:",
      ].join("\n"),
    );
  });

  it("copia literalmente: campos vazios, caracteres especiais e $ não são interpretados", () => {
    const msg = criarConstrutor(modelo).build(
      { nome: "Zoë $& $1 {{age}} 😀", cpf: "", location: "", age: "  ", phone: "1" },
      "2",
    );
    expect(msg).toContain("NAME: Zoë $& $1 {{age}} 😀\n");
    expect(msg).toContain("CPF : \n");
    expect(msg).toContain("Age: \n");
  });

  it("aceita CRLF e quebra de linha final do arquivo; preserva o espaço depois de 'Occupation:'", () => {
    const msg = criarConstrutor(modelo.replace(/\n/g, "\r\n") + "\r\n").build(REG, "9");
    expect(msg).not.toContain("\r");
    expect(msg.endsWith("NOTE:")).toBe(true);
    expect(msg).toContain("Occupation: \n");
  });

  it("rejeita placeholders desconhecidos, ausentes e chaves sem par, com dica", () => {
    expect(() =>
      criarConstrutor(
        "{{nome}} {{cpf}} {{location}} {{age}} {{Phone}} {{callback number}} {{idade}}",
      ),
    ).toThrow(/desconhecido "\{\{idade\}\}"/);
    expect(() => criarConstrutor("{{nome}}")).toThrow(/ausente: "\{\{cpf\}\}"/);
    expect(() =>
      criarConstrutor("{{ nome }} {{cpf}} {{location}} {{age}} {{Phone}} {{callback number}}"),
    ).toThrow(/quis dizer "\{\{nome\}\}"/);
    expect(() =>
      criarConstrutor("{{nome}} {{cpf}} {{location}} {{age}} {{Phone}} {{callback number}} {{"),
    ).toThrow(ErroDeModelo);
  });
});
