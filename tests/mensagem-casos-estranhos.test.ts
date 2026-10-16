import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { telefonesIguais } from "../src/consulta/consulta-cliente.js";
import { camposPorRotulo } from "../src/consulta/rotulos.js";
import { criarConstrutor } from "../src/mensagem/construtor.js";
import { mascararTexto, mascararTelefone } from "../src/util/mascara.js";

const modelo = readFileSync("config/mensagem.txt", "utf8");
const base = { nome: "N", cpf: "C", location: "L", age: "A", phone: "011900000001" };

describe("mensagem com dados estranhos do cadastro", () => {
  const c = criarConstrutor(modelo);
  it("dados que parecem marcadores ou usam $ & não são expandidos nem quebram o texto", () => {
    const txt = c.build(
      { ...base, nome: "{{cpf}} $& $1 $$ {{callback number}}", cpf: "X" },
      "100001",
    );
    expect(txt).toContain("NAME: {{cpf}} $& $1 $$ {{callback number}}");
    expect(txt).toContain("CPF : X");
    expect(txt).toContain("Line 1 number: 100001");
  });
  it("chinês, emoji, quebras de linha e texto muito longo passam inteiros", () => {
    const longo = "Rua ".padEnd(3000, "x");
    const txt = c.build(
      { ...base, nome: "张伟 😀", location: `${longo}\nBloco 2`, age: "1980-01-31" },
      "100001",
    );
    expect(txt).toContain("NAME: 张伟 😀");
    expect(txt).toContain(longo);
    expect(txt).toContain("Age: 1980-01-31");
  });
  it("campos vazios ficam vazios (sem 'undefined' nem 'null')", () => {
    const txt = c.build({ nome: "", cpf: "", location: "", age: "", phone: "" }, "100001");
    expect(txt).not.toMatch(/undefined|null/);
    expect(txt).toContain("NAME:");
  });
});

describe("telefones e rótulos em casos de borda", () => {
  it("telefonesIguais ignora formatação e zeros à esquerda, mas não confunde números diferentes", () => {
    expect(telefonesIguais("(011) 90000-0001", "011900000001")).toBe(true);
    expect(telefonesIguais("11900000001", "011900000001")).toBe(true);
    expect(telefonesIguais("011900000002", "011900000001")).toBe(false);
    expect(telefonesIguais("", "011900000001")).toBe(false);
    expect(telefonesIguais("abc", "abc")).toBe(false);
  });
  it("rótulos: espaços, maiúsculas, dois-pontos largo e duplicados (vale o primeiro)", () => {
    const r = camposPorRotulo([
      { rotulo: "  NAME ：", valor: "Primeiro" },
      { rotulo: "Name:", valor: "Segundo" },
      { rotulo: "Mobile Phone：", valor: "999" },
      { rotulo: "Phone：", valor: "011900000001" },
      { rotulo: "ID number *", valor: "123" },
    ]);
    expect(r).toMatchObject({ nome: "Primeiro", phone: "011900000001", cpf: "123" });
  });
});

describe("máscaras do log", () => {
  it("telefone e CPF aparecem mascarados em qualquer texto", () => {
    expect(mascararTelefone("011900000001")).toBe("***0001");
    const t = mascararTexto("cliente 011900000001 cpf 123.456.789-09 ok");
    expect(t).not.toContain("011900000001");
    expect(t).not.toContain("123.456.789-09");
  });
});
