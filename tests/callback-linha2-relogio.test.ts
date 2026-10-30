import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { CallRow, TableSnapshot } from "../src/dominio/tipos.js";
import { CallTracker } from "../src/monitor/call-tracker.js";
import { RegistroEmArquivo, ARQUIVO_DURACOES } from "../src/registro/registro-arquivo.js";
import { carimbo } from "../src/relatorio/callbacks-manuais.js";
import {
  lerDuracoes,
  lerDuracoesNaLinha2,
  lerRegistro,
  montarLigacoes,
} from "../src/relatorio/relatorio.js";

/**
 * Caso real de 2026-10-30: a linha 2 ficou em Agent por 31 s, mas o "Call Duration" lido foi de 18 min (ele conta a ligação INTEIRA,
 * inclusive o tempo antes da transferência). O CALLBACK por ligação curta passa a usar o tempo na linha 2 medido pelo relógio.
 */
const X = "21900000101";
const L1 = "908113";
const L2 = "908213";
const row = (cb: string, status: string, dur: number): CallRow => ({
  callbackNumber: cb,
  calleeNumber: X,
  callStatus: status,
  startTime: "T1",
  callDurationSec: dur,
});
let relogio = 0;
const snap = (rows: CallRow[], passoSeg = 1): TableSnapshot => {
  relogio += passoSeg * 1000;
  return { readAt: relogio, rows, valid: true };
};

function novo(minimo = 45) {
  const confirmadas: Array<{ naLinha2Seg: number; duracaoSeg: number }> = [];
  const fim: Array<{ naLinha2Seg: number; duracaoSeg: number }> = [];
  const t = new CallTracker({
    leiturasConfirmacao: 1,
    ausenciaMaxLeituras: 3,
    ttlOcorrenciasMs: 600_000,
    esperaCallbackMs: 3000,
    duracaoCallbackSeg: minimo,
    destinoStage: 2,
    destinoDigito: "2",
    aoAtendimentoConfirmado: (i) => confirmadas.push(i),
    aoEncerrarLigacao: (i) => fim.push(i),
  });
  const tipos: string[] = [];
  const ler = (...s: TableSnapshot[]) => {
    for (const x of s) tipos.push(...t.ingest(x).map((e) => e.tipo));
  };
  ler(snap([]));
  return { tipos, ler, confirmadas, fim };
}
const vazias = () => Array.from({ length: 6 }, () => snap([]));

describe("CALLBACK por pouco tempo na linha 2 (relógio, não Call Duration)", () => {
  it("31 s na linha 2 com Call Duration de 18 min: CALLBACK", () => {
    const { tipos, ler, fim } = novo();
    ler(snap([row(L1, "Stage 1 Agent", 1090)]), snap([row(L2, "Stage 2 Agent", 1091)]));
    ler(snap([row(L2, "Stage 2 Agent", 1122)], 31), ...vazias());
    expect(tipos).toEqual(["transferencia", "callback"]);
    expect(fim).toEqual([]);
  });

  it("46 s na linha 2: não é CALLBACK, e o fim traz o tempo na linha 2 separado do Call Duration", () => {
    const { tipos, ler, fim } = novo();
    ler(snap([row(L1, "Stage 1 Agent", 1090)]), snap([row(L2, "Stage 2 Agent", 1091)]));
    ler(snap([row(L2, "Stage 2 Agent", 1137)], 46), ...vazias());
    expect(tipos).toEqual(["transferencia"]);
    expect(fim).toEqual([expect.objectContaining({ naLinha2Seg: 46, duracaoSeg: 1137 })]);
  });

  it("assim que a ligação chega ao mínimo (ainda aberta), avisa uma vez para gravar a duração provisória", () => {
    const { ler, confirmadas } = novo();
    ler(snap([row(L1, "Stage 1 Agent", 100)]), snap([row(L2, "Stage 2 Agent", 101)]));
    ler(snap([row(L2, "Stage 2 Agent", 120)], 19));
    expect(confirmadas).toEqual([]); // 19 s: ainda pode ser curta
    ler(snap([row(L2, "Stage 2 Agent", 146)], 26), snap([row(L2, "Stage 2 Agent", 150)], 4));
    expect(confirmadas).toEqual([expect.objectContaining({ naLinha2Seg: 45, duracaoSeg: 146 })]);
  });

  it("passou para a linha 3: nunca é CALLBACK por ser curta", () => {
    const { tipos, ler } = novo();
    ler(snap([row(L1, "Stage 1 Agent", 100)]), snap([row(L2, "Stage 2 Agent", 101)]));
    ler(snap([row("908313", "Stage 3 Agent", 110)], 9), ...vazias());
    expect(tipos).toEqual(["transferencia"]);
  });
});

describe("duracoes.txt: tempo na linha 2 e duração provisória", () => {
  it("grava 'Na linha 2' e 'provisória'; a linha final (mesmo código) substitui a provisória", () => {
    const pasta = mkdtempSync(join(tmpdir(), "tb-dur-"));
    const r = new RegistroEmArquivo(pasta);
    r.registrarDuracao({
      ligacao: "abc",
      duracaoSeg: 1100,
      naLinha2Seg: 45,
      ateTransferenciaSeg: 1050,
      provisoria: true,
    });
    r.registrarDuracao({
      ligacao: "abc",
      duracaoSeg: 1800,
      naLinha2Seg: 750,
      ateTransferenciaSeg: 1050,
    });
    const txt = readFileSync(join(pasta, ARQUIVO_DURACOES), "utf8");
    const [a, b] = txt.trim().split("\n");
    expect(a).toMatch(
      /\| Ligação: abc \| Duração: 1100 s \| Até a transferência: 1050 s \| Na linha 2: 45 s \| provisória$/,
    );
    expect(b).toMatch(/\| Duração: 1800 s \| Até a transferência: 1050 s \| Na linha 2: 750 s$/);
    expect(lerDuracoesNaLinha2(txt).get("abc")).toBe(750);
    expect(lerDuracoes(txt).get("abc")).toBe(1800);
    // linhas antigas (sem o campo) continuam legíveis e não entram no mapa
    expect(lerDuracoesNaLinha2("2026-10-21 09:05:00 | Ligação: x | Duração: 90 s\n").size).toBe(0);
  });
});

describe("relatório: a religação confere o tempo na linha 2", () => {
  const hoje = new Date();
  const em = (h: number, m: number) =>
    new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate(), h, m, 0);
  const bloco = (q: Date, lig: string, cb = false) =>
    `===== ${carimbo(q)} | ENVIADA${cb ? " | CALLBACK (ligação curta)" : ""} | Funcionário: 908113 | Cliente: 011996775336 | Ligação: ${lig} =====\n${cb ? "CALLBACK" : "NAME: X"}\n\n`;
  const REG = bloco(em(13, 10), "a1") + bloco(em(13, 11), "a1", true) + bloco(em(13, 14), "b1");
  const montar = (naLinha2: [string, number][], duracoes: [string, number][]) =>
    montarLigacoes(lerRegistro(REG, "transferencia"), new Map(duracoes), new Map(), {
      religacao: { janelaMs: 3_600_000, duracaoMinSeg: 45 },
      naLinha2: new Map(naLinha2),
    });
  const removido = (r: ReturnType<typeof montar>) => r.ligacoes.some((l) => l.callbackRemovido);

  it("o caso do usuário: 1ª transferência callback + 2ª com 50 s na linha 2 = 1 transferência concluída", () => {
    const r = montar([["b1", 50]], [["b1", 1000]]);
    expect(removido(r)).toBe(true);
    expect(r.ligacoes.find((l) => l.chave === "L:b1")?.substituiu).toBe(1);
  });

  it("2ª transferência com pouco tempo na linha 2 não remove o callback, mesmo com Call Duration enorme", () => {
    expect(removido(montar([["b1", 30]], [["b1", 1000]]))).toBe(false);
  });

  it("registro antigo da 2ª (sem 'Na linha 2') usa a Duração, como antes", () => {
    expect(removido(montar([], [["b1", 1000]]))).toBe(true);
    expect(removido(montar([], [["b1", 30]]))).toBe(false);
  });
});
