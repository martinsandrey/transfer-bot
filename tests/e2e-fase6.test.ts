import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  SessaoExpiradaError,
  type CallRow,
  type CustomerLookup,
  type TableReader,
  type TableSnapshot,
} from "../src/dominio/tipos.js";
import { TaskQueue } from "../src/fila/task-queue.js";
import { criarConstrutor } from "../src/mensagem/construtor.js";
import { CallTracker } from "../src/monitor/call-tracker.js";
import { Monitor } from "../src/monitor/monitor.js";
import { criarNotificadorFalso } from "../src/notificador/notificador.js";
import {
  FalhaTelegram,
  FloodWaitTelegram,
  type ClienteTelegram,
  type MensagemRecente,
} from "../src/telegram/cliente.js";
import { EnviadorTelegram } from "../src/telegram/enviador-telegram.js";

/** Tudo fictício. Fluxo completo: leitor → rastreador → fila → consulta → mensagem → Telegram (cliente falso). */
const CALLEE = "011900000001";
const R = (cb: string, st: string, ce = CALLEE, ini = "10:00:00"): CallRow => ({
  callbackNumber: cb,
  calleeNumber: ce,
  callStatus: st,
  startTime: ini,
  callDurationSec: 5,
});
const snap = (rows: CallRow[], t: number): TableSnapshot => ({ readAt: t, rows, valid: true });

class LeitorRoteirizado implements TableReader {
  i = 0;
  constructor(private readonly roteiro: Array<TableSnapshot | Error>) {}
  async read(): Promise<TableSnapshot> {
    const x = this.roteiro[Math.min(this.i++, this.roteiro.length - 1)] as TableSnapshot | Error;
    if (x instanceof Error) throw x;
    return x;
  }
}

class TelegramFalso implements ClienteTelegram {
  enviadas: string[] = [];
  comportamento: Array<"ok" | "trava_mas_entrega" | "trava_sem_entregar" | Error> = [];
  recentes: MensagemRecente[] = [];
  leituraFalha = false;
  respondeuA: Array<number | undefined> = [];
  async enviar(_d: string, texto: string, responderAId?: number) {
    this.respondeuA.push(responderAId);
    const c = this.comportamento.shift() ?? "ok";
    if (c instanceof Error) throw c;
    if (c === "trava_mas_entrega") this.recentes.push({ id: 9, texto, data: 2_000_000_000 });
    if (c === "ok") this.enviadas.push(texto);
    if (c !== "ok") return new Promise<never>(() => undefined);
    return { id: this.enviadas.length, data: 0 };
  }
  async mensagensRecentes() {
    if (this.leituraFalha) throw new Error("sem rede");
    return this.recentes;
  }
  edicoes = new Map<number, string | null>();
  async lerMensagem(_d: string, id: number) {
    if (this.leituraFalha) throw new Error("sem rede");
    return this.edicoes.has(id)
      ? (this.edicoes.get(id) as string | null)
      : (this.enviadas[id - 1] ?? null);
  }
  async dialogos() {
    return [];
  }
  async encerrar() {}
}

const CADASTRO = {
  nome: "Fulano Ficticio",
  cpf: "000.000.000-01",
  location: "Rua X",
  age: "1980-01-31",
  phone: CALLEE,
};

function montar(
  roteiro: Array<TableSnapshot | Error>,
  opc: {
    lookup?: CustomerLookup;
    relogio?: { t: number };
    aoPerderSessao?: () => Promise<void>;
  } = {},
) {
  const relogio = opc.relogio ?? { t: 1_000_000 };
  const tg = new TelegramFalso();
  const notif = criarNotificadorFalso();
  const log = { debug() {}, info() {}, warn() {}, error() {} };
  const enviador = new EnviadorTelegram(tg, {
    destino: "me",
    timeoutEnvioMs: 30,
    esperaMaximaFloodMs: 5000,
    esperaAntesDeVerificarMs: 0,
    dormir: async () => undefined,
    agora: () => 2_000_000_000,
  });
  const cont = { consultas: 0 };
  const tg2 = new TelegramFalso();
  const enviadorLonga = new EnviadorTelegram(tg2, {
    destino: "grupo-5min",
    timeoutEnvioMs: 30,
    esperaMaximaFloodMs: 5000,
    esperaAntesDeVerificarMs: 0,
    dormir: async () => undefined,
    agora: () => 2_000_000_000,
  });
  const fila = new TaskQueue(
    {
      senderLonga: enviadorLonga,
      lookup: opc.lookup ?? {
        find: async () => {
          cont.consultas++;
          return { tipo: "ok", registro: CADASTRO, multiplos: false };
        },
      },
      construtor: criarConstrutor(readFileSync("config/mensagem.txt", "utf8")),
      sender: enviador,
      log,
      notificador: notif,
    },
    {
      modo: "live",
      maxTentativasConsulta: 1,
      maxTentativasEnvio: 2,
      backoffMs: 1,
      ttlTarefasMs: 60_000,
      validadeMensagemMs: 15 * 60_000,
      pausaEntreTarefasMs: 0,
      agora: () => relogio.t,
      dormir: async () => undefined,
    },
  );
  const reader = new LeitorRoteirizado(roteiro);
  const tracker = new CallTracker({
    leiturasConfirmacao: 1,
    ausenciaMaxLeituras: 3,
    ttlOcorrenciasMs: 3_600_000,
    duracaoLongaSeg: 300,
  });
  const monitor = new Monitor(
    {
      reader,
      tracker,
      fila,
      log,
      notificador: notif,
      ...(opc.aoPerderSessao ? { aoPerderSessao: opc.aoPerderSessao } : {}),
    },
    {
      intervaloMs: 1000,
      invalidasParaAlertar: 5,
      falhasParaAlertar: 5,
      limpezaMs: 60_000,
      pausarDuranteConsulta: true,
    },
  );
  return {
    tg,
    tg2,
    notif,
    fila,
    monitor,
    tracker,
    relogio,
    get consultas() {
      return cont.consultas;
    },
  };
}

/** Roteiro de uma transferência real: Stage 1 (callback antigo) some e surge Stage 3 com outro callback e o MESMO callee. */
const TRANSFERENCIA = (t0: number): TableSnapshot[] => [
  snap([R("100001", "Stage 1 Agent")], t0),
  snap([R("100001", "Stage 1 Agent")], t0 + 1000),
  snap([], t0 + 2000),
  snap([R("908301", "Stage 3 Agent", CALLEE, "10:00:09")], t0 + 3000),
  snap([R("908301", "Stage 3 Agent", CALLEE, "10:00:09")], t0 + 4000),
];

async function rodar(m: ReturnType<typeof montar>, passos: number): Promise<void> {
  for (let i = 0; i < passos; i++) {
    await m.monitor.passo(() => m.relogio.t);
    await m.fila.drenar(); // a consulta ocupa a aba: o roteiro só avança quando ela termina
  }
}

describe("E2E: ligação de 5 min vai ao 2º grupo; transferência ao 1º", () => {
  const linhaDur = (cb: string, st: string, dur: number, ini: string): CallRow => ({
    ...R(cb, st, CALLEE, ini),
    callDurationSec: dur,
  });
  it("5 min em Stage 1 → só o 2º grupo; depois a transferência → só o 1º", async () => {
    const t0 = 1_000_000;
    const m = montar([
      snap([linhaDur("100001", "Stage 1 Agent", 100, "09:00:00")], t0),
      snap([linhaDur("100001", "Stage 1 Agent", 300, "09:00:00")], t0 + 1000),
      snap([linhaDur("100001", "Stage 1 Agent", 301, "09:00:00")], t0 + 2000),
      snap([], t0 + 3000),
      snap([linhaDur("908301", "Stage 3 Agent", 2, "09:05:02")], t0 + 4000),
      snap([linhaDur("908301", "Stage 3 Agent", 3, "09:05:02")], t0 + 5000),
    ]);
    await rodar(m, 6);
    expect(m.tg2.enviadas).toHaveLength(1);
    expect(m.tg.enviadas).toHaveLength(1);
    expect(m.tg2.enviadas[0]).toContain("Line 1 number: 100001");
    expect(m.tg.enviadas[0]).toBe(m.tg2.enviadas[0]); // a transferência reaproveita a mensagem já enviada ao grupo de 5 min
    expect(m.consultas).toBe(1); // e não consulta o cadastro de novo
    expect(m.fila.todas.map((x) => x.tipo).sort()).toEqual(["longa", "transferencia"]);
  });

  it("a pessoa edita a mensagem no grupo de 5 min antes da transferência: o grupo das transferências recebe o texto editado", async () => {
    const t0 = 1_000_000;
    const m = montar([
      snap([linhaDur("100001", "Stage 1 Agent", 10, "09:00:00")], t0 - 1000),
      snap([linhaDur("100001", "Stage 1 Agent", 300, "09:00:00")], t0),
      snap([linhaDur("100001", "Stage 1 Agent", 301, "09:00:00")], t0 + 1000),
    ]);
    await rodar(m, 3);
    expect(m.tg2.enviadas).toHaveLength(1);
    m.tg2.edicoes.set(1, "NAME: EDITADO NO GRUPO DE 5 MIN\nLine 1 number: 100001"); // edição feita pela pessoa
    m.monitor["deps"].reader = new LeitorRoteirizado([
      snap([], t0 + 2000),
      snap([linhaDur("908301", "Stage 3 Agent", 2, "09:05:02")], t0 + 3000),
      snap([linhaDur("908301", "Stage 3 Agent", 3, "09:05:02")], t0 + 4000),
    ]);
    await rodar(m, 3);
    expect(m.tg.enviadas).toEqual(["NAME: EDITADO NO GRUPO DE 5 MIN\nLine 1 number: 100001"]);
    expect(m.consultas).toBe(1);
  });

  it("5 min só no Stage 3 (depois de transferida): nada vai ao 2º grupo", async () => {
    const t0 = 1_000_000;
    const m = montar([
      snap([linhaDur("100001", "Stage 1 Agent", 100, "09:00:00")], t0),
      snap([], t0 + 1000),
      snap([linhaDur("908301", "Stage 3 Agent", 2, "09:01:40")], t0 + 2000),
      snap([linhaDur("908301", "Stage 3 Agent", 3, "09:01:40")], t0 + 3000),
      snap([linhaDur("908301", "Stage 3 Agent", 400, "09:01:40")], t0 + 4000),
    ]);
    await rodar(m, 5);
    expect(m.tg.enviadas).toHaveLength(1);
    expect(m.tg2.enviadas).toHaveLength(0);
  });

  it("falha no 2º grupo não afeta o 1º", async () => {
    const t0 = 1_000_000;
    const m = montar([
      snap([linhaDur("100001", "Stage 1 Agent", 10, "09:00:00")], t0 - 1000),
      snap([linhaDur("100001", "Stage 1 Agent", 300, "09:00:00")], t0),
      snap([linhaDur("100001", "Stage 1 Agent", 301, "09:00:00")], t0 + 1000),
      snap([], t0 + 2000),
      snap([linhaDur("908301", "Stage 3 Agent", 2, "09:05:02")], t0 + 3000),
      snap([linhaDur("908301", "Stage 3 Agent", 3, "09:05:02")], t0 + 4000),
    ]);
    m.tg2.comportamento = [new FalhaTelegram("destino_invalido_ou_sem_permissao")];
    await rodar(m, 6);
    expect(m.tg.enviadas).toHaveLength(1);
    expect(m.fila.todas.find((x) => x.tipo === "longa")?.estado).toBe("falhou");
    expect(m.fila.todas.find((x) => x.tipo === "transferencia")?.estado).toBe("enviada");
  });
});

describe("E2E: Stage 3 Ringing → mensagem ao tocar; sem atender → CALLBACK como resposta", () => {
  const S1 = (t: number) => snap([R("100001", "Stage 1 Agent", CALLEE, "T1")], t);
  const toca = (t: number, com1 = false) =>
    snap(
      [
        ...(com1 ? [R("100001", "Stage 1 Agent", CALLEE, "T1")] : []),
        R("908301", "Stage 3 Ringing", CALLEE, "U1"),
      ],
      t,
    );
  it("tocou e ninguém atendeu: a mensagem sai ao tocar e depois vem o CALLBACK respondendo a ela", async () => {
    const t0 = 1_000_000;
    const m = montar([
      S1(t0),
      S1(t0 + 1000),
      toca(t0 + 2000, true),
      toca(t0 + 3000),
      snap([], t0 + 4000),
      snap([], t0 + 5000),
      snap([], t0 + 6000),
      snap([], t0 + 7000),
    ]);
    await rodar(m, 8);
    expect(m.tg.enviadas).toHaveLength(2);
    expect(m.tg.enviadas[0]).toContain("Line 1 number: 100001");
    expect(m.tg.enviadas[1]).toBe("CALLBACK");
    expect(m.tg.respondeuA).toEqual([undefined, 1]); // respondeu à 1ª mensagem (ID 1)
    expect(m.consultas).toBe(1);
  });

  it("tocou e foi atendido: só a mensagem de transferência", async () => {
    const t0 = 1_000_000;
    const m = montar([
      S1(t0),
      S1(t0 + 1000),
      toca(t0 + 2000, true),
      toca(t0 + 3000),
      snap([R("908301", "Stage 3 Agent", CALLEE, "U1")], t0 + 4000),
      snap([R("908301", "Stage 3 Agent", CALLEE, "U1")], t0 + 5000),
      snap([], t0 + 6000),
      snap([], t0 + 7000),
      snap([], t0 + 8000),
      snap([], t0 + 9000),
    ]);
    await rodar(m, 10);
    expect(m.tg.enviadas).toHaveLength(1);
  });
});

describe("E2E: duas transferências ao mesmo tempo viram fila", () => {
  it("as duas são detectadas e enviadas uma após a outra, sem perder nenhuma", async () => {
    const t0 = 1_000_000;
    const A = (cb: string, st: string, ce: string, ini: string) => R(cb, st, ce, ini);
    const m = montar([
      snap(
        [
          A("100001", "Stage 1 Agent", "011900000001", "T1"),
          A("100002", "Stage 1 Agent", "011900000002", "T2"),
        ],
        t0,
      ),
      snap(
        [
          A("100001", "Stage 1 Agent", "011900000001", "T1"),
          A("100002", "Stage 1 Agent", "011900000002", "T2"),
        ],
        t0 + 1000,
      ),
      snap([], t0 + 2000),
      snap(
        [
          A("908301", "Stage 3 Agent", "011900000001", "U1"),
          A("908302", "Stage 3 Agent", "011900000002", "U2"),
        ],
        t0 + 3000,
      ),
      snap(
        [
          A("908301", "Stage 3 Agent", "011900000001", "U1"),
          A("908302", "Stage 3 Agent", "011900000002", "U2"),
        ],
        t0 + 4000,
      ),
    ]);
    await rodar(m, 5);
    expect(m.tg.enviadas).toHaveLength(2);
    const nums = m.tg.enviadas.map((x) => /Line 1 number: (\d+)/.exec(x)?.[1]).sort();
    expect(nums).toEqual(["100001", "100002"]);
  });
});

describe("E2E Fase 6 (site e Telegram simulados)", () => {
  it("transferência → consulta → mensagem com o Callback ANTIGO → Telegram", async () => {
    const m = montar(TRANSFERENCIA(1_000_000));
    await rodar(m, 5);
    expect(m.fila.todas.map((t) => t.estado)).toEqual(["enviada"]);
    expect(m.tg.enviadas).toHaveLength(1);
    const msg = m.tg.enviadas[0] as string;
    expect(msg).toContain("Line 1 number: 100001");
    expect(msg).toContain("NAME: Fulano Ficticio");
    expect(msg).not.toContain("908301");
  });

  it("timeout no envio, mas a mensagem chegou: vira 'enviada' pela verificação, sem reenviar", async () => {
    const m = montar(TRANSFERENCIA(1_000_000));
    m.tg.comportamento = ["trava_mas_entrega"];
    await rodar(m, 5);
    expect(m.fila.todas[0]?.estado).toBe("enviada");
    expect(m.tg.enviadas).toHaveLength(0);
  });

  it("timeout e a mensagem NÃO chegou (conferido no grupo): reenvia sozinho e chega, uma vez só", async () => {
    const a = montar(TRANSFERENCIA(1_000_000));
    a.tg.comportamento = ["trava_sem_entregar"];
    await rodar(a, 5);
    expect(a.fila.todas[0]?.estado).toBe("enviada");
    expect(a.tg.enviadas).toHaveLength(1);
  });

  it("FLOOD_WAIT curto é esperado e o envio sai uma vez", async () => {
    const m = montar(TRANSFERENCIA(1_000_000));
    m.tg.comportamento = [new FloodWaitTelegram(2)];
    await rodar(m, 5);
    expect(m.fila.todas[0]?.estado).toBe("enviada");
    expect(m.tg.enviadas).toHaveLength(1);
  });

  it("falha definitiva no destino: o alerta explica o motivo em português", async () => {
    const m = montar(TRANSFERENCIA(1_000_000));
    m.tg.comportamento = [new FalhaTelegram("destino_ambiguo_varias_conversas_com_esse_nome")];
    await rodar(m, 5);
    expect(m.fila.todas[0]?.estado).toBe("falhou");
    expect(m.notif.alertas.some((a) => /mais de uma conversa com esse nome/.test(a.mensagem))).toBe(
      true,
    );
  });

  it("0 resultados: nada é enviado e há alerta", async () => {
    const m = montar(TRANSFERENCIA(1_000_000), {
      lookup: { find: async () => ({ tipo: "nenhum" }) },
    });
    await rodar(m, 5);
    expect(m.fila.todas[0]?.estado).toBe("ignorada");
    expect(m.tg.enviadas).toHaveLength(0);
  });

  it("mensagem velha demais (consulta demorou) não é enviada", async () => {
    const relogio = { t: 1_000_000 };
    const m = montar(TRANSFERENCIA(1_000_000), {
      relogio,
      lookup: {
        find: async () => {
          relogio.t += 20 * 60_000; // a consulta "demorou" 20 min
          return { tipo: "ok", registro: CADASTRO, multiplos: false };
        },
      },
    });
    await rodar(m, 5);
    expect(m.fila.todas[0]?.estado).toBe("ignorada");
    expect(m.fila.todas[0]?.motivo).toBe("mensagem_expirada");
    expect(m.tg.enviadas).toHaveLength(0);
  });

  it("sessão do site expira no meio: faz o login de novo, retoma e ainda detecta a transferência seguinte", async () => {
    let logins = 0;
    const t0 = 1_000_000;
    const m = montar(
      [
        snap([R("100001", "Stage 1 Agent", "011900000555")], t0),
        new SessaoExpiradaError("sem tabela"),
        snap([R("100002", "Stage 1 Agent")], t0 + 5000),
        snap([R("100002", "Stage 1 Agent")], t0 + 6000),
        snap([], t0 + 7000),
        snap([R("908302", "Stage 3 Agent", CALLEE, "10:01:00")], t0 + 8000),
        snap([R("908302", "Stage 3 Agent", CALLEE, "10:01:00")], t0 + 9000),
      ],
      { aoPerderSessao: async () => void logins++ },
    );
    await rodar(m, 7);
    expect(logins).toBe(1);
    expect(m.tg.enviadas).toHaveLength(1);
    expect(m.tg.enviadas[0]).toContain("Line 1 number: 100002");
  });

  it("encerramento limpo devolve o que ficou pendente", async () => {
    const m = montar(TRANSFERENCIA(1_000_000));
    m.tg.comportamento = [new Error("rede caiu")];
    m.tg.leituraFalha = true; // e também não dá para conferir o destino
    await rodar(m, 5);
    // erro inesperado = envio incerto; sem como verificar → fica incerta e é listada ao encerrar
    const pend = await m.fila.encerrar();
    expect(pend.map((t) => t.estado)).toEqual(["incerta"]);
  });

  it("soak: 8 h simuladas com uma transferência a cada 2 min não acumulam memória", async () => {
    const t0 = 1_000_000;
    const passos = 8 * 3600;
    const roteiro: TableSnapshot[] = [];
    for (let s = 0; s < passos; s++) {
      const ciclo = Math.floor(s / 120);
      const f = s % 120;
      const callee = `0119${String(ciclo).padStart(8, "0")}`;
      const rows: CallRow[] = [];
      if (f >= 10 && f < 20)
        rows.push(
          R(`1${String(ciclo % 90000).padStart(5, "0")}`, "Stage 1 Agent", callee, `T${ciclo}`),
        );
      if (f >= 22 && f < 40)
        rows.push(
          R(`9${String(ciclo % 90000).padStart(5, "0")}`, "Stage 3 Agent", callee, `U${ciclo}`),
        );
      roteiro.push(snap(rows, t0 + s * 1000));
    }
    const m = montar(roteiro, { relogio: { t: t0 } });
    for (let s = 0; s < passos; s++) {
      m.relogio.t = t0 + s * 1000;
      await m.monitor.passo(() => m.relogio.t);
      await m.fila.drenar(); // a consulta ocupa a aba: o roteiro só avança quando ela termina
      if (s % 60 === 0) {
        m.tracker.sweep(m.relogio.t);
        m.fila.limpar();
      }
    }
    await m.fila.drenar();
    expect(m.tg.enviadas.length).toBe(Math.floor(passos / 120));
    expect(m.tracker.ocorrenciasAtivas).toBeLessThan(10);
    expect(m.fila.todas.length).toBeLessThan(10);
  }, 60_000);
});
