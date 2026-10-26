import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ConsultaDeCliente,
  telefonesIguais,
  type CamposDoCadastro,
  type PaginaClientes,
} from "../src/consulta/consulta-cliente.js";
import { TaskQueue } from "../src/fila/task-queue.js";
import { criarConstrutor } from "../src/mensagem/construtor.js";
import { EnviadorFalso } from "../src/mensagem/enviadores.js";
import { criarNotificadorFalso } from "../src/notificador/notificador.js";

/** Página falsa que registra tudo o que o bot faz. Dados fictícios. */
class PaginaFalsa implements PaginaClientes {
  chamadas: string[] = [];
  constructor(
    private readonly resultados: number | ((telefone: string, campo: string) => number),
    private readonly campos: CamposDoCadastro,
    private readonly falhaEm?: string,
  ) {}
  private passo(nome: string): void {
    this.chamadas.push(nome);
    if (this.falhaEm === nome) throw new Error("falha de navegação");
  }
  async abrir() {
    this.passo("abrir");
  }
  async pesquisarPorTelefone(t: string, campo: "phone" | "mobile" = "phone") {
    this.passo(`${campo === "mobile" ? "pesquisarMobile" : "pesquisar"}:${t}`);
    return {
      resultados:
        typeof this.resultados === "function" ? this.resultados(t, campo) : this.resultados,
    };
  }
  async abrirEdicaoDoPrimeiro() {
    this.passo("abrirEdicao");
  }
  async lerCampos() {
    this.passo("lerCampos");
    return this.campos;
  }
  async voltarParaVoiceCallStatus() {
    this.passo("voltarParaVoiceCallStatus");
  }
}
const COMPLETO = {
  nome: " Maria Exemplo ",
  cpf: "000.000.000-01",
  location: "Cidade X",
  age: "41",
  phone: "011900000101",
};

describe("telefonesIguais", () => {
  it("compara só dígitos e ignora zeros à esquerda", () => {
    expect(telefonesIguais("011900000101", "11900000101")).toBe(true);
    expect(telefonesIguais("(011) 90000-0101", "011900000101")).toBe(true);
    expect(telefonesIguais("011900000101", "011900000102")).toBe(false);
    expect(telefonesIguais("", "")).toBe(false);
    // DDI na frente de um lado só: igual, desde que o menor tenha DDD + número (10 dígitos ou mais)
    expect(telefonesIguais("5511959361939", "011959361939")).toBe(true);
    expect(telefonesIguais("959361939", "5511959361939")).toBe(false);
  });
});

describe("ConsultaDeCliente", () => {
  it("fluxo completo: pesquisa pelo Callee, lê o cadastro, volta pelo menu (sem confirmar a edição); copia só com trim", async () => {
    const p = new PaginaFalsa(1, COMPLETO);
    const r = await new ConsultaDeCliente(p).find("011900000101");
    expect(r).toEqual({
      tipo: "ok",
      multiplos: false,
      registro: {
        nome: "Maria Exemplo",
        cpf: "000.000.000-01",
        location: "Cidade X",
        age: "41",
        phone: "011900000101",
      },
    });
    expect(p.chamadas).toEqual([
      "abrir",
      "pesquisar:011900000101",
      "abrirEdicao",
      "lerCampos",
      "voltarParaVoiceCallStatus",
    ]);
  });

  it("campos faltando ficam VAZIOS e não são erro", async () => {
    const p = new PaginaFalsa(1, { nome: "Fulano", phone: "011900000101" });
    const r = await new ConsultaDeCliente(p).find("011900000101");
    expect(r).toEqual({
      tipo: "ok",
      multiplos: false,
      registro: { nome: "Fulano", cpf: "", location: "", age: "", phone: "011900000101" },
    });
  });

  it("telefone ausente no cadastro: segue (a busca foi por ele) com Ph vazio", async () => {
    const r = await new ConsultaDeCliente(new PaginaFalsa(1, { nome: "Fulano" })).find(
      "011900000101",
    );
    expect(r).toMatchObject({ tipo: "ok", registro: { phone: "" } });
  });

  it("0 resultados: tenta Phone (com e sem o 0 na frente) e Mobile Phone (idem), não abre edição e diz o que pesquisou", async () => {
    const p = new PaginaFalsa(0, {});
    expect(await new ConsultaDeCliente(p).find("011900000101")).toEqual({
      tipo: "nenhum",
      tentativas:
        'Phone "011900000101"; Phone "11900000101"; Mobile Phone "011900000101"; Mobile Phone "11900000101"',
    });
    expect(p.chamadas).toEqual([
      "abrir",
      "pesquisar:011900000101",
      "pesquisar:11900000101",
      "pesquisarMobile:011900000101",
      "pesquisarMobile:11900000101",
      "voltarParaVoiceCallStatus",
    ]);
  });

  it("número com 0 na frente que só existe no cadastro sem o 0: acha na segunda busca e segue normalmente", async () => {
    const p = new PaginaFalsa((t) => (t === "11900000101" ? 1 : 0), COMPLETO);
    const r = await new ConsultaDeCliente(p).find("011900000101");
    expect(r).toMatchObject({ tipo: "ok", registro: { nome: "Maria Exemplo" } });
    expect(p.chamadas).toEqual([
      "abrir",
      "pesquisar:011900000101",
      "pesquisar:11900000101",
      "abrirEdicao",
      "lerCampos",
      "voltarParaVoiceCallStatus",
    ]);
  });

  it("não achou no Phone: pesquisa no Mobile Phone, confere e mostra o telefone do campo Mobile Phone", async () => {
    const p = new PaginaFalsa((_t, campo) => (campo === "mobile" ? 1 : 0), {
      ...COMPLETO,
      phone: "011933333333", // outro telefone no campo Phone: não pode causar "cliente errado"
      mobilePhone: "11900000101",
    });
    const r = await new ConsultaDeCliente(p).find("011900000101");
    expect(r).toMatchObject({ tipo: "ok", registro: { phone: "11900000101" } });
    expect(p.chamadas).toEqual([
      "abrir",
      "pesquisar:011900000101",
      "pesquisar:11900000101",
      "pesquisarMobile:011900000101",
      "abrirEdicao",
      "lerCampos",
      "voltarParaVoiceCallStatus",
    ]);
  });

  it("achado pelo Mobile Phone mas o Mobile Phone do cadastro é de outro número: cliente errado, dizendo qual campo", async () => {
    const p = new PaginaFalsa((_t, campo) => (campo === "mobile" ? 1 : 0), {
      ...COMPLETO,
      mobilePhone: "011944444444",
    });
    expect(await new ConsultaDeCliente(p).find("011900000101")).toEqual({
      tipo: "telefone_divergente",
      campo: "Mobile Phone",
    });
  });

  it("achou de primeira: uma busca só; número sem 0 na frente e sem resultado: uma busca por campo", async () => {
    const a = new PaginaFalsa(1, COMPLETO);
    await new ConsultaDeCliente(a).find("011900000101");
    expect(a.chamadas.filter((c) => c.startsWith("pesquisar"))).toEqual(["pesquisar:011900000101"]);
    const b = new PaginaFalsa(0, {});
    expect(await new ConsultaDeCliente(b).find("5511900000101")).toMatchObject({ tipo: "nenhum" });
    expect(b.chamadas.filter((c) => c.startsWith("pesquisar"))).toEqual([
      "pesquisar:5511900000101",
      "pesquisarMobile:5511900000101",
    ]);
  });

  it("vários resultados: usa o primeiro e sinaliza", async () => {
    const r = await new ConsultaDeCliente(new PaginaFalsa(3, COMPLETO)).find("011900000101");
    expect(r).toMatchObject({ tipo: "ok", multiplos: true });
  });

  it("telefone do cadastro diferente do Callee: cliente errado, e ainda volta para a Voice Call Status", async () => {
    const p = new PaginaFalsa(1, { ...COMPLETO, phone: "011911111111" });
    expect(await new ConsultaDeCliente(p).find("011900000101")).toEqual({
      tipo: "telefone_divergente",
      campo: "Phone",
    });
    expect(p.chamadas.at(-1)).toBe("voltarParaVoiceCallStatus");
  });

  it("falha durante a leitura: repassa o erro e volta para a Voice Call Status", async () => {
    const p = new PaginaFalsa(1, COMPLETO, "lerCampos");
    await expect(new ConsultaDeCliente(p).find("011900000101")).rejects.toThrow(/navegação/);
    expect(p.chamadas.at(-1)).toBe("voltarParaVoiceCallStatus");
  });

  it("o contrato com a página tem só ações de leitura/navegação (nada de salvar, atualizar ou excluir)", () => {
    const metodos = Object.getOwnPropertyNames(PaginaFalsa.prototype)
      .filter((m) => m !== "constructor" && m !== "passo")
      .sort();
    expect(metodos).toEqual([
      "abrir",
      "abrirEdicaoDoPrimeiro",
      "lerCampos",
      "pesquisarPorTelefone",
      "voltarParaVoiceCallStatus",
    ]);
  });

  it("falha ao voltar para a Voice Call Status não derruba a consulta, mas é avisada", async () => {
    const p = new PaginaFalsa(1, COMPLETO, "voltarParaVoiceCallStatus");
    const falhas: unknown[] = [];
    const r = await new ConsultaDeCliente(p, (e) => falhas.push(e)).find("011900000101");
    expect(r).toMatchObject({ tipo: "ok" });
    expect(falhas).toHaveLength(1);
  });

  it("ponta a ponta com a fila: mensagem sai com os campos faltantes vazios", async () => {
    const previas: string[] = [];
    const log = { debug() {}, info() {}, warn() {}, error() {} };
    const fila = new TaskQueue(
      {
        lookup: new ConsultaDeCliente(
          new PaginaFalsa(1, { nome: "Fulano", phone: "011900000101" }),
        ),
        construtor: criarConstrutor(readFileSync("config/mensagem.txt", "utf8")),
        sender: new EnviadorFalso(),
        log,
        notificador: criarNotificadorFalso(),
      },
      {
        modo: "observacao",
        maxTentativasConsulta: 1,
        maxTentativasEnvio: 1,
        backoffMs: 1,
        ttlTarefasMs: 1e6,
        previa: (t) => previas.push(t),
      },
    );
    fila.enqueue({
      tipo: "transferencia",
      ocorrencia: "o1",
      chave: "k",
      vinculo: "v-k",
      fase: "agent",
      callback: "908112",
      callee: "011900000101",
    });
    await fila.drenar();
    expect(fila.todas[0]?.estado).toBe("observada");
    expect(previas[0]).toBe(
      [
        "NAME: Fulano",
        "CPF : ",
        "Location: ",
        "Age: ",
        "Occupation: ",
        "Ph: 011900000101",
        "Line 1 number: 908112",
        "NOTE:",
      ].join("\n"),
    );
  });
});
