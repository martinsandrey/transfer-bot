import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { CustomerLookup, ResultadoBusca } from "../src/dominio/tipos.js";
import { TaskQueue, type EstadoTarefa } from "../src/fila/task-queue.js";
import { criarConstrutor } from "../src/mensagem/construtor.js";
import type { EventoTracker } from "../src/monitor/call-tracker.js";
import { criarNotificadorFalso } from "../src/notificador/notificador.js";
import {
  FalhaTelegram,
  FloodWaitTelegram,
  type ClienteTelegram,
  type MensagemRecente,
} from "../src/telegram/cliente.js";
import { EnviadorTelegram } from "../src/telegram/enviador-telegram.js";

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Telegram falso com caos: falhas de todo tipo; o que "chegou ao grupo" fica em `entregues`. */
class TelegramCaos implements ClienteTelegram {
  entregues: Array<{ id: number; texto: string; respondeA?: number | undefined }> = [];
  emVoo = 0;
  maxEmVoo = 0;
  constructor(
    private readonly r: () => number,
    private readonly taxa: number,
  ) {}
  async enviar(_d: string, texto: string, responderAId?: number) {
    this.emVoo++;
    this.maxEmVoo = Math.max(this.maxEmVoo, this.emVoo);
    try {
      await Promise.resolve();
      const x = this.r();
      if (x < this.taxa * 0.2) throw new FloodWaitTelegram(2);
      if (x < this.taxa * 0.3) throw new FloodWaitTelegram(7200);
      if (x < this.taxa * 0.4) throw new FalhaTelegram("destino_invalido_ou_sem_permissao");
      if (x < this.taxa * 0.6) throw new Error("rede caiu antes de enviar"); // nada chegou
      const entrega = (): number => {
        const id = this.entregues.length + 1;
        this.entregues.push({ id, texto, respondeA: responderAId });
        return id;
      };
      if (x < this.taxa * 0.8) {
        entrega(); // chegou, mas a resposta se perdeu
        throw new Error("resposta perdida");
      }
      if (x < this.taxa) return new Promise<never>(() => undefined); // trava (timeout): nada chegou
      return { id: entrega(), data: 2_000_000_000 };
    } finally {
      this.emVoo--;
    }
  }
  falhaLeitura = 0;
  async mensagensRecentes(): Promise<MensagemRecente[]> {
    if (this.r() < this.falhaLeitura) throw new Error("sem rede para ler");
    return this.entregues.map((e) => ({ id: e.id, texto: e.texto, data: 2_000_000_000 }));
  }
  async lerMensagem(_d: string, id: number) {
    if (this.r() < this.falhaLeitura) throw new Error("sem rede");
    return this.entregues.find((e) => e.id === id)?.texto ?? null;
  }
  async dialogos() {
    return [];
  }
  async encerrar() {}
}

const TERMINAIS: EstadoTarefa[] = ["enviada", "observada", "ignorada", "falhou", "incerta"];

describe("caos na fila + Telegram (semente fixa, muitas execuções)", () => {
  it("invariantes: nada fica preso, nunca 2 em paralelo, nenhuma mensagem duplicada ou trocada, CALLBACK só após transferência entregue", async () => {
    let tarefasEnviadas = 0;
    let incertas = 0;
    for (let seed = 1; seed <= 120; seed++) {
      const r = rng(seed);
      const tg1 = new TelegramCaos(r, r() < 0.5 ? 0.35 : 0.0);
      const tg2 = new TelegramCaos(r, r() < 0.5 ? 0.35 : 0.0);
      tg1.falhaLeitura = r() < 0.3 ? 0.3 : 0;
      tg2.falhaLeitura = tg1.falhaLeitura;
      const mk = (c: TelegramCaos): EnviadorTelegram =>
        new EnviadorTelegram(c, {
          destino: "g",
          timeoutEnvioMs: 5,
          esperaMaximaFloodMs: 5000,
          esperaAntesDeVerificarMs: 0,
          dormir: async () => undefined,
          agora: () => 2_000_000_000,
        });
      let lookupsEmVoo = 0;
      let maxLookups = 0;
      const lookup: CustomerLookup = {
        find: async (callee): Promise<ResultadoBusca> => {
          lookupsEmVoo++;
          maxLookups = Math.max(maxLookups, lookupsEmVoo);
          try {
            await Promise.resolve();
            const x = r();
            if (x < 0.08) throw new Error("página travou");
            if (x < 0.14) return { tipo: "nenhum" };
            if (x < 0.18) return { tipo: "telefone_divergente" };
            return {
              tipo: "ok",
              registro: { nome: "N", cpf: "C", location: "L", age: "1", phone: callee },
              multiplos: false,
            };
          } finally {
            lookupsEmVoo--;
          }
        },
      };
      const notif = criarNotificadorFalso();
      const fila = new TaskQueue(
        {
          lookup,
          construtor: criarConstrutor(readFileSync("config/mensagem.txt", "utf8")),
          sender: mk(tg1),
          senderLonga: mk(tg2),
          log: { debug() {}, info() {}, warn() {}, error() {} },
          notificador: notif,
        },
        {
          modo: "live",
          maxTentativasConsulta: 2,
          maxTentativasEnvio: 3,
          backoffMs: 1,
          ttlTarefasMs: 1e9,
          pausaEntreTarefasMs: 0,
          dormir: async () => undefined,
          validadeMensagemMs: 0,
        },
      );

      const criadas: Array<{ id: string; tipo: string; vinculo: string; callback: string }> = [];
      for (let rodada = 0; rodada < 6; rodada++) {
        const n = 1 + Math.floor(r() * 3);
        for (let k = 0; k < n; k++) {
          const i = rodada * 10 + k;
          const callback = `1${String(i).padStart(5, "0")}`;
          const callee = `0119${String(i).padStart(8, "0")}`;
          const vinc = `${callback}|T${i}`;
          const base = { ocorrencia: "o", callback, callee, vinculo: vinc };
          const tipos = r();
          const evs: Array<
            Extract<EventoTracker, { tipo: "transferencia" | "ligacao_longa" | "callback" }>
          > = [];
          if (tipos < 0.25) evs.push({ tipo: "ligacao_longa", chave: `L${i}`, ...base });
          if (tipos >= 0.15 && tipos < 0.9)
            evs.push({ tipo: "transferencia", chave: `T${i}`, fase: "ringing", ...base });
          if (tipos >= 0.6) evs.push({ tipo: "callback", chave: `C${i}`, ...base });
          for (const e of evs) {
            const t = fila.enqueue(e);
            if (t) criadas.push({ id: t.id, tipo: t.tipo, vinculo: vinc, callback });
          }
        }
        void fila.drenar();
        if (r() < 0.5) await fila.drenar();
      }
      await fila.drenar();
      const pend = await fila.encerrar();
      void pend;

      // ---- invariantes ----
      expect(maxLookups, `semente ${seed}: consultas em paralelo`).toBeLessThanOrEqual(1);
      expect(tg1.maxEmVoo, `semente ${seed}: envios em paralelo (grupo 1)`).toBeLessThanOrEqual(1);
      expect(tg2.maxEmVoo, `semente ${seed}: envios em paralelo (grupo 2)`).toBeLessThanOrEqual(1);
      for (const t of fila.todas) {
        expect(TERMINAIS, `semente ${seed}: tarefa ${t.id} presa em ${t.estado}`).toContain(
          t.estado,
        );
        if (t.estado === "enviada") tarefasEnviadas++;
        if (t.estado === "incerta") incertas++;
      }
      // textos entregues: cada mensagem tem o Line 1 number da PRÓPRIA tarefa; nenhuma entregue 2× o mesmo texto de transferência/5 min
      const todos = [
        ...tg1.entregues.map((e) => ({ ...e, g: 1 })),
        ...tg2.entregues.map((e) => ({ ...e, g: 2 })),
      ];
      for (const c of criadas) {
        const t = fila.get(c.id);
        if (!t) continue;
        const grupo = c.tipo === "longa" ? tg2 : tg1;
        const meus = grupo.entregues.filter((e) =>
          c.tipo === "callback"
            ? e.respondeA !== undefined || e.texto.includes(`Line 1 number: ${c.callback}`)
            : e.texto.includes(`Line 1 number: ${c.callback}`),
        );
        if (c.tipo !== "callback") {
          expect(
            meus.length,
            `semente ${seed}: ${c.tipo} ${c.id} entregue ${meus.length}×`,
          ).toBeLessThanOrEqual(
            c.tipo === "transferencia" ? 2 : 1, // transferência pode reaproveitar a mensagem de 5 min (mesmo texto, outro grupo)
          );
        }
        if (t.estado === "enviada" && c.tipo !== "callback") {
          expect(
            meus.length,
            `semente ${seed}: ${c.id} marcada enviada mas nada chegou`,
          ).toBeGreaterThanOrEqual(1);
        }
      }
      // CALLBACK só é entregue se a transferência da mesma ligação foi entregue antes
      for (const c of criadas.filter((x) => x.tipo === "callback")) {
        const t = fila.get(c.id);
        if (t?.estado !== "enviada") continue;
        const trans = criadas.find((x) => x.tipo === "transferencia" && x.vinculo === c.vinculo);
        expect(trans, `semente ${seed}: CALLBACK sem transferência`).toBeDefined();
        expect(
          fila.get(trans?.id ?? "")?.estado,
          `semente ${seed}: CALLBACK com transferência não enviada`,
        ).toBe("enviada");
      }
      void todos;
    }
    expect(tarefasEnviadas).toBeGreaterThan(300);
    expect(incertas).toBeGreaterThan(0); // o caos também gera casos incertos de verdade
  }, 120_000);
});
