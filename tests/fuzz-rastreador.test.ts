import { describe, expect, it } from "vitest";
import type { CallRow, TableSnapshot } from "../src/dominio/tipos.js";
import { CallTracker, type EventoTracker } from "../src/monitor/call-tracker.js";

/** Gerador pseudoaleatório com semente (reprodutível). */
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

type Fase = "s1ring" | "s1agent" | "s3ring" | "s3agent";
interface Ligacao {
  callee: string;
  cb1: string;
  cb3: string[];
  inicio: number;
  // linha do tempo em segundos relativos: quando cada coisa acontece
  s1ring: number;
  s1agent: number;
  s1fim: number;
  toca?: number; // Stage 3 Ringing aparece
  atende?: number; // Stage 3 Agent
  fim3: number;
  trocaDeAgente?: number; // segundo em que o toque passa a outro agente
  /** Intervalo (segundos) em que NENHUMA linha de Stage 3 aparece: o toque passa de um agente a outro. */
  lacuna?: { ini: number; fim: number };
}

function gerarLigacao(r: () => number, i: number, t0: number): Ligacao {
  const inicio = t0 + Math.floor(r() * 60);
  const s1ring = inicio;
  const s1agent = s1ring + 2 + Math.floor(r() * 8);
  const transfere = r() < 0.6;
  const s1fim = s1agent + (transfere ? 5 + Math.floor(r() * 30) : 3 + Math.floor(r() * 400));
  const base: Ligacao = {
    callee: `0119${String(i).padStart(8, "0")}`,
    cb1: `1${String(i % 90000).padStart(5, "0")}`,
    cb3: [`9${String(i % 90000).padStart(5, "0")}`, `8${String(i % 90000).padStart(5, "0")}`],
    inicio,
    s1ring,
    s1agent,
    s1fim,
    fim3: s1fim,
  };
  if (transfere) {
    const toca = s1fim - 3 - Math.floor(r() * 3); // o Stage 3 surge um pouco antes do Stage 1 sumir
    base.toca = toca;
    if (r() < 0.7) {
      base.atende = toca + 4 + Math.floor(r() * 14);
      base.fim3 = base.atende + 5 + Math.floor(r() * 300);
      if (r() < 0.35) {
        const ini = toca + 2;
        base.lacuna = { ini, fim: ini + 1 + Math.floor(r() * 2) }; // 1 ou 2 s sem linha (menos que a espera de 3 s)
        base.trocaDeAgente = base.lacuna.fim;
      }
    } else {
      base.fim3 = toca + 4 + Math.floor(r() * 14); // ninguém atendeu
      if (r() < 0.3) base.trocaDeAgente = toca + 2 + Math.floor(r() * 3);
    }
  }
  return base;
}

function linhasDe(
  l: Ligacao,
  s: number,
  dur: (n: number) => number,
): Array<{ row: CallRow; fase: Fase }> {
  const out: Array<{ row: CallRow; fase: Fase }> = [];
  if (s >= l.s1ring && s < l.s1fim) {
    const fase: Fase = s < l.s1agent ? "s1ring" : "s1agent";
    out.push({
      fase,
      row: {
        callbackNumber: l.cb1,
        calleeNumber: l.callee,
        callStatus: fase === "s1ring" ? "Stage 1 Ringing" : "Stage 1 Agent",
        startTime: `S${l.inicio}`,
        callDurationSec: dur(s - l.s1ring),
      },
    });
  }
  const naLacuna = l.lacuna !== undefined && s >= l.lacuna.ini && s < l.lacuna.fim;
  if (l.toca !== undefined && s >= l.toca && s < l.fim3 && !naLacuna) {
    const atendida = l.atende !== undefined && s >= l.atende;
    const cb = l.trocaDeAgente !== undefined && s >= l.trocaDeAgente ? l.cb3[1] : l.cb3[0];
    out.push({
      fase: atendida ? "s3agent" : "s3ring",
      row: {
        callbackNumber: cb as string,
        calleeNumber: l.callee,
        callStatus: atendida ? "Stage 3 Agent" : "Stage 3 Ringing",
        startTime: `U${l.toca}`,
        callDurationSec: 0,
      },
    });
  }
  return out;
}

describe("fuzz do rastreador (semente fixa, muitas execuções)", () => {
  it("invariantes: no máx. 1 transferência/CALLBACK/5 min por ligação; CALLBACK nunca depois de atendida; sem exceções", () => {
    let totalTransf = 0;
    let totalCallback = 0;
    let totalLongas = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const r = rng(seed);
      const ligacoes = Array.from({ length: 12 }, (_, i) => gerarLigacao(r, i, 0));
      const t = new CallTracker({
        leiturasConfirmacao: 2,
        ausenciaMaxLeituras: 3,
        ttlOcorrenciasMs: 3_600_000,
        duracaoLongaSeg: 300,
        esperaCallbackMs: 3000,
      });
      const eventos: Array<{ ev: EventoTracker; s: number }> = [];
      const agenteVistoPorCallee = new Map<string, number>(); // 1º segundo em que um Stage 3 Agent apareceu
      const s1AgentVisto = new Set<string>();
      let cegoAte = -1;
      for (let s = 0; s < 900; s++) {
        // janelas sem leitura (consulta ao cadastro) e leituras inválidas, ao acaso
        if (r() < 0.01) cegoAte = s + 3 + Math.floor(r() * 12);
        if (s <= cegoAte) {
          if (s === cegoAte) t.marcarJanelaSemLeitura();
          continue; // nenhuma leitura neste segundo
        }
        if (r() < 0.02) {
          t.ingest({ readAt: s * 1000, rows: [], valid: false, invalidReason: "x" });
          continue;
        }
        const rows: CallRow[] = [];
        const stage3Parciais: Array<{ calleeNumber: string; agent: boolean }> = [];
        let ignoradas = 0;
        for (const l of ligacoes) {
          for (const { row, fase } of linhasDe(l, s, (n) => n)) {
            if (fase === "s3agent" && !agenteVistoPorCallee.has(row.calleeNumber))
              agenteVistoPorCallee.set(row.calleeNumber, s);
            if (fase === "s1agent") s1AgentVisto.add(row.calleeNumber);
            const falta = r() < 0.03; // a tabela às vezes vem com dado faltando: o leitor ignora a linha
            if (falta) {
              ignoradas++;
              if (fase.startsWith("s3"))
                stage3Parciais.push({ calleeNumber: row.calleeNumber, agent: fase === "s3agent" });
            } else rows.push(row);
          }
        }
        // linha de lixo ocasional
        if (r() < 0.05)
          rows.push({
            callbackNumber: "777777",
            calleeNumber: "0000",
            callStatus: ["Stage 9 X", "Stage 2 Agent", "Stage 4 Ringing", "???"][
              Math.floor(r() * 4)
            ] as string,
            startTime: "Z",
            callDurationSec: null,
          });
        const snap: TableSnapshot = {
          readAt: s * 1000,
          rows,
          valid: true,
          ...(ignoradas ? { rowsIgnored: ignoradas } : {}),
          ...(stage3Parciais.length ? { stage3Parciais } : {}),
        };
        for (const ev of t.ingest(snap)) eventos.push({ ev, s });
      }
      // ---- invariantes ----
      const cont = (tipo: string): Map<string, number> => {
        const m = new Map<string, number>();
        for (const { ev } of eventos)
          if (ev.tipo === tipo && "vinculo" in ev) m.set(ev.vinculo, (m.get(ev.vinculo) ?? 0) + 1);
        return m;
      };
      for (const tipo of ["transferencia", "callback", "ligacao_longa"]) {
        for (const [v, n] of cont(tipo))
          expect(n, `semente ${seed}: ${tipo} repetido para ${v}`).toBe(1);
      }
      const chaves = eventos
        .map((e) => ("chave" in e.ev ? `${e.ev.tipo}:${e.ev.chave}` : null))
        .filter(Boolean);
      expect(new Set(chaves).size, `semente ${seed}: chaves repetidas`).toBe(chaves.length);
      const transfPorVinculo = new Map<string, number>();
      for (const { ev, s } of eventos)
        if (ev.tipo === "transferencia") transfPorVinculo.set(ev.vinculo, s);
      for (const { ev, s } of eventos) {
        if (ev.tipo === "callback") {
          expect(
            transfPorVinculo.has(ev.vinculo),
            `semente ${seed}: CALLBACK sem transferência`,
          ).toBe(true);
          expect(transfPorVinculo.get(ev.vinculo) as number, `semente ${seed}`).toBeLessThanOrEqual(
            s,
          );
          // nunca CALLBACK de uma ligação que foi atendida ANTES do CALLBACK ter sido decidido
          const visto = agenteVistoPorCallee.get(ev.callee);
          if (visto !== undefined)
            expect(
              visto,
              `semente ${seed}: CALLBACK de ligação atendida (callee ${ev.callee})`,
            ).toBeGreaterThan(s - 1);
        }
        if (ev.tipo === "transferencia") {
          expect(
            s1AgentVisto.has(ev.callee),
            `semente ${seed}: transferência sem Stage 1 Agent`,
          ).toBe(true);
        }
      }
      // ligação atendida por um 2º agente depois de uma lacuna curta: NUNCA pode gerar CALLBACK
      const cbVinc = cont("callback");
      for (const l of ligacoes) {
        if (l.lacuna && l.atende !== undefined) {
          for (const [v] of cbVinc)
            expect(
              v.startsWith(`${l.cb1}|`),
              `semente ${seed}: CALLBACK falso (lacuna curta, ligação atendida)`,
            ).toBe(false);
        }
      }
      totalTransf += cont("transferencia").size;
      totalCallback += cont("callback").size;
      totalLongas += cont("ligacao_longa").size;
    }
    // o gerador realmente exercitou os três caminhos
    expect(totalTransf).toBeGreaterThan(300);
    expect(totalCallback).toBeGreaterThan(20);
    expect(totalLongas).toBeGreaterThan(50);
  }, 120_000);
});
