import { describe, expect, it } from "vitest";
import {
  camposPorRotulo,
  normalizarRotulo,
  ROTULOS_DO_FORMULARIO,
} from "../src/consulta/rotulos.js";

describe("rótulos do formulário de edição (informados pelo usuário)", () => {
  it("mapeamento combinado", () => {
    expect(ROTULOS_DO_FORMULARIO).toEqual({
      nome: "Name",
      cpf: "ID number",
      age: "Date of birth",
      phone: "Phone",
      mobilePhone: "Mobile Phone",
      location: "Address",
    });
  });

  it("normaliza maiúsculas, acentos, espaços e dois-pontos/asterisco no fim", () => {
    expect(normalizarRotulo(" ID  Number : ")).toBe("id number");
    expect(normalizarRotulo("Date of Birth*")).toBe("date of birth");
    expect(normalizarRotulo("ENDEREÇO")).toBe("endereco");
    // o site escreve os rótulos com dois-pontos largo (U+FF1A): "ID Number：", "Date of Birth：", "Phone："
    expect(normalizarRotulo("ID Number：")).toBe("id number");
    expect(normalizarRotulo("Phone：")).toBe("phone");
    expect(normalizarRotulo("Mobile Phone：")).toBe("mobile phone");
  });

  it("converte pares rótulo→valor: Age recebe o conteúdo de Date of birth, sem cálculo", () => {
    const campos = camposPorRotulo([
      { rotulo: "Name:", valor: "Maria Exemplo" },
      { rotulo: "ID number", valor: "000.000.000-01" },
      { rotulo: "Date of birth", valor: "1980-05-17" },
      { rotulo: "Phone：", valor: "011900000101" },
      { rotulo: "Mobile Phone：", valor: "011977777777" },
      { rotulo: "Address", valor: "Rua Exemplo, 10" },
      { rotulo: "Email", valor: "ignorado@exemplo.invalid" },
    ]);
    expect(campos).toEqual({
      nome: "Maria Exemplo",
      cpf: "000.000.000-01",
      age: "1980-05-17",
      phone: "011900000101",
      mobilePhone: "011977777777",
      location: "Rua Exemplo, 10",
    });
  });

  it("rótulo ausente vira undefined (vazio na mensagem); repetido vale o primeiro", () => {
    const campos = camposPorRotulo([
      { rotulo: "Name", valor: "Primeiro" },
      { rotulo: "Name", valor: "Segundo" },
      { rotulo: "Address", valor: undefined },
    ]);
    expect(campos.nome).toBe("Primeiro");
    expect(campos.cpf).toBeUndefined();
    expect(campos.location).toBeUndefined();
  });
});
