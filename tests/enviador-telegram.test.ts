import { describe, expect, it } from "vitest";
import {
  FalhaTelegram,
  FloodWaitTelegram,
  destinoEhTitulo,
  escolherPorTitulo,
  type ClienteTelegram,
  type MensagemRecente,
} from "../src/telegram/cliente.js";
import { EnviadorTelegram } from "../src/telegram/enviador-telegram.js";

/** Cliente falso: tudo fictício. */
class ClienteFalso implements ClienteTelegram {
  enviadas: string[] = [];
  respostas: Array<"ok" | Error | "trava"> = [];
  recentes: MensagemRecente[] = [];
  falhaNaLeitura = false;
  async enviar(_d: string, texto: string) {
    this.enviadas.push(texto);
    const r = this.respostas.shift() ?? "ok";
    if (r instanceof Error) throw r;
    if (r === "trava") return new Promise<never>(() => undefined);
    return { id: 7, data: 1000 };
  }
  async mensagensRecentes() {
    if (this.falhaNaLeitura) throw new Error("rede");
    return this.recentes;
  }
  async dialogos() {
    return [];
  }
  async encerrar() {}
}

function criar(c: ClienteFalso, extra: { dormidos?: number[] } = {}) {
  return new EnviadorTelegram(c, {
    destino: "me",
    timeoutEnvioMs: 50,
    esperaMaximaFloodMs: 10_000,
    esperaAntesDeVerificarMs: 0,
    dormir: async (ms) => {
      extra.dormidos?.push(ms);
    },
    agora: () => 1000,
  });
}

describe("EnviadorTelegram", () => {
  it("sucesso → enviada", async () => {
    const c = new ClienteFalso();
    expect(await criar(c).send("oi", "k1")).toEqual({ tipo: "enviada", confirmacao: "telegram:7" });
    expect(c.enviadas).toEqual(["oi"]);
  });

  it("FLOOD_WAIT curto: espera e repete uma vez", async () => {
    const c = new ClienteFalso();
    c.respostas = [new FloodWaitTelegram(2)];
    const dormidos: number[] = [];
    const r = await criar(c, { dormidos }).send("oi", "k");
    expect(r.tipo).toBe("enviada");
    expect(c.enviadas).toHaveLength(2);
    expect(dormidos).toEqual([2500]);
  });

  it("FLOOD_WAIT longo: falha sem reenviar sozinho", async () => {
    const c = new ClienteFalso();
    c.respostas = [new FloodWaitTelegram(3600)];
    expect(await criar(c).send("oi", "k")).toEqual({
      tipo: "falhou",
      motivo: "flood_wait_3600s",
      reenviavel: false,
    });
    expect(c.enviadas).toHaveLength(1);
  });

  it("falha definitiva → falhou", async () => {
    const c = new ClienteFalso();
    c.respostas = [new FalhaTelegram("destino_invalido_ou_sem_permissao")];
    expect(await criar(c).send("oi", "k")).toMatchObject({ tipo: "falhou", reenviavel: false });
  });

  it("timeout → incerta, e NÃO reenvia", async () => {
    const c = new ClienteFalso();
    c.respostas = ["trava"];
    expect(await criar(c).send("oi", "k")).toEqual({ tipo: "incerta", motivo: "timeout_no_envio" });
    expect(c.enviadas).toHaveLength(1);
  });

  it("erro inesperado → incerta", async () => {
    const c = new ClienteFalso();
    c.respostas = [new Error("socket fechou")];
    expect(await criar(c).send("oi", "k")).toMatchObject({ tipo: "incerta" });
  });

  it("verify: encontra a mensagem, não encontra, ou indeterminado", async () => {
    const c = new ClienteFalso();
    c.respostas = ["trava", "trava", "trava"];
    const e = criar(c);
    await e.send("texto A", "a");
    await e.send("texto B", "b");
    await e.send("texto C", "c");
    c.recentes = [
      { id: 1, texto: "texto A", data: 1001 },
      { id: 2, texto: "texto B", data: 500 }, // antiga: não conta
    ];
    expect(await e.verify("a")).toBe("entregue");
    expect(await e.verify("b")).toBe("nao_encontrada");
    c.falhaNaLeitura = true;
    expect(await e.verify("c")).toBe("indeterminado");
    expect(await e.verify("desconhecida")).toBe("indeterminado");
  });
});

describe("destino por título (inclui chinês)", () => {
  const titulos = ["Família", "启航 Line 1 transfer一线送单（印度尼西亚）", "启航 Line 2 transfer"];
  it("reconhece título em chinês, ignorando caixa/espaços e largura de caracteres", () => {
    expect(destinoEhTitulo("启航 Line 1 transfer一线送单（印度尼西亚）")).toBe(true);
    expect(escolherPorTitulo(titulos, "启航 Line 1 transfer一线送单（印度尼西亚）")).toBe(1);
    expect(escolherPorTitulo(titulos, "启航  line 1 TRANSFER一线送单(印度尼西亚)")).toBe(1);
  });
  it("aceita um trecho único; recusa ambíguo ou inexistente", () => {
    expect(escolherPorTitulo(titulos, "Line 1")).toBe(1);
    expect(() => escolherPorTitulo(titulos, "启航")).toThrow(/ambiguo/);
    expect(() => escolherPorTitulo(titulos, "xyz")).toThrow(/nao_encontrado/);
  });
  it("me, ID, @usuario e link não são títulos", () => {
    for (const d of ["me", "-1001234567890", "@alguem", "+5511999990000", "https://t.me/x"])
      expect(destinoEhTitulo(d)).toBe(false);
  });
});
