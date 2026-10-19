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
  respondeuA: Array<number | undefined> = [];
  async enviar(_d: string, texto: string, responderAId?: number) {
    this.respondeuA.push(responderAId);
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
  texto: string | null = "texto atual";
  async lerMensagem() {
    return this.texto;
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
      { id: 2, texto: "texto B", data: 0 }, // muito antiga (mais de 15 min): não conta
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

describe("explicação de falha de envio", () => {
  it("nome ambíguo lista os IDs candidatos", async () => {
    const { descreverFalhaDeEnvio } = await import("../src/fila/task-queue.js");
    const t = descreverFalhaDeEnvio(
      "destino_ambiguo_varias_conversas_com_esse_nome [ids: -1001 (canal), -1002 (grupo)]",
    );
    expect(t).toContain("-1001 (canal), -1002 (grupo)");
    expect(t).toContain("TELEGRAM_DESTINO");
  });
});

describe("grupo antigo (migrado) x grupo novo", () => {
  it("grupo comum novo (migratedTo ausente ou null) NÃO é tratado como antigo", async () => {
    const { Api } = await import("telegram");
    const { ehGrupoAntigo } = await import("../src/telegram/cliente-gramjs.js");
    const novo = (campos: object) =>
      Object.assign(Object.create(Api.Chat.prototype) as object, campos);
    expect(ehGrupoAntigo({ entity: novo({}) as never })).toBe(false);
    expect(ehGrupoAntigo({ entity: novo({ migratedTo: null, deactivated: false }) as never })).toBe(
      false,
    );
    expect(ehGrupoAntigo({ entity: novo({ migratedTo: {} }) as never })).toBe(true);
    expect(ehGrupoAntigo({ entity: novo({ deactivated: true }) as never })).toBe(true);
    expect(ehGrupoAntigo({ entity: {} as never })).toBe(false);
  });
});

describe("reler mensagem enviada (edição feita no grupo)", () => {
  it("devolve o texto atual, 'apagada' ou null", async () => {
    const c = new ClienteFalso();
    const e = criar(c);
    expect(await e.reler("telegram:7")).toBe("texto atual");
    c.texto = null;
    expect(await e.reler("telegram:7")).toBe("apagada");
    expect(await e.reler("console")).toBeNull();
  });
});

describe("enviar como resposta (CALLBACK)", () => {
  it("responde à mensagem indicada", async () => {
    const c = new ClienteFalso();
    const r = await criar(c).send("CALLBACK", "k", {
      responderA: "telegram:42",
      reserva: "CALLBACK\nPh: 1",
    });
    expect(r.tipo).toBe("enviada");
    expect(c.respondeuA).toEqual([42]);
    expect(c.enviadas).toEqual(["CALLBACK"]);
  });

  it("mensagem original apagada: nada foi enviado e o texto de reserva sai sem resposta", async () => {
    const c = new ClienteFalso();
    c.respostas = [new FalhaTelegram("resposta_invalida")];
    const r = await criar(c).send("CALLBACK", "k", {
      responderA: "telegram:42",
      reserva: "CALLBACK\nPh: 1",
    });
    expect(r.tipo).toBe("enviada");
    expect(c.respondeuA).toEqual([42, undefined]);
    expect(c.enviadas.at(-1)).toBe("CALLBACK\nPh: 1"); // (a 1ª tentativa, recusada, também fica registrada no falso)
  });

  it("confirmação que não é do Telegram (ex.: console): envia normal, sem resposta", async () => {
    const c = new ClienteFalso();
    await criar(c).send("CALLBACK", "k", { responderA: "console" });
    expect(c.respondeuA).toEqual([undefined]);
  });
});

describe("duplicatas: conferência robusta (relógio diferente do Telegram, espaços nas pontas)", () => {
  it("mensagem entregue, mas com horário do servidor 40 s ANTES do relógio local: continua 'entregue' (não reenvia)", async () => {
    const c = new ClienteFalso();
    c.respostas = ["trava"];
    const e = criar(c); // agora() = 1000
    await e.send("texto A", "a");
    c.recentes = [{ id: 1, texto: "texto A", data: 960 }]; // servidor 40 s atrás do relógio do PC
    expect(await e.verify("a")).toBe("entregue");
  });

  it("o Telegram tira espaços/linhas em branco das pontas e troca CRLF: ainda reconhece a mensagem", async () => {
    const c = new ClienteFalso();
    c.respostas = ["trava"];
    const e = criar(c);
    await e.send("linha 1\r\nlinha 2  \n\n", "a");
    c.recentes = [{ id: 1, texto: "linha 1\nlinha 2", data: 1001 }];
    expect(await e.verify("a")).toBe("entregue");
  });

  it("guarda anti-duplicata: o MESMO texto não é enviado de novo dentro de 60 s; depois disso, sim (nova ligação igual)", async () => {
    const c = new ClienteFalso();
    let agora = 1000;
    const e = new EnviadorTelegram(c, {
      destino: "me",
      timeoutEnvioMs: 50,
      esperaMaximaFloodMs: 10_000,
      esperaAntesDeVerificarMs: 0,
      dormir: async () => undefined,
      agora: () => agora,
    });
    expect((await e.send("igual", "k1")).tipo).toBe("enviada");
    agora += 30;
    const r2 = await e.send("igual", "k2"); // outra tarefa, mesmo texto, 30 s depois
    expect(r2.tipo).toBe("enviada");
    expect(c.enviadas).toEqual(["igual"]); // não foi ao Telegram de novo
    agora += 31; // 61 s depois da 1ª
    await e.send("igual", "k3");
    expect(c.enviadas).toEqual(["igual", "igual"]);
  });

  it("a guarda não confunde textos diferentes nem responde com 'enviada' uma mensagem que falhou", async () => {
    const c = new ClienteFalso();
    c.respostas = [new FalhaTelegram("destino_invalido_ou_sem_permissao")];
    const e = criar(c);
    expect((await e.send("x", "k1")).tipo).toBe("falhou");
    expect((await e.send("x", "k2")).tipo).toBe("enviada"); // a 1ª falhou: a 2ª tem de ir de verdade
    expect(c.enviadas).toEqual(["x", "x"]);
    await e.send("y", "k3");
    expect(c.enviadas).toEqual(["x", "x", "y"]);
  });
});
