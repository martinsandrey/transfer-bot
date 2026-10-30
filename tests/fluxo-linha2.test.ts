import { describe, expect, it } from "vitest";
import { validarConfig } from "../src/config/config.js";
import type { CallRow, TableSnapshot } from "../src/dominio/tipos.js";
import { tabelaParaLinhas } from "../src/leitura/leitor-tabela.js";
import { CallTracker, digitoDaLinha, type EventoTracker } from "../src/monitor/call-tracker.js";
import { descreverAviso } from "../src/monitor/monitor.js";

/**
 * Fluxo atual (pedido do usuário, 2026-10-21): linha 1 → linha 2 (Stage 2, funcionário com antepenúltimo dígito 2) → linha 3.
 * A mensagem é a da passagem 1 → 2; CALLBACK e duração passam a valer para a linha 2; a linha 3 é ignorada.
 */
const X = "21900000101";
const L1 = "908113";
const L2 = "908213";
const L3 = "908313";
const row = (cb: string, status: string, dur = 0, callee = X, inicio = "T1"): CallRow => ({
  callbackNumber: cb,
  calleeNumber: callee,
  callStatus: status,
  startTime: inicio,
  callDurationSec: dur,
});
let relogio = 0;
const snap = (rows: CallRow[]): TableSnapshot => {
  relogio += 1000;
  return { readAt: relogio, rows, valid: true };
};
const snapMais = (rows: CallRow[], segundos: number): TableSnapshot => {
  relogio += segundos * 1000;
  return { readAt: relogio, rows, valid: true };
};
const vazias = (n = 5): TableSnapshot[] => Array.from({ length: n }, () => snap([]));

function novo() {
  const fim: Array<{
    callback: string;
    duracaoSeg: number;
    naLinha2Seg: number;
    ateTransferenciaSeg: number | null;
  }> = [];
  const t = new CallTracker({
    leiturasConfirmacao: 1,
    ausenciaMaxLeituras: 3,
    ttlOcorrenciasMs: 600_000,
    esperaCallbackMs: 3000,
    duracaoCallbackSeg: 20,
    destinoStage: 2,
    destinoDigito: "2",
    aoEncerrarLigacao: (i) => fim.push(i),
  });
  const ev: EventoTracker[] = [];
  const ler = (...s: TableSnapshot[]) => {
    for (const x of s) ev.push(...t.ingest(x));
  };
  ler(snap([])); // linha de base vazia
  return { t, ev, fim, ler };
}
const tipos = (ev: EventoTracker[]) =>
  ev.map((e) => (e.tipo === "aviso" ? `aviso:${e.codigo}` : e.tipo));

describe("fluxo linha 1 → linha 2 (Stage 2, funcionário ***2**)", () => {
  it("digitoDaLinha = antepenúltimo dígito", () => {
    expect(digitoDaLinha("908213")).toBe("2");
    expect(digitoDaLinha("908113")).toBe("1");
    expect(digitoDaLinha(" 90-83-13 ")).toBe("3");
    expect(digitoDaLinha("12")).toBe("");
  });

  it("Stage 1 some e aparece Stage 2 de um funcionário da linha 2 com o mesmo cliente: TRANSFERÊNCIA do funcionário da linha 1", () => {
    const { ev, ler } = novo();
    ler(snap([row(L1, "Stage 1 Agent", 80)]), snap([row(L2, "Stage 2 Ringing")]));
    expect(tipos(ev)).toEqual(["transferencia"]);
    expect(ev[0]).toMatchObject({ callback: L1, callee: X, fase: "ringing" });
  });

  it("Stage 2 de um funcionário que NÃO é da linha 2: nenhuma mensagem, só aviso", () => {
    const { ev, ler } = novo();
    ler(snap([row(L1, "Stage 1 Agent")]), snap([row("908513", "Stage 2 Agent")]));
    expect(tipos(ev)).toEqual(["aviso:destino_fora_da_linha"]);
    expect(descreverAviso("destino_fora_da_linha", "***8513", 2, "2")).toBe(
      "Uma chamada passou do Stage 1 para o Stage 2, mas o funcionário que pegou (***8513) não é da linha 2 (o antepenúltimo dígito do número dele não é 2). Nenhuma mensagem foi gerada.",
    );
  });

  it("a MESMA linha muda de Stage 1 Agent para Stage 2 Agent: conta como transferência, sem conferir o dígito", () => {
    const { ev, ler } = novo();
    ler(snap([row(L1, "Stage 1 Agent")]), snap([row(L1, "Stage 2 Agent")]));
    expect(tipos(ev)).toEqual(["transferencia"]);
    expect(ev[0]).toMatchObject({ callback: L1, fase: "agent" });
  });

  it("Stage 2 sem origem em Stage 1: aviso 'direto em Stage 2'", () => {
    const { ev, ler } = novo();
    ler(snap([row(L2, "Stage 2 Agent")]));
    expect(tipos(ev)).toEqual(["aviso:visto_primeira_vez_stage3"]);
    expect(descreverAviso("visto_primeira_vez_stage3", "***8213", 2)).toMatch(
      /^Uma chamada apareceu direto em Stage 2 \(funcionário do Stage 2: \*\*\*8213\)/,
    );
  });

  it("linha 3 ignorada por completo: 1 → 3 direto, 3 sozinho e a mesma linha 1 → 3 não geram nada", () => {
    const a = novo();
    a.ler(snap([row(L1, "Stage 1 Agent")]), snap([row(L3, "Stage 3 Agent")]), ...vazias());
    expect(a.ev).toEqual([]);
    const b = novo();
    b.ler(snap([row(L3, "Stage 3 Agent", 0, "21900000999")]), ...vazias());
    expect(b.ev).toEqual([]);
    const c = novo();
    c.ler(snap([row(L1, "Stage 1 Agent")]), snap([row(L1, "Stage 3 Agent")]), ...vazias());
    expect(c.ev).toEqual([]);
  });

  it("atendida na linha 2 e passada à linha 3 em 10 s: NÃO é CALLBACK; registra os 10 s e a duração até a transferência", () => {
    const { ev, fim, ler } = novo();
    ler(
      snap([row(L1, "Stage 1 Agent", 75)]),
      snap([row(L2, "Stage 2 Agent", 2)]),
      snap([row(L2, "Stage 2 Agent", 10)]),
      snap([row(L3, "Stage 3 Agent", 1)]),
      snap([row(L3, "Stage 3 Agent", 30)]),
      ...vazias(),
    );
    expect(tipos(ev)).toEqual(["transferencia"]);
    expect(fim).toEqual([
      expect.objectContaining({ callback: L1, duracaoSeg: 10, ateTransferenciaSeg: 75 }),
    ]);
  });

  it("a duração registrada é só a da linha 2 (o Call Duration da linha 3 não entra), mesmo com a ligação ainda na linha 3", () => {
    const { fim, ler } = novo();
    ler(
      snap([row(L1, "Stage 1 Agent")]),
      snap([row(L2, "Stage 2 Agent", 40)]),
      snap([row(L3, "Stage 3 Agent", 500)]),
      snap([row(L3, "Stage 3 Agent", 600)]),
      snap([row(L3, "Stage 3 Agent", 700)]),
      snap([row(L3, "Stage 3 Agent", 800)]),
    );
    expect(fim).toEqual([expect.objectContaining({ duracaoSeg: 40 })]);
  });

  it("atendida na linha 2 por 8 s e a ligação terminou ali: CALLBACK (ligação curta)", () => {
    const { ev, fim, ler } = novo();
    ler(
      snap([row(L1, "Stage 1 Agent")]),
      snap([row(L2, "Stage 2 Agent", 3)]),
      snapMais([row(L2, "Stage 2 Agent", 8)], 8),
      ...vazias(),
    );
    expect(tipos(ev)).toEqual(["transferencia", "callback"]);
    expect(ev[1]).toMatchObject({ motivo: "ligacao_curta", duracaoSeg: 8, callback: L1 });
    expect(fim).toEqual([]);
  });

  it("atendida na linha 2 por 45 s e terminou: duração registrada, sem CALLBACK", () => {
    const { ev, fim, ler } = novo();
    ler(
      snap([row(L1, "Stage 1 Agent", 30)]),
      snap([row(L2, "Stage 2 Agent", 5)]),
      snapMais([row(L2, "Stage 2 Agent", 45)], 40),
      ...vazias(),
    );
    expect(tipos(ev)).toEqual(["transferencia"]);
    expect(fim).toEqual([
      expect.objectContaining({ duracaoSeg: 45, naLinha2Seg: 40, ateTransferenciaSeg: 30 }),
    ]);
  });

  it("linha 2 tocou e ninguém atendeu: CALLBACK (sem atendimento)", () => {
    const { ev, ler } = novo();
    ler(
      snap([row(L1, "Stage 1 Agent")]),
      snap([row(L2, "Stage 2 Ringing")]),
      snap([row(L2, "Stage 2 Ringing")]),
      ...vazias(),
    );
    expect(tipos(ev)).toEqual(["transferencia", "callback"]);
    expect(ev[1]).toMatchObject({ motivo: "sem_atendimento" });
  });

  it("linha 2 só foi vista tocando, mas a ligação chegou à linha 3: NÃO é CALLBACK", () => {
    const { ev, ler } = novo();
    ler(
      snap([row(L1, "Stage 1 Agent")]),
      snap([row(L2, "Stage 2 Ringing")]),
      snap([row(L3, "Stage 3 Agent")]),
      ...vazias(),
    );
    expect(tipos(ev)).toEqual(["transferencia"]);
  });

  it("fluxo antigo continua disponível: com destino 3 (sem dígito) a 1 → 3 gera a mensagem e a 1 → 2 é ignorada", () => {
    const t = new CallTracker({
      leiturasConfirmacao: 1,
      ausenciaMaxLeituras: 3,
      ttlOcorrenciasMs: 1e6,
    });
    const ev = [
      snap([]),
      snap([row(L1, "Stage 1 Agent")]),
      snap([row(L3, "Stage 3 Agent")]),
    ].flatMap((s) => t.ingest(s));
    expect(tipos(ev)).toEqual(["transferencia"]);
    const t2 = new CallTracker({
      leiturasConfirmacao: 1,
      ausenciaMaxLeituras: 3,
      ttlOcorrenciasMs: 1e6,
    });
    const ev2 = [
      snap([]),
      snap([row(L1, "Stage 1 Agent")]),
      snap([row(L1, "Stage 2 Agent")]),
    ].flatMap((s) => t2.ingest(s));
    expect(ev2).toEqual([]);
  });

  it("linha incompleta da linha 2 (sem Start Time) segura o CALLBACK enquanto aparece; quando some, sai o CALLBACK", () => {
    const { ev, ler } = novo();
    ler(snap([row(L1, "Stage 1 Agent")]), snap([row(L2, "Stage 2 Ringing")]));
    for (let i = 0; i < 6; i++)
      ler({ ...snap([]), stage3Parciais: [{ calleeNumber: X, agent: false, stage: 2 }] });
    expect(tipos(ev)).toEqual(["transferencia"]);
    ler(...vazias());
    expect(tipos(ev)).toEqual(["transferencia", "callback"]);
  });

  it("linha incompleta da linha 3 conta como 'seguiu adiante': sem CALLBACK", () => {
    const { ev, ler } = novo();
    ler(snap([row(L1, "Stage 1 Agent")]), snap([row(L2, "Stage 2 Ringing")]));
    ler({ ...snap([]), stage3Parciais: [{ calleeNumber: X, agent: true, stage: 3 }] }, ...vazias());
    expect(tipos(ev)).toEqual(["transferencia"]);
  });
});

describe("leitura: linha incompleta guarda o Stage", () => {
  it("Stage 2, 3 e 4 com dado faltando ficam registrados com o número do Stage; Stage 1 não", () => {
    const r = tabelaParaLinhas({
      cabecalhos: ["Callback Number", "Callee Number", "Call Status", "Start Time"],
      linhas: [
        ["908201", "21 90000-0101", "Stage 2 Agent", ""],
        ["908301", "21 90000-0102", "Stage 3 Ringing", ""],
        ["908401", "21 90000-0103", "Stage 4 Agent", ""],
        ["908101", "21 90000-0104", "Stage 1 Agent", ""],
      ].map((c) => ({ celulas: c.map((texto) => ({ texto })) })),
    } as never);
    expect(r).toMatchObject({
      ok: true,
      stage3Parciais: [
        { calleeNumber: "21900000101", agent: true, stage: 2 },
        { calleeNumber: "21900000102", agent: false, stage: 3 },
        { calleeNumber: "21900000103", agent: true, stage: 4 },
      ],
    });
  });
});

describe("configuração do destino da transferência", () => {
  const base = { SITE_URL: "https://exemplo.invalid/" };
  it("padrão: Stage 2 e dígito 2", () => {
    expect(validarConfig(base).monitor).toMatchObject({ destinoStage: 2, destinoDigito: "2" });
    expect(
      validarConfig({ ...base, TRANSFERENCIA_DESTINO_STAGE: "", TRANSFERENCIA_DESTINO_DIGITO: "" })
        .monitor,
    ).toMatchObject({ destinoStage: 2, destinoDigito: "2" });
  });
  it("fluxo antigo: Stage 3 e 'nenhum' = sem conferir o dígito", () => {
    const m = validarConfig({
      ...base,
      TRANSFERENCIA_DESTINO_STAGE: "3",
      TRANSFERENCIA_DESTINO_DIGITO: "Nenhum",
    }).monitor;
    expect(m.destinoStage).toBe(3);
    expect(m.destinoDigito).toBeUndefined();
  });
  it("valores inválidos dão erro em português", () => {
    expect(() => validarConfig({ ...base, TRANSFERENCIA_DESTINO_STAGE: "1" })).toThrow(
      /TRANSFERENCIA_DESTINO_STAGE/,
    );
    expect(() => validarConfig({ ...base, TRANSFERENCIA_DESTINO_DIGITO: "22" })).toThrow(
      /TRANSFERENCIA_DESTINO_DIGITO: use um dígito/,
    );
  });
});
