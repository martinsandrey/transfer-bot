import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { CustomerLookup } from "../src/dominio/tipos.js";
import { TaskQueue, type OpcoesFila } from "../src/fila/task-queue.js";
import { criarConstrutor } from "../src/mensagem/construtor.js";
import { EnviadorFalso } from "../src/mensagem/enviadores.js";
import type { EventoTracker } from "../src/monitor/call-tracker.js";
import { criarNotificador, criarNotificadorFalso } from "../src/notificador/notificador.js";
import { criarToastWindows, linkSeguro, scriptDoToast } from "../src/notificador/toast-windows.js";
import { linkDaMensagem, type ClienteTelegram } from "../src/telegram/cliente.js";
import { EnviadorTelegram } from "../src/telegram/enviador-telegram.js";

const LINK_PRIVADO = "tg://privatepost?channel=1234567890&post=77";
const LINK_PUBLICO = "tg://resolve?domain=grupo_transf&post=77";

describe("link da mensagem do Telegram (tg://)", () => {
  it("supergrupo privado usa privatepost com o ID sem o prefixo -100; público usa o @usuário", () => {
    expect(linkDaMensagem({ canalId: "1234567890" }, 77)).toBe(LINK_PRIVADO);
    expect(linkDaMensagem({ canalId: "1234567890", usuario: "grupo_transf" }, 77)).toBe(
      LINK_PUBLICO,
    );
  });
  it("sem link para grupo comum/conversa privada, usuário inválido sem ID, ou mensagem inválida", () => {
    expect(linkDaMensagem(null, 77)).toBeUndefined();
    expect(linkDaMensagem({ canalId: "abc" }, 77)).toBeUndefined();
    expect(linkDaMensagem({ canalId: "1", usuario: "a b" }, 77)).toBe(
      "tg://privatepost?channel=1&post=77",
    );
    expect(linkDaMensagem({ canalId: "1" }, 0)).toBeUndefined();
    expect(linkDaMensagem({ canalId: "1" }, 1.5)).toBeUndefined();
  });
  it("linkSeguro só aceita os dois formatos do Telegram", () => {
    expect(linkSeguro(LINK_PRIVADO)).toBe(LINK_PRIVADO);
    expect(linkSeguro(LINK_PUBLICO)).toBe(LINK_PUBLICO);
    for (const ruim of [
      undefined,
      "",
      "https://exemplo.invalid/",
      "file:///C:/Windows/System32/calc.exe",
      "tg://resolve?domain=abc&post=1",
      'tg://privatepost?channel=1&post=2"><x/>',
      "tg://privatepost?channel=1&post=2&x=3",
      "tg://privatepost?channel=1&post=2\n",
    ])
      expect(linkSeguro(ruim)).toBeUndefined();
  });
});

describe("toast clicável", () => {
  const b64 = (s: string) =>
    [...s.matchAll(/FromBase64String\('([A-Za-z0-9+/=]+)'\)/g)].map((m) =>
      Buffer.from(m[1] as string, "base64").toString("utf8"),
    );
  it("com link: o script abre o endereço ao clicar (protocolo) e tem o botão 'Abrir no Telegram'", () => {
    const s = scriptDoToast("T", "texto", LINK_PRIVADO);
    expect(b64(s)).toEqual(["T", "texto", LINK_PRIVADO]);
    expect(s).toContain('activationType="protocol" launch="');
    expect(s).toContain("Abrir no Telegram");
    expect(s).not.toContain(LINK_PRIVADO); // o endereço só entra em base64
  });
  it("sem link (ou link inválido): toast comum, como antes", () => {
    for (const l of [undefined, "https://exemplo.invalid/", 'tg://x"><y/>']) {
      const s = scriptDoToast("T", "texto", l);
      expect(b64(s)).toEqual(["T", "texto"]);
      expect(s).toContain("$u = $null");
    }
  });
  it("criarToastWindows repassa o link ao PowerShell", () => {
    const chamadas: string[][] = [];
    const fn = ((_: string, args: string[]) => {
      chamadas.push(args);
      return { on() {}, unref() {} };
    }) as never;
    criarToastWindows({ plataforma: "win32", spawnFn: fn })("T", "Enviada", LINK_PRIVADO);
    const script = Buffer.from(
      (chamadas[0] as string[])[(chamadas[0] as string[]).indexOf("-EncodedCommand") + 1] as string,
      "base64",
    ).toString("utf16le");
    expect(b64(script)).toContain(LINK_PRIVADO);
  });
  it("notificador: entrega o link ao toast e `semSom` evita o som", () => {
    const toasts: Array<[string, string, string | undefined]> = [];
    const sons: unknown[] = [];
    const n = criarNotificador({
      toast: (t, m, l) => void toasts.push([t, m, l]),
      toastInformativos: true,
      plataforma: "win32",
      spawnFn: ((...a: unknown[]) => {
        sons.push(a);
        return { on() {}, unref() {} };
      }) as never,
      escrever: () => undefined,
    });
    n.alerta("aviso", "Enviada", { windows: "informativo", link: LINK_PRIVADO, semSom: true });
    expect(toasts).toEqual([["Transfer Bot — atenção", "Enviada", LINK_PRIVADO]]);
    expect(sons).toHaveLength(0);
    n.alerta("aviso", "Outra", { windows: "informativo" });
    expect(toasts[1]).toEqual(["Transfer Bot — atenção", "Outra", undefined]);
    expect(sons).toHaveLength(1);
  });
});

describe("EnviadorTelegram devolve o link da mensagem", () => {
  class Cliente implements ClienteTelegram {
    n = 0;
    constructor(private readonly link: string | undefined) {}
    async enviar() {
      this.n++;
      return { id: 77, data: 1, ...(this.link ? { link: this.link } : {}) };
    }
    async mensagensRecentes() {
      return [];
    }
    async lerMensagem() {
      return null;
    }
    async dialogos() {
      return [];
    }
    async encerrar() {}
  }
  const criar = (c: Cliente) =>
    new EnviadorTelegram(c, {
      destino: "g",
      timeoutEnvioMs: 50,
      esperaMaximaFloodMs: 0,
      agora: () => 1000,
    });
  it("com link, inclusive na repetição barrada pela trava anti-duplicata", async () => {
    const c = new Cliente(LINK_PRIVADO);
    const e = criar(c);
    const esperado = { tipo: "enviada", confirmacao: "telegram:77", link: LINK_PRIVADO };
    expect(await e.send("oi", "k1")).toEqual(esperado);
    expect(await e.send("oi", "k2")).toEqual(esperado);
    expect(c.n).toBe(1);
  });
  it("sem link (grupo comum): resultado igual ao de antes", async () => {
    expect(await criar(new Cliente(undefined)).send("oi", "k")).toEqual({
      tipo: "enviada",
      confirmacao: "telegram:77",
    });
  });
});

describe("fila avisa com link quando a mensagem chega ao grupo", () => {
  const ev = (chave: string): Extract<EventoTracker, { tipo: "transferencia" }> => ({
    tipo: "transferencia",
    ocorrencia: "o1",
    chave,
    vinculo: `v-${chave}`,
    fase: "agent",
    callback: "908113",
    callee: "5521900000101",
  });
  const lookup: CustomerLookup = {
    find: async () => ({
      tipo: "ok",
      registro: { nome: "F", cpf: "1", location: "L", age: "3", phone: "5521900000101" },
      multiplos: false,
    }),
  };
  async function rodar(modo: OpcoesFila["modo"], sender: EnviadorFalso) {
    const notif = criarNotificadorFalso();
    const fila = new TaskQueue(
      {
        lookup,
        construtor: criarConstrutor(readFileSync("config/mensagem.txt", "utf8")),
        sender,
        log: { debug() {}, info() {}, warn() {}, error() {} },
        notificador: notif,
      },
      {
        modo,
        maxTentativasConsulta: 1,
        maxTentativasEnvio: 1,
        backoffMs: 1,
        ttlTarefasMs: 1e6,
      },
    );
    fila.enqueue(ev("k1"));
    await fila.drenar();
    return notif.alertas;
  }
  it("enviada com link: notificação clicável, sem som, nas opções da transferência", async () => {
    const a = await rodar(
      "live",
      new EnviadorFalso([{ tipo: "enviada", confirmacao: "telegram:77", link: LINK_PRIVADO }]),
    );
    expect(a).toHaveLength(1);
    expect(a[0]?.mensagem).toMatch(
      /^Transferência enviada ao grupo: cliente 5521900000101, funcionário 908113\. Clique para abrir no Telegram\.$/,
    );
    expect(a[0]?.opcoes).toEqual({ windows: "informativo", link: LINK_PRIVADO, semSom: true });
  });
  it("sem link, ou em modo observação: nenhuma notificação extra", async () => {
    expect(await rodar("live", new EnviadorFalso())).toEqual([]);
    expect(
      await rodar(
        "observacao",
        new EnviadorFalso([{ tipo: "enviada", confirmacao: "x", link: LINK_PRIVADO }]),
      ),
    ).toEqual([]);
  });
});
