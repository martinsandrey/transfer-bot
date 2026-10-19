import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  formatarCsv,
  formatarTabela,
  lerRegistro,
  periodoNomeado,
  periodoPorDatas,
  resumir,
  SEM_FUNCIONARIO,
} from "../src/relatorio/relatorio.js";
import { RegistroEmArquivo } from "../src/registro/registro-arquivo.js";

const bloco = (ts: string, estado: string, nota: string, func: string, corpo = "NAME: X") =>
  `===== ${ts} | ${estado}${nota} ${func ? `| Funcionário: ${func} ` : ""}=====\n${corpo}\n\n`;

// 19/10/2026 é uma segunda-feira
const AGORA = new Date(2026, 9, 21, 15, 0, 0); // quarta-feira

const TRANSF =
  bloco("2026-10-21 09:00:00", "ENVIADA", "", "5500000111") +
  bloco("2026-10-21 10:00:00", "ENVIADA", "", "5500000111") +
  bloco("2026-10-21 11:00:00", "ENVIADA", "", "5500000121") +
  bloco(
    "2026-10-21 10:01:00",
    "ENVIADA",
    " | CALLBACK (ninguém atendeu)",
    "5500000111",
    "CALLBACK",
  ) +
  bloco("2026-10-20 09:00:00", "ENVIADA", "", "5500000111") +
  bloco("2026-10-14 09:00:00", "ENVIADA", "", "5500000121") +
  bloco("2026-10-21 12:00:00", "OBSERVAÇÃO (não enviada)", "", "5500000131");
const LONGA =
  bloco("2026-10-21 09:30:00", "ENVIADA", "", "5500000101") +
  bloco("2026-10-21 09:40:00", "ENVIADA", "", "5500000111");

describe("lerRegistro", () => {
  it("lê blocos, marca callbacks e usa o funcionário do cabeçalho", () => {
    const e = lerRegistro(TRANSF, "transferencia");
    expect(e).toHaveLength(7);
    expect(e.filter((x) => x.tipo === "callback")).toHaveLength(1);
    expect(e[0]?.funcionario).toBe("5500000111");
    expect(e[6]?.enviada).toBe(false);
  });
  it("registro antigo (sem funcionário no cabeçalho): usa 'Line 1 number' do corpo; callback antigo vira não identificado", () => {
    const antigo =
      bloco("2026-10-17 09:00:00", "ENVIADA", "", "", "NAME: X\nLine 1 number: 5500000111\nNOTE:") +
      bloco("2026-10-17 09:01:00", "ENVIADA", " | CALLBACK (ninguém atendeu)", "", "CALLBACK");
    const e = lerRegistro(antigo, "transferencia");
    expect(e[0]?.funcionario).toBe("5500000111");
    expect(e[1]?.funcionario).toBe(SEM_FUNCIONARIO);
  });
  it("aceita CRLF", () => {
    expect(lerRegistro(TRANSF.replace(/\n/g, "\r\n"), "transferencia")).toHaveLength(7);
  });
});

describe("períodos", () => {
  it("hoje, ontem, semana (desde segunda), 7 dias, mês", () => {
    const n = (x: string) => periodoNomeado(x, AGORA);
    expect(n("hoje")?.de).toEqual(new Date(2026, 9, 21));
    expect(n("ontem")?.de).toEqual(new Date(2026, 9, 20));
    expect(n("semana")?.de).toEqual(new Date(2026, 9, 19));
    expect(n("7dias")?.de).toEqual(new Date(2026, 9, 15));
    expect(n("mes")?.de).toEqual(new Date(2026, 9, 1));
    expect(n("tudo")?.de).toBeNull();
    expect(n("xx")).toBeNull();
  });
  it("datas: inclusivas; inválidas dão null", () => {
    const p = periodoPorDatas("2026-10-14", "2026-10-14");
    expect(p?.ate).toEqual(new Date(2026, 9, 15));
    expect(periodoPorDatas("2026-02-30", undefined)).toBeNull();
    expect(periodoPorDatas("2026-10-20", "2026-10-19")).toBeNull();
    expect(periodoPorDatas("abc", undefined)).toBeNull();
  });
  it("domingo pertence à semana que começou na segunda anterior", () => {
    expect(periodoNomeado("semana", new Date(2026, 9, 25, 10))?.de).toEqual(new Date(2026, 9, 19));
  });
});

describe("resumir", () => {
  const entradas = [...lerRegistro(TRANSF, "transferencia"), ...lerRegistro(LONGA, "longa")];
  it("hoje: transferências com/sem callback, callbacks e ligações de 5 min por funcionário", () => {
    const l = resumir(entradas, periodoNomeado("hoje", AGORA) as never);
    const a = l.find((x) => x.funcionario === "5500000111");
    expect(a).toMatchObject({ comCallback: 2, callbacks: 1, semCallback: 1, longas: 1 });
    expect(l.find((x) => x.funcionario === "5500000121")).toMatchObject({
      comCallback: 1,
      callbacks: 0,
      semCallback: 1,
      longas: 0,
    });
    expect(l.find((x) => x.funcionario === "5500000101")).toMatchObject({
      comCallback: 0,
      longas: 1,
    });
    expect(l.find((x) => x.funcionario === "5500000131")).toBeUndefined(); // só observação
  });
  it("semana pega ontem também; tudo pega o dia 14; observação só se pedida", () => {
    const sem = resumir(entradas, periodoNomeado("semana", AGORA) as never);
    expect(sem.find((x) => x.funcionario === "5500000111")?.comCallback).toBe(3);
    const tudo = resumir(entradas, periodoNomeado("tudo", AGORA) as never);
    expect(tudo.find((x) => x.funcionario === "5500000121")?.comCallback).toBe(2);
    const obs = resumir(entradas, periodoNomeado("hoje", AGORA) as never, true);
    expect(obs.find((x) => x.funcionario === "5500000131")?.comCallback).toBe(1);
  });
  it("callback sem a transferência no período nunca dá número negativo", () => {
    const so = lerRegistro(
      bloco(
        "2026-10-21 10:01:00",
        "ENVIADA",
        " | CALLBACK (ninguém atendeu)",
        "5500000111",
        "CALLBACK",
      ),
      "transferencia",
    );
    expect(resumir(so, periodoNomeado("hoje", AGORA) as never)[0]?.semCallback).toBe(0);
  });
  it("tabela e CSV trazem total e números completos", () => {
    const p = periodoNomeado("hoje", AGORA) as never;
    const l = resumir(entradas, p);
    expect(formatarTabela(l, p)).toContain("5500000111");
    expect(formatarTabela(l, p)).toContain("TOTAL");
    const csv = formatarCsv(l);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toContain("5500000111;1;1;2;1");
    expect(formatarTabela([], p)).toContain("nenhuma mensagem");
  });
});

describe("registro grava o funcionário e o relatório o lê de volta", () => {
  it("ida e volta", () => {
    const pasta = mkdtempSync(join(tmpdir(), "rel-"));
    const reg = new RegistroEmArquivo(pasta, undefined, () => new Date(2026, 9, 21, 9, 0, 0));
    reg.registrar({
      tipo: "transferencia",
      estado: "enviada",
      texto: "NAME: X",
      funcionario: "5500000111",
    });
    reg.registrar({
      tipo: "callback",
      estado: "enviada",
      texto: "CALLBACK",
      funcionario: "5500000111",
    });
    const txt = readFileSync(join(pasta, "transferencias-concluidas.txt"), "utf8");
    expect(txt).toContain("| Funcionário: 5500000111 =====");
    const e = lerRegistro(txt, "transferencia");
    expect(e.map((x) => [x.tipo, x.funcionario])).toEqual([
      ["transferencia", "5500000111"],
      ["callback", "5500000111"],
    ]);
    writeFileSync(join(pasta, "x"), "");
  });
});
