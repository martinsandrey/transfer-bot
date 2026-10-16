import { describe, expect, it } from "vitest";
import type { CallRow, TableSnapshot } from "../src/dominio/tipos.js";
import {
  CallTracker,
  interpretarStatus,
  interpretarStatusDetalhado,
  type EventoTracker,
} from "../src/monitor/call-tracker.js";

// Todos os dados são FICTÍCIOS.
const S1 = "Stage 1 Agent";
const S2 = "Stage 2 Agent";
const S3 = "Stage 3 Agent";

function linha(cb: string, status: string, inicio = "T1", callee = "C1"): CallRow {
  return {
    callbackNumber: cb,
    calleeNumber: callee,
    callStatus: status,
    startTime: inicio,
    callDurationSec: 0,
  };
}
let relogio = 0;
function snap(rows: CallRow[], valid = true): TableSnapshot {
  relogio += 1000;
  return { readAt: relogio, rows, valid };
}
function tracker(over: Partial<ConstructorParameters<typeof CallTracker>[0]> = {}): CallTracker {
  return new CallTracker({
    leiturasConfirmacao: 2,
    ausenciaMaxLeituras: 3,
    ttlOcorrenciasMs: 60_000,
    ...over,
  });
}
/** Alimenta várias leituras e junta os eventos. */
function alimentar(t: CallTracker, ...snaps: TableSnapshot[]): EventoTracker[] {
  return snaps.flatMap((s) => t.ingest(s));
}
const tipos = (e: EventoTracker[]): string[] =>
  e.map((x) => (x.tipo === "transferencia" ? "transferencia" : `${x.tipo}:${x.codigo}`));

describe("interpretarStatus", () => {
  it("reconhece os três Stages e trata o resto como desconhecido", () => {
    expect(interpretarStatus("Stage 1 Agent")).toBe("stage1");
    expect(interpretarStatus("  stage  2   AGENT ")).toBe("stage2");
    expect(interpretarStatus("Stage 3 Agent")).toBe("stage3");
    expect(interpretarStatus("Ringing")).toBe("desconhecido");
  });
});

describe("interpretarStatusDetalhado (status observados no recon)", () => {
  it("separa o número do Stage e o complemento", () => {
    expect(interpretarStatusDetalhado("Stage 1 Ringing")).toMatchObject({
      numero: 1,
      sub: "ringing",
    });
    expect(interpretarStatusDetalhado("Stage 1 Manual Call")).toMatchObject({
      numero: 1,
      sub: "manual call",
    });
    expect(interpretarStatusDetalhado("Stage 3 Agent")).toMatchObject({ numero: 3, sub: "agent" });
    expect(interpretarStatusDetalhado("Stage 4 Agent").numero).toBe(4);
    expect(interpretarStatusDetalhado("Idle").numero).toBeNull();
    expect(interpretarStatus("Stage 1 Ringing")).toBe("stage1");
  });
});

describe("CallTracker com os status reais (Ringing, Agent, Manual Call)", () => {
  const RING = "Stage 1 Ringing";
  const MANUAL = "Stage 1 Manual Call";

  it("Ringing → Agent é normal: sem avisos e sem tarefa", () => {
    const t = tracker({ leiturasConfirmacao: 1 });
    alimentar(t, snap([]));
    const ev = alimentar(
      t,
      snap([linha("A", RING)]),
      snap([linha("A", RING)]),
      snap([linha("A", S1)]),
      snap([linha("A", S1)]),
    );
    expect(ev).toEqual([]);
  });

  it("Ringing → Agent → Stage 3 Agent gera exatamente uma transferência", () => {
    const t = tracker({ leiturasConfirmacao: 1 });
    alimentar(t, snap([]));
    const ev = alimentar(
      t,
      snap([linha("A", RING)]),
      snap([linha("A", S1)]),
      snap([linha("A", S3)]),
      snap([linha("A", S3)]),
    );
    expect(tipos(ev)).toEqual(["transferencia"]);
  });

  it("chamada que já estava em Ringing na linha de base e vira Agent → Stage 3 também gera", () => {
    const t = tracker({ leiturasConfirmacao: 1 });
    alimentar(t, snap([linha("A", RING)]));
    expect(tipos(alimentar(t, snap([linha("A", S1)]), snap([linha("A", S3)])))).toEqual([
      "transferencia",
    ]);
  });

  it("Stage 1 Agent → Stage 3 em outro complemento (ex.: Ringing) → transferência só quando chegar a Stage 3 Agent", () => {
    const t = tracker({ leiturasConfirmacao: 1 });
    alimentar(t, snap([linha("A", S1)]));
    expect(alimentar(t, snap([linha("A", "Stage 3 Ringing")]))).toEqual([]);
    expect(tipos(alimentar(t, snap([linha("A", S3)])))).toEqual(["transferencia"]);
  });

  it("Ringing → Stage 3 Agent sem nunca ter sido Stage 1 Agent: inesperado, sem tarefa", () => {
    const t = tracker({ leiturasConfirmacao: 1 });
    alimentar(t, snap([linha("A", RING)]));
    expect(tipos(alimentar(t, snap([linha("A", S3)])))).toEqual(["aviso:sequencia_inesperada"]);
  });

  it("Manual Call não é transferência e não gera aviso ao aparecer/sumir", () => {
    const t = tracker({ leiturasConfirmacao: 1 });
    alimentar(t, snap([]));
    expect(alimentar(t, snap([linha("A", MANUAL)]), snap([linha("A", MANUAL)]), snap([]))).toEqual(
      [],
    );
  });

  it("redisca do mesmo funcionário (Start Time muda na mesma linha, mesmo Callee): nova ocorrência, sem avisos", () => {
    const t = tracker({ leiturasConfirmacao: 1 });
    alimentar(t, snap([]));
    const ev = alimentar(
      t,
      snap([linha("A", RING, "20:00:01", "X")]),
      snap([linha("A", RING, "20:00:20", "X")]),
      snap([linha("A", S1, "20:00:20", "X")]),
      snap([linha("A", S3, "20:00:20", "X")]),
    );
    expect(tipos(ev)).toEqual(["transferencia"]);
  });

  it("Stage 4 (existe no site, significado a confirmar) gera aviso e nunca tarefa", () => {
    const t = tracker({ leiturasConfirmacao: 1 });
    alimentar(t, snap([linha("A", S3)]));
    expect(tipos(alimentar(t, snap([linha("A", "Stage 4 Agent")])))).toEqual([
      "aviso:sequencia_inesperada",
    ]);
  });
});

describe("CallTracker com linhas incompletas", () => {
  it("chamada cuja linha veio incompleta não conta como sumida, mesmo por muitas leituras", () => {
    const t = tracker({ leiturasConfirmacao: 1, ausenciaMaxLeituras: 2 });
    alimentar(t, snap([linha("A", S1)]));
    for (let i = 0; i < 10; i++) {
      const s = snap([]);
      t.ingest({ ...s, incompleteCallbacks: ["A"], rowsIgnored: 1 });
    }
    expect(t.ocorrenciasAtivas).toBe(1);
    expect(tipos(alimentar(t, snap([linha("A", S3)])))).toEqual(["transferencia"]);
  });

  it("sem o aviso de linha incompleta, a mesma ausência encerra a ocorrência", () => {
    const t = tracker({ leiturasConfirmacao: 1, ausenciaMaxLeituras: 2 });
    alimentar(t, snap([linha("A", S1)]));
    alimentar(t, snap([]), snap([]), snap([]));
    expect(t.ocorrenciasAtivas).toBe(0);
  });
});

describe("CallTracker", () => {
  it("Stage 1 → Stage 3 gera uma única transferência, só após N leituras consecutivas", () => {
    const t = tracker();
    alimentar(t, snap([linha("A", S1)])); // linha de base
    expect(alimentar(t, snap([linha("A", S1)]), snap([linha("A", S3)]))).toEqual([]); // 1ª leitura em Stage 3: aguardando
    const ev = alimentar(t, snap([linha("A", S3)]), snap([linha("A", S3)]));
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ tipo: "transferencia", callback: "A", callee: "C1" });
  });

  it("a mesma chamada trocando de posição na tabela continua sendo a mesma", () => {
    const t = tracker({ leiturasConfirmacao: 1 });
    alimentar(t, snap([linha("A", S1), linha("B", S1), linha("C", S1)]));
    const ev = alimentar(
      t,
      snap([linha("C", S1), linha("A", S1), linha("B", S1)]),
      snap([linha("B", S1), linha("C", S1), linha("A", S3)]),
      snap([linha("A", S3), linha("B", S1), linha("C", S1)]),
    );
    expect(tipos(ev)).toEqual(["transferencia"]);
    expect(t.ocorrenciasAtivas).toBe(3);
  });

  it("Stage 1 → Stage 2 é ignorado, sem aviso", () => {
    const t = tracker({ leiturasConfirmacao: 1 });
    alimentar(t, snap([linha("A", S1)]));
    expect(alimentar(t, snap([linha("A", S2)]), snap([linha("A", S2)]))).toEqual([]);
  });

  it("Stage 2 → Stage 3 é inesperado: sem tarefa, com aviso", () => {
    const t = tracker({ leiturasConfirmacao: 1 });
    alimentar(t, snap([linha("A", S1)]));
    const ev = alimentar(t, snap([linha("A", S2)]), snap([linha("A", S3)]));
    expect(tipos(ev)).toEqual(["aviso:sequencia_inesperada"]);
  });

  it("Stage 3 → Stage 1 também é inesperado (TODO confirmar se existe)", () => {
    const t = tracker({ leiturasConfirmacao: 1 });
    alimentar(t, snap([linha("A", S3)])); // base
    expect(tipos(alimentar(t, snap([linha("A", S1)])))).toEqual(["aviso:sequencia_inesperada"]);
  });

  it("chamada vista pela primeira vez em Stage 3 (após a base): só aviso", () => {
    const t = tracker({ leiturasConfirmacao: 1 });
    alimentar(t, snap([linha("A", S1)]));
    const ev = alimentar(
      t,
      snap([linha("A", S1), linha("B", S3)]),
      snap([linha("A", S1), linha("B", S3)]),
    );
    expect(tipos(ev)).toEqual(["aviso:visto_primeira_vez_stage3"]);
  });

  it("linha de base: chamadas já presentes (inclusive em Stage 3) nunca geram tarefa nem aviso", () => {
    const t = tracker({ leiturasConfirmacao: 1 });
    const ev = alimentar(
      t,
      snap([linha("A", S3), linha("B", S1), linha("C", S2)]),
      snap([linha("A", S3), linha("B", S1), linha("C", S2)]),
    );
    expect(ev).toEqual([]);
  });

  it("chamada em Stage 1 na linha de base que vai a Stage 3 depois gera tarefa", () => {
    const t = tracker({ leiturasConfirmacao: 1 });
    alimentar(t, snap([linha("A", S1)]));
    expect(tipos(alimentar(t, snap([linha("A", S3)])))).toEqual(["transferencia"]);
  });

  it("status oscilando não confirma; confirmar exige leituras consecutivas", () => {
    const t = tracker();
    alimentar(t, snap([linha("A", S1)]));
    expect(
      alimentar(
        t,
        snap([linha("A", S3)]),
        snap([linha("A", S1)]),
        snap([linha("A", S3)]),
        snap([linha("A", S1)]),
      ),
    ).toEqual([]);
    expect(tipos(alimentar(t, snap([linha("A", S3)]), snap([linha("A", S3)])))).toEqual([
      "transferencia",
    ]);
  });

  it("transição observada entre duas leituras (1 → 3 direto) conta", () => {
    const t = tracker({ leiturasConfirmacao: 1 });
    alimentar(t, snap([linha("A", S1)]));
    expect(tipos(alimentar(t, snap([linha("A", S3)])))).toEqual(["transferencia"]);
  });

  it("mesmo funcionário com duas transferências no dia → duas tarefas distintas", () => {
    const t = tracker({ leiturasConfirmacao: 1 });
    alimentar(t, snap([]));
    const ev = alimentar(
      t,
      snap([linha("A", S1, "10:00", "X")]),
      snap([linha("A", S3, "10:00", "X")]),
      snap([]), // some
      snap([linha("A", S1, "11:30", "Y")]), // nova ligação, outro Start Time/Callee
      snap([linha("A", S3, "11:30", "Y")]),
    );
    const trs = ev.filter((e) => e.tipo === "transferencia");
    expect(trs).toHaveLength(2);
    expect(new Set(trs.map((e) => (e.tipo === "transferencia" ? e.chave : ""))).size).toBe(2);
  });

  it("nova ligação sem a linha sumir (discriminador mudou na mesma linha) também é nova ocorrência", () => {
    const t = tracker({ leiturasConfirmacao: 1 });
    alimentar(t, snap([linha("A", S1, "10:00", "X")]));
    const ev = alimentar(
      t,
      snap([linha("A", S3, "10:00", "X")]),
      snap([linha("A", S1, "11:00", "Y")]),
      snap([linha("A", S3, "11:00", "Y")]),
    );
    expect(tipos(ev)).toEqual(["transferencia", "transferencia"]);
  });

  it("mesmo Callback Number em duas linhas: anomalia uma vez, sem tarefa, sem descartar o estado", () => {
    const t = tracker({ leiturasConfirmacao: 1 });
    alimentar(t, snap([linha("A", S1)]));
    const ev = alimentar(
      t,
      snap([linha("A", S3, "T1", "C1"), linha("A", S1, "T9", "C9")]),
      snap([linha("A", S3, "T1", "C1"), linha("A", S1, "T9", "C9")]),
    );
    expect(tipos(ev)).toEqual(["anomalia:callback_duplicado"]);
    expect(JSON.stringify(ev)).not.toContain('"A"'); // callback aparece só mascarado
    expect(t.ocorrenciasAtivas).toBe(1); // ocorrência existente foi preservada (congelada)
  });

  it("reinicialização: novo tracker faz nova linha de base", () => {
    const base = [linha("A", S3), linha("B", S1)];
    const t1 = tracker({ leiturasConfirmacao: 1 });
    alimentar(t1, snap(base));
    const t2 = tracker({ leiturasConfirmacao: 1 });
    expect(alimentar(t2, snap(base))).toEqual([]);
    expect(tipos(alimentar(t2, snap([linha("A", S3), linha("B", S3)])))).toEqual(["transferencia"]);
  });

  it("chamada que some depois da transferência não afeta o evento já emitido; some durante a confirmação, não gera", () => {
    const t = tracker();
    alimentar(t, snap([linha("A", S1), linha("B", S1)]));
    const ev = alimentar(
      t,
      snap([linha("A", S3), linha("B", S3)]),
      snap([linha("A", S3)]),
      snap([linha("A", S3)]),
      snap([]),
    );
    expect(tipos(ev)).toEqual(["transferencia"]); // só A confirmou; B sumiu na 2ª leitura
    expect(ev[0]).toMatchObject({ callback: "A" });
  });

  it("leitura inválida é ignorada: não confirma, não conta ausência", () => {
    const t = tracker({ ausenciaMaxLeituras: 1 });
    alimentar(t, snap([linha("A", S1)]));
    alimentar(t, snap([], false), snap([], false), snap([], false));
    expect(t.ocorrenciasAtivas).toBe(1);
    alimentar(t, snap([linha("A", S3)]), snap([], false));
    expect(tipos(alimentar(t, snap([linha("A", S3)])))).toEqual(["transferencia"]);
  });

  it("ausência curta (leitura parcial) não encerra a ocorrência; ausência longa encerra", () => {
    const t = tracker({ leiturasConfirmacao: 1, ausenciaMaxLeituras: 2 });
    alimentar(t, snap([linha("A", S1)]));
    alimentar(t, snap([]), snap([]));
    expect(t.ocorrenciasAtivas).toBe(1);
    expect(tipos(alimentar(t, snap([linha("A", S3)])))).toEqual(["transferencia"]);
    alimentar(t, snap([]), snap([]), snap([]));
    expect(t.ocorrenciasAtivas).toBe(0);
  });

  it("depois de encerrada e reaparecendo com o mesmo discriminador, não repete a transferência", () => {
    const t = tracker({ leiturasConfirmacao: 1, ausenciaMaxLeituras: 1 });
    alimentar(t, snap([linha("A", S1)]));
    expect(tipos(alimentar(t, snap([linha("A", S3)])))).toEqual(["transferencia"]);
    alimentar(t, snap([]), snap([]), snap([])); // encerrada
    // reaparece em Stage 1 com a mesma identidade e vai a Stage 3 de novo
    const ev = alimentar(t, snap([linha("A", S1)]), snap([linha("A", S3)]));
    expect(tipos(ev)).toEqual(["aviso:transferencia_duplicada"]);
  });

  it("janela sem leitura preserva ocorrências e ainda detecta a transição na volta", () => {
    const t = tracker({ leiturasConfirmacao: 1, ausenciaMaxLeituras: 1 });
    alimentar(t, snap([linha("A", S1)]));
    t.marcarJanelaSemLeitura();
    expect(alimentar(t, snap([linha("A", S3)]))).toHaveLength(1);
    t.marcarJanelaSemLeitura();
    alimentar(t, snap([])); // volta sem a linha: não conta ausência
    alimentar(t, snap([]));
    expect(t.ocorrenciasAtivas).toBe(1);
  });

  it("reiniciarBaseline (sessão expirada) ignora o que estiver na tabela na volta", () => {
    const t = tracker({ leiturasConfirmacao: 1 });
    alimentar(t, snap([linha("A", S1)]));
    t.reiniciarBaseline();
    expect(alimentar(t, snap([linha("A", S3)]))).toEqual([]);
  });

  it("status desconhecido gera aviso e nunca tarefa", () => {
    const t = tracker({ leiturasConfirmacao: 1 });
    alimentar(t, snap([linha("A", S1)]));
    const ev = alimentar(
      t,
      snap([linha("A", "Ringing")]),
      snap([linha("A", S3)]),
      snap([linha("B", "Busy")]),
    );
    expect(tipos(ev)).toEqual([
      "aviso:status_desconhecido",
      "aviso:sequencia_inesperada",
      "aviso:status_desconhecido",
    ]);
  });

  it("sweep esquece transferências antigas (dedup em memória não cresce)", () => {
    const t = tracker({ leiturasConfirmacao: 1, ttlOcorrenciasMs: 5000 });
    alimentar(t, snap([linha("A", S1)]));
    alimentar(t, snap([linha("A", S3)]));
    expect(t.transferenciasLembradas).toBe(1);
    t.sweep(relogio + 1000);
    expect(t.transferenciasLembradas).toBe(1);
    t.sweep(relogio + 6000);
    expect(t.transferenciasLembradas).toBe(0);
  });

  it("o identificador do evento não contém telefone", () => {
    const t = tracker({ leiturasConfirmacao: 1 });
    alimentar(t, snap([linha("5511900000001", S1)]));
    const ev = alimentar(t, snap([linha("5511900000001", S3)]))[0];
    expect(ev).toBeDefined();
    if (ev?.tipo === "transferencia") {
      expect(ev.ocorrencia).not.toContain("5511");
      expect(ev.chave).not.toContain("5511");
    }
  });
});
