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

function linha(cb: string, status: string, inicio = "T1", callee = `C${cb}`): CallRow {
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
  e.map((x) =>
    x.tipo === "transferencia" || x.tipo === "ligacao_longa" || x.tipo === "callback"
      ? x.tipo
      : `${x.tipo}:${x.codigo}`,
  );

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

  it("Stage 4 (antes ou depois) não gera aviso nem tarefa", () => {
    const t = tracker({ leiturasConfirmacao: 1 });
    alimentar(t, snap([]));
    const ev = alimentar(
      t,
      snap([linha("A", S1)]),
      snap([linha("A", "Stage 4 Agent")]),
      snap([linha("A", "Stage 4 Agent")]),
      snap([linha("B", "Stage 4 Ringing")]),
      snap([linha("B", S3)]),
    );
    expect(tipos(ev).filter((x) => x === "transferencia")).toEqual([]);
    expect(ev.filter((e) => e.tipo === "aviso" && e.codigo === "sequencia_inesperada")).toEqual([]);
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

  it("Stage 1 Agent → Stage 3 Ringing (mesma linha) → transferência já ao tocar; depois Agent não repete", () => {
    const t = tracker({ leiturasConfirmacao: 1 });
    alimentar(t, snap([linha("A", S1)]));
    const ev = alimentar(t, snap([linha("A", "Stage 3 Ringing")]));
    expect(tipos(ev)).toEqual(["transferencia"]);
    expect(ev[0]).toMatchObject({ fase: "ringing" });
    expect(
      alimentar(
        t,
        snap([linha("A", S3)]),
        snap([linha("A", S3)]),
        snap([]),
        snap([]),
        snap([]),
        snap([]),
      ),
    ).toEqual([]);
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

  it("Stage 3 → Stage 4: nada acontece (pedido do usuário)", () => {
    const t = tracker({ leiturasConfirmacao: 1 });
    alimentar(t, snap([linha("A", S3)]));
    expect(tipos(alimentar(t, snap([linha("A", "Stage 4 Agent")])))).toEqual([]);
  });
});

describe("CallTracker: transferência = linha do Stage 1 some e aparece outra em Stage 3 com o mesmo Callee (evidência real)", () => {
  // Callbacks reais têm 6 dígitos: Stage 1 = 9081xx, Stage 3 = 9083xx. Dados fictícios.
  const ORIGEM = "908112";
  const DESTINO = "908301";
  const CLIENTE = "011900000001";
  const s1 = (inicio = "20:00:00") => linha(ORIGEM, S1, inicio, CLIENTE);
  const s3 = (inicio = "20:00:00") => linha(DESTINO, S3, inicio, CLIENTE);

  it("a linha do Stage 1 some e surge outra em Stage 3: uma transferência, com o Callback do Stage 1 (Line 1 number)", () => {
    const t = tracker();
    alimentar(t, snap([]));
    alimentar(t, snap([s1()]), snap([s1()]), snap([s1()]));
    const ev = alimentar(t, snap([s3()]), snap([s3()]), snap([s3()]));
    expect(tipos(ev)).toEqual(["transferencia"]);
    expect(ev[0]).toMatchObject({ tipo: "transferencia", callback: ORIGEM, callee: CLIENTE });
  });

  it("troca no mesmo instante (Stage 1 e Stage 3 na mesma leitura) e com a linha do Stage 1 ainda presente também funcionam", () => {
    const t = tracker();
    alimentar(t, snap([]));
    alimentar(t, snap([s1()]), snap([s1()]));
    expect(tipos(alimentar(t, snap([s3()]), snap([s3()])))).toEqual(["transferencia"]);

    const t2 = tracker();
    alimentar(t2, snap([]));
    alimentar(t2, snap([s1()]), snap([s1()]));
    expect(tipos(alimentar(t2, snap([s1(), s3()]), snap([s1(), s3()])))).toEqual(["transferencia"]);
  });

  it("exige N leituras da linha nova em Stage 3 Agent (leitura isolada não gera)", () => {
    const t = tracker();
    alimentar(t, snap([]));
    alimentar(t, snap([s1()]), snap([s1()]));
    expect(alimentar(t, snap([s3()]), snap([]), snap([]), snap([]), snap([]))).toEqual([]);
    const t1 = tracker({ leiturasConfirmacao: 1 });
    alimentar(t1, snap([]));
    alimentar(t1, snap([s1()]));
    expect(tipos(alimentar(t1, snap([s3()])))).toEqual(["transferencia"]);
  });

  it("Stage 3 sem origem em Stage 1 Agent: um aviso só (sem repetir para o mesmo cliente)", () => {
    const t = tracker({ leiturasConfirmacao: 1, ausenciaMaxLeituras: 1 });
    alimentar(t, snap([]));
    const ev = alimentar(t, snap([s3()]), snap([s3()]), snap([]), snap([]), snap([]), snap([s3()]));
    expect(tipos(ev)).toEqual(["aviso:visto_primeira_vez_stage3"]);
  });

  it("origem fora da janela de tempo não conta", () => {
    const t = tracker({ leiturasConfirmacao: 1, janelaTransferenciaMs: 5000 });
    alimentar(t, snap([]));
    alimentar(t, snap([s1()]));
    for (let i = 0; i < 10; i++) t.ingest(snap([])); // 10 s sem a linha
    expect(tipos(alimentar(t, snap([s3()])))).toEqual(["aviso:visto_primeira_vez_stage3"]);
  });

  it("origem que nunca foi 'Stage 1 Agent' (só Ringing) não gera transferência", () => {
    const t = tracker({ leiturasConfirmacao: 1 });
    alimentar(t, snap([]));
    alimentar(t, snap([linha(ORIGEM, "Stage 1 Ringing", "20:00:00", CLIENTE)]));
    expect(tipos(alimentar(t, snap([s3()])))).toEqual(["aviso:visto_primeira_vez_stage3"]);
  });

  it("a linha do Stage 3 pode sumir e voltar sem repetir transferência nem aviso", () => {
    const t = tracker({ leiturasConfirmacao: 1, ausenciaMaxLeituras: 1 });
    alimentar(t, snap([]));
    alimentar(t, snap([s1()]));
    const ev = alimentar(
      t,
      snap([s3()]),
      snap([s3()]),
      snap([]),
      snap([]),
      snap([]),
      snap([s3()]),
      snap([s3()]),
    );
    expect(tipos(ev)).toEqual(["transferencia"]);
  });

  it("duas transferências do mesmo funcionário (clientes diferentes) geram duas tarefas distintas", () => {
    const t = tracker({ leiturasConfirmacao: 1 });
    alimentar(t, snap([]));
    const outro = "011900000002";
    const ev = alimentar(
      t,
      snap([linha(ORIGEM, S1, "20:00:00", CLIENTE)]),
      snap([linha(DESTINO, S3, "20:00:00", CLIENTE)]),
      snap([]),
      snap([linha(ORIGEM, S1, "20:30:00", outro)]),
      snap([linha("908302", S3, "20:30:00", outro)]),
    );
    const trs = ev.filter((e) => e.tipo === "transferencia");
    expect(trs).toHaveLength(2);
    expect(new Set(trs.map((e) => (e.tipo === "transferencia" ? e.chave : ""))).size).toBe(2);
  });

  it("chamada que já estava em Stage 3 na linha de base não gera aviso nem tarefa, mesmo reaparecendo", () => {
    const t = tracker({ leiturasConfirmacao: 1, ausenciaMaxLeituras: 1 });
    expect(alimentar(t, snap([s3()]), snap([]), snap([]), snap([]), snap([s3()]))).toEqual([]);
  });

  it("Stage 1 → Stage 2 (linha nova em Stage 2) continua ignorado", () => {
    const t = tracker({ leiturasConfirmacao: 1 });
    alimentar(t, snap([]));
    alimentar(t, snap([s1()]));
    expect(alimentar(t, snap([linha("908201", "Stage 2 Agent", "20:00:00", CLIENTE)]))).toEqual([]);
  });

  it("o evento não carrega o Callback Number do Stage 3 nem expõe telefones fora dos campos previstos", () => {
    const t = tracker({ leiturasConfirmacao: 1 });
    alimentar(t, snap([]));
    alimentar(t, snap([s1()]));
    const ev = alimentar(t, snap([s3()]))[0];
    expect(JSON.stringify(ev)).not.toContain(DESTINO);
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
    expect(ev[0]).toMatchObject({ tipo: "transferencia", callback: "A", callee: "CA" });
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

describe("diário de status (diagnóstico)", () => {
  it("registra surgimento, mudanças e sumiço sem telefones", () => {
    const mudancas: string[] = [];
    const t = new CallTracker({
      leiturasConfirmacao: 1,
      ausenciaMaxLeituras: 1,
      ttlOcorrenciasMs: 60000,
      aoMudarStatus: (i) => mudancas.push(`${i.de}>${i.para}`),
    });
    alimentar(t, snap([]));
    alimentar(
      t,
      snap([linha("A", "Stage 1 Ringing")]),
      snap([linha("A", S1)]),
      snap([]),
      snap([]),
      snap([]),
    );
    expect(mudancas).toEqual(["(novo)>1|ringing", "1|ringing>1|agent", "1|agent>(sumiu)"]);
  });
});

describe("ligação longa (2º grupo): só em Stage 1", () => {
  const L = (cb: string, st: string, dur: number, ce = "C1", ini = "T1"): CallRow => ({
    callbackNumber: cb,
    calleeNumber: ce,
    callStatus: st,
    startTime: ini,
    callDurationSec: dur,
  });
  const mk = (extra = {}) =>
    new CallTracker({
      leiturasConfirmacao: 1,
      ausenciaMaxLeituras: 3,
      ttlOcorrenciasMs: 60000,
      duracaoLongaSeg: 300,
      ...extra,
    });

  it("emite uma vez quando uma ligação em Stage 1 chega a 5 min", () => {
    const t = mk();
    alimentar(t, snap([]));
    const ev = alimentar(
      t,
      snap([L("A", "Stage 1 Agent", 100)]),
      snap([L("A", "Stage 1 Agent", 299)]),
      snap([L("A", "Stage 1 Agent", 300)]),
      snap([L("A", "Stage 1 Agent", 301)]),
      snap([L("A", "Stage 1 Agent", 400)]),
    );
    expect(tipos(ev)).toEqual(["ligacao_longa"]);
    expect(ev[0]).toMatchObject({ callback: "A", callee: "C1" });
  });

  it("desligado (sem duracaoLongaSeg): nunca emite", () => {
    const t = mk({ duracaoLongaSeg: undefined });
    alimentar(t, snap([]));
    expect(tipos(alimentar(t, snap([L("A", "Stage 1 Agent", 9999)])))).toEqual([]);
  });

  it("já transferida: se chegou a 5 min só no Stage 3, não emite", () => {
    const t = mk();
    alimentar(t, snap([]));
    const ev = alimentar(
      t,
      snap([L("A", "Stage 1 Agent", 100)]),
      snap([]),
      snap([L("B", "Stage 3 Agent", 10)]),
      snap([L("B", "Stage 3 Agent", 400)]),
    );
    expect(tipos(ev)).toEqual(["transferencia"]);
  });

  it("chegou a 5 min no Stage 1 e depois foi transferida: sai nos dois grupos", () => {
    const t = mk();
    alimentar(t, snap([]));
    const ev = alimentar(
      t,
      snap([L("A", "Stage 1 Agent", 299)]),
      snap([L("A", "Stage 1 Agent", 300)]),
      snap([]),
      snap([L("B", "Stage 3 Agent", 5)]),
    );
    expect(tipos(ev)).toEqual(["ligacao_longa", "transferencia"]);
  });

  it("Stage 3 e Stage 2/4 nunca contam", () => {
    const t = mk();
    alimentar(t, snap([]));
    const ev = alimentar(
      t,
      snap([L("A", "Stage 3 Agent", 400, "C1"), L("B", "Stage 4 Agent", 400, "C2")]),
      snap([L("A", "Stage 3 Agent", 500, "C1"), L("B", "Stage 4 Agent", 500, "C2")]),
    );
    expect(ev.filter((e) => e.tipo === "ligacao_longa")).toEqual([]);
  });

  it("ligação que já estava longa quando o programa abriu não gera mensagem; as que cruzam depois sim", () => {
    const t = mk();
    const ev = alimentar(
      t,
      snap([L("A", "Stage 1 Agent", 900), L("B", "Stage 1 Agent", 250, "C2")]), // linha de base
      snap([L("A", "Stage 1 Agent", 901), L("B", "Stage 1 Agent", 260, "C2")]),
      snap([L("A", "Stage 1 Agent", 950), L("B", "Stage 1 Agent", 310, "C2")]),
    );
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ tipo: "ligacao_longa", callback: "B" });
  });

  it("duração ilegível (null) não emite nem quebra", () => {
    const t = mk();
    alimentar(t, snap([]));
    const r = { ...L("A", "Stage 1 Agent", 0), callDurationSec: null };
    expect(tipos(alimentar(t, snap([r]), snap([r])))).toEqual([]);
  });

  it("ligações sucessivas do mesmo funcionário geram uma mensagem cada", () => {
    const t = mk();
    alimentar(t, snap([]));
    const ev = alimentar(
      t,
      snap([L("A", "Stage 1 Agent", 300, "C1", "T1")]),
      snap([]),
      snap([]),
      snap([]),
      snap([]),
      snap([L("A", "Stage 1 Agent", 300, "C2", "T9")]),
    );
    expect(tipos(ev)).toEqual(["ligacao_longa", "ligacao_longa"]);
  });
});

describe("transferência durante janela sem leitura (consulta ao cadastro)", () => {
  it("o tempo parado (5 min) não esgota a janela de 60 s: a transferência ainda é detectada", () => {
    const t = new CallTracker({
      leiturasConfirmacao: 1,
      ausenciaMaxLeituras: 3,
      ttlOcorrenciasMs: 3_600_000,
      janelaTransferenciaMs: 60_000,
    });
    const em = (rows: CallRow[], ms: number): TableSnapshot => ({ readAt: ms, rows, valid: true });
    const A = (st: string, cb = "100001"): CallRow => ({
      callbackNumber: cb,
      calleeNumber: "CX",
      callStatus: st,
      startTime: "T1",
      callDurationSec: 1,
    });
    t.ingest(em([], 0));
    t.ingest(em([A("Stage 1 Agent")], 1000));
    t.marcarJanelaSemLeitura(); // a aba foi usada na consulta de OUTRA transferência por 5 minutos
    t.ingest(em([], 301_000));
    const ev = [
      ...t.ingest(em([A("Stage 3 Agent", "908301")], 302_000)),
      ...t.ingest(em([A("Stage 3 Agent", "908301")], 303_000)),
    ];
    expect(tipos(ev)).toEqual(["transferencia"]);
  });
});

describe("Stage 3 Ringing: transferência ao tocar e CALLBACK se ninguém atender", () => {
  const X = "CX"; // mesmo Callee em todas as linhas da mesma ligação
  const ST1 = (cb = "100001") => linha(cb, S1, "T1", X);
  const RINGING = (cb: string) => linha(cb, "Stage 3 Ringing", "U1", X);
  const AGENT3 = (cb: string) => linha(cb, S3, "U1", X);
  const mk = () => tracker({ leiturasConfirmacao: 1, esperaCallbackMs: 3000 });

  it("linha nova em Stage 3 Ringing (o Stage 1 ainda na tabela) → transferência ao tocar, com o Callback do Stage 1", () => {
    const t = mk();
    alimentar(t, snap([]));
    alimentar(t, snap([ST1()]), snap([ST1()]));
    const ev = alimentar(t, snap([ST1(), RINGING("908301")]));
    expect(tipos(ev)).toEqual(["transferencia"]);
    expect(ev[0]).toMatchObject({ callback: "100001", callee: X, fase: "ringing" });
  });

  it("tocou e foi atendido (Agent): uma única mensagem e nenhum CALLBACK", () => {
    const t = mk();
    alimentar(t, snap([]));
    alimentar(t, snap([ST1()]));
    const ev = alimentar(
      t,
      snap([ST1(), RINGING("908301")]),
      snap([RINGING("908301")]),
      snap([AGENT3("908301")]),
      snap([AGENT3("908301")]),
      snap([]),
      snap([]),
      snap([]),
      snap([]),
      snap([]),
    );
    expect(tipos(ev)).toEqual(["transferencia"]);
  });

  it("tocou e sumiu sem atender: CALLBACK depois da espera (3 s), uma única vez", () => {
    const t = mk();
    alimentar(t, snap([]));
    alimentar(t, snap([ST1()]));
    const ev = alimentar(
      t,
      snap([ST1(), RINGING("908301")]),
      snap([RINGING("908301")]),
      snap([]), // 1 s sem Stage 3
      snap([]), // 2 s
      snap([]), // 3 s → CALLBACK
      snap([]),
      snap([]),
    );
    expect(tipos(ev)).toEqual(["transferencia", "callback"]);
    expect(ev[1]).toMatchObject({ callback: "100001", callee: X });
    expect((ev[1] as { vinculo: string }).vinculo).toBe((ev[0] as { vinculo: string }).vinculo);
  });

  it("o toque passa para outro agente dentro da espera: sem CALLBACK; atendido depois: nada mais", () => {
    const t = mk();
    alimentar(t, snap([]));
    alimentar(t, snap([ST1()]));
    const ev = alimentar(
      t,
      snap([ST1(), RINGING("908301")]),
      snap([RINGING("908301")]),
      snap([]), // o 1º agente parou de tocar
      snap([RINGING("908302")]), // outro agente começa a tocar (mesmo Callee)
      snap([RINGING("908302")]),
      snap([AGENT3("908302")]),
      snap([]),
      snap([]),
      snap([]),
      snap([]),
    );
    expect(tipos(ev)).toEqual(["transferencia"]);
  });

  it("outro agente só começa a tocar DEPOIS da espera: CALLBACK já saiu; o novo toque não gera outra transferência", () => {
    const t = mk();
    alimentar(t, snap([]));
    alimentar(t, snap([ST1()]));
    const ev = alimentar(
      t,
      snap([ST1(), RINGING("908301")]),
      snap([RINGING("908301")]),
      snap([]),
      snap([]),
      snap([]), // CALLBACK
      snap([RINGING("908302")]),
      snap([AGENT3("908302")]),
      snap([]),
    );
    expect(tipos(ev)).toEqual(["transferencia", "callback"]);
  });

  it("direto em Stage 3 Agent (sem Ringing): transferência (fase agent) e nunca CALLBACK", () => {
    const t = mk();
    alimentar(t, snap([]));
    alimentar(t, snap([ST1()]));
    const ev = alimentar(
      t,
      snap([AGENT3("908301")]),
      snap([]),
      snap([]),
      snap([]),
      snap([]),
      snap([]),
    );
    expect(tipos(ev)).toEqual(["transferencia"]);
    expect(ev[0]).toMatchObject({ fase: "agent" });
  });

  it("janela sem leitura (consulta ao cadastro) não vira CALLBACK na hora: o relógio de 3 s recomeça", () => {
    const t = mk();
    alimentar(t, snap([]));
    alimentar(t, snap([ST1()]));
    alimentar(t, snap([ST1(), RINGING("908301")]));
    t.marcarJanelaSemLeitura();
    relogio += 20_000; // a aba ficou 20 s na consulta
    expect(alimentar(t, snap([]))).toEqual([]); // 1ª leitura depois da pausa: ainda não conclui nada
    expect(alimentar(t, snap([]), snap([]))).toEqual([]);
    expect(tipos(alimentar(t, snap([])))).toEqual(["callback"]);
  });

  it("transferência que ainda não tocou nem atendeu em outra ligação (Callee diferente) não se mistura", () => {
    const t = mk();
    alimentar(t, snap([]));
    alimentar(t, snap([ST1(), linha("100002", S1, "T2", "CY")]));
    const ev = alimentar(
      t,
      snap([ST1(), linha("100002", S1, "T2", "CY"), RINGING("908301")]),
      snap([linha("100002", S1, "T2", "CY"), AGENT3("908301")]),
      snap([linha("100002", S1, "T2", "CY")]),
      snap([linha("100002", S1, "T2", "CY")]),
      snap([linha("100002", S1, "T2", "CY")]),
    );
    expect(tipos(ev)).toEqual(["transferencia"]);
  });

  it("linha de Stage 3 que veio incompleta (ignorada pelo leitor) não vira CALLBACK falso enquanto continua tocando", () => {
    const t = mk();
    alimentar(t, snap([]));
    alimentar(t, snap([ST1()]));
    alimentar(t, snap([ST1(), RINGING("908301")]));
    const incompleta = (): TableSnapshot => ({
      ...snap([]),
      rowsIgnored: 1,
      stage3Parciais: [{ calleeNumber: X, agent: false }],
    });
    // 6 leituras seguidas com a linha do Stage 3 incompleta (ainda tocando): nada de CALLBACK
    expect(
      alimentar(
        t,
        incompleta(),
        incompleta(),
        incompleta(),
        incompleta(),
        incompleta(),
        incompleta(),
      ),
    ).toEqual([]);
    // some de vez → CALLBACK
    expect(tipos(alimentar(t, snap([]), snap([]), snap([]), snap([])))).toEqual(["callback"]);
  });
});

describe("CALLBACK também por ligação curta (atendida, mas com menos de N segundos)", () => {
  const X = "CX";
  const ST1 = (cb = "100001") => linha(cb, S1, "T1", X);
  const RINGING = (cb: string, dur: number | null = 0) => ({
    ...linha(cb, "Stage 3 Ringing", "U1", X),
    callDurationSec: dur,
  });
  const AGENT3 = (cb: string, dur: number | null) => ({
    ...linha(cb, S3, "U1", X),
    callDurationSec: dur,
  });
  const ST4 = (cb: string, dur: number) => ({
    ...linha(cb, "Stage 4 Agent", "U1", X),
    callDurationSec: dur,
  });
  const mk = (minimo = 20) =>
    tracker({ leiturasConfirmacao: 1, esperaCallbackMs: 3000, duracaoCallbackSeg: minimo });
  const VAZIAS = () => [snap([]), snap([]), snap([]), snap([]), snap([])];

  function comecar(t: CallTracker): EventoTracker[] {
    alimentar(t, snap([]));
    alimentar(t, snap([ST1()]));
    return alimentar(t, snap([ST1(), RINGING("908301")]));
  }

  it("atendida por 12 s e a linha some: CALLBACK por ligação curta, com a duração, uma única vez", () => {
    const t = mk();
    comecar(t);
    const ev = alimentar(
      t,
      snap([AGENT3("908301", 3)]),
      snap([AGENT3("908301", 8)]),
      snap([AGENT3("908301", 12)]),
      ...VAZIAS(),
    );
    expect(tipos(ev)).toEqual(["callback"]);
    expect(ev[0]).toMatchObject({
      motivo: "ligacao_curta",
      duracaoSeg: 12,
      callback: "100001",
      callee: X,
    });
  });

  it("ligação de 35 s: sem CALLBACK; exatamente 20 s também não (só MENOS que o mínimo)", () => {
    for (const dur of [35, 20]) {
      const t = mk();
      comecar(t);
      const ev = alimentar(
        t,
        snap([AGENT3("908301", 5)]),
        snap([AGENT3("908301", dur)]),
        ...VAZIAS(),
      );
      expect(tipos(ev)).toEqual([]);
    }
    const t = mk();
    comecar(t);
    expect(tipos(alimentar(t, snap([AGENT3("908301", 19)]), ...VAZIAS()))).toEqual(["callback"]);
  });

  it("o mínimo vem da configuração: com 10 s, uma ligação de 12 s não é CALLBACK; com 0 desliga a regra", () => {
    const t10 = mk(10);
    comecar(t10);
    expect(tipos(alimentar(t10, snap([AGENT3("908301", 12)]), ...VAZIAS()))).toEqual([]);
    const t0 = mk(0);
    comecar(t0);
    expect(tipos(alimentar(t0, snap([AGENT3("908301", 2)]), ...VAZIAS()))).toEqual([]);
  });

  it("a linha passa para Stage 4 (continua na tabela): não decide nada; só vale a duração total", () => {
    const t = mk();
    comecar(t);
    const ev = alimentar(
      t,
      snap([AGENT3("908301", 5)]),
      snap([ST4("908301", 8)]), // 8 s e mudou de Stage: a ligação NÃO acabou
      snap([ST4("908301", 9)]),
      snap([ST4("908301", 10)]),
      snap([ST4("908301", 60)]),
      ...VAZIAS(),
    );
    expect(tipos(ev)).toEqual([]);
  });

  it("transferência já detectada em Stage 3 Agent (sem toque): ligação curta também vira CALLBACK", () => {
    const t = mk();
    alimentar(t, snap([]));
    alimentar(t, snap([ST1()]));
    const ev = alimentar(t, snap([AGENT3("908301", 1)]), snap([AGENT3("908301", 6)]), ...VAZIAS());
    expect(tipos(ev)).toEqual(["transferencia", "callback"]);
    expect(ev[1]).toMatchObject({ motivo: "ligacao_curta", duracaoSeg: 6 });
  });

  it("Call Duration ilegível: conta o tempo desde que o Stage 3 Agent apareceu", () => {
    const t = mk(20);
    comecar(t);
    const ev = alimentar(
      t,
      snap([AGENT3("908301", null)]),
      snap([AGENT3("908301", null)]),
      snap([AGENT3("908301", null)]),
      ...VAZIAS(),
    );
    expect(tipos(ev)).toEqual(["callback"]);
    expect(ev[0]).toMatchObject({ motivo: "ligacao_curta" });
    const longa = mk(2);
    comecar(longa);
    expect(
      tipos(
        alimentar(
          longa,
          snap([AGENT3("908301", null)]),
          snap([AGENT3("908301", null)]),
          snap([AGENT3("908301", null)]),
          snap([AGENT3("908301", null)]),
          ...VAZIAS(),
        ),
      ),
    ).toEqual([]);
  });

  it("tocou e ninguém atendeu continua sendo CALLBACK (sem_atendimento), com a regra de duração ligada", () => {
    const t = mk();
    comecar(t);
    const ev = alimentar(t, snap([RINGING("908301", 4)]), ...VAZIAS());
    expect(tipos(ev)).toEqual(["callback"]);
    expect(ev[0]).toMatchObject({ motivo: "sem_atendimento" });
  });

  it("janela sem leitura (consulta ao cadastro) não encerra a ligação nem gera CALLBACK", () => {
    const t = mk();
    comecar(t);
    alimentar(t, snap([AGENT3("908301", 4)]));
    t.marcarJanelaSemLeitura();
    const ev = alimentar(t, snap([]), snap([AGENT3("908301", 40)]), snap([AGENT3("908301", 41)]));
    expect(tipos(ev)).toEqual([]);
  });

  it("outra ligação do mesmo cliente depois: cada ligação decide a sua vez, sem repetir CALLBACK", () => {
    const t = mk();
    comecar(t);
    const ev = alimentar(t, snap([AGENT3("908301", 5)]), ...VAZIAS(), ...VAZIAS());
    expect(tipos(ev)).toEqual(["callback"]);
  });
});

describe("duração da ligação atendida (para o relatório)", () => {
  const X = "CX";
  const ST1 = linha("100001", S1, "T1", X);
  const AG = (dur: number | null) => ({
    ...linha("908301", S3, "U1", X),
    callDurationSec: dur,
  });
  const VAZIAS = () => [snap([]), snap([]), snap([]), snap([]), snap([])];
  function rodar(minimo: number, ...snaps: TableSnapshot[]) {
    const fim: Array<{ vinculo: string; duracaoSeg: number }> = [];
    const t = tracker({
      leiturasConfirmacao: 1,
      esperaCallbackMs: 3000,
      duracaoCallbackSeg: minimo,
      aoEncerrarLigacao: (i) => fim.push(i),
    });
    alimentar(t, snap([]));
    alimentar(t, snap([ST1]));
    const ev = alimentar(t, ...snaps);
    return { fim, ev };
  }
  it("ligação longa que termina: avisa a duração uma única vez, sem CALLBACK", () => {
    const { fim, ev } = rodar(
      20,
      snap([ST1, AG(2)]),
      snap([AG(60)]),
      snap([AG(185)]),
      ...VAZIAS(),
      ...VAZIAS(),
    );
    expect(tipos(ev)).toEqual(["transferencia"]);
    expect(fim).toHaveLength(1);
    expect(fim[0]?.duracaoSeg).toBe(185);
  });
  it("ligação curta vira CALLBACK e NÃO entra na duração média", () => {
    const { fim, ev } = rodar(20, snap([ST1, AG(2)]), snap([AG(9)]), ...VAZIAS());
    expect(tipos(ev)).toEqual(["transferencia", "callback"]);
    expect(fim).toEqual([]);
  });
  it("com a regra de duração desligada (0), a duração continua sendo registrada", () => {
    const { fim, ev } = rodar(0, snap([ST1, AG(2)]), snap([AG(9)]), ...VAZIAS());
    expect(tipos(ev)).toEqual(["transferencia"]);
    expect(fim[0]?.duracaoSeg).toBe(9);
  });
  it("tocou e ninguém atendeu: sem duração", () => {
    const { fim } = rodar(
      20,
      snap([ST1, { ...linha("908301", "Stage 3 Ringing", "U1", X), callDurationSec: 4 }]),
      ...VAZIAS(),
    );
    expect(fim).toEqual([]);
  });
});
