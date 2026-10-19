import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { paginaHtml } from "../src/relatorio/pagina.js";
import { RegistroEmArquivo } from "../src/registro/registro-arquivo.js";
import {
  lerDuracoes,
  lerRegistro,
  montarLigacoes,
  periodoNomeado,
  periodoPorDatas,
  resumir,
  SEM_FUNCIONARIO,
  totalDe,
} from "../src/relatorio/relatorio.js";
import { idDaLigacao } from "../src/util/id-ligacao.js";
import { CHROMIUM_DE_TESTE, navegadorDeTeste } from "./helpers/navegador-teste.js";
import type { HospedeNavegador } from "../src/navegador/navegador.js";

interface B {
  ts: string;
  func?: string;
  cli?: string;
  lig?: string;
  cb?: boolean;
  obs?: boolean;
  corpo?: string;
}
const bloco = (b: B): string =>
  `===== ${b.ts} | ${b.obs ? "OBSERVAÇÃO (não enviada)" : "ENVIADA"}${b.cb ? " | CALLBACK (ninguém atendeu)" : ""}${
    b.func ? ` | Funcionário: ${b.func}` : ""
  }${b.cli ? ` | Cliente: ${b.cli}` : ""}${b.lig ? ` | Ligação: ${b.lig}` : ""} =====\n${b.corpo ?? (b.cb ? "CALLBACK" : "NAME: X")}\n\n`;

// 21/10/2026 é uma quarta-feira
const AGORA = new Date(2026, 9, 21, 15, 0, 0);
const A = "5500000111";
const B2 = "5500000121";

describe("lerRegistro", () => {
  it("lê funcionário, cliente e código da ligação do cabeçalho; marca callbacks", () => {
    const e = lerRegistro(
      bloco({ ts: "2026-10-21 09:00:00", func: A, cli: "5511987654321", lig: "abc" }) +
        bloco({ ts: "2026-10-21 09:01:00", func: A, cli: "5511987654321", lig: "abc", cb: true }),
      "transferencia",
    );
    expect(e.map((x) => [x.tipo, x.funcionario, x.cliente, x.ligacao])).toEqual([
      ["transferencia", A, "5511987654321", "abc"],
      ["callback", A, "5511987654321", "abc"],
    ]);
  });
  it("registro antigo: usa 'Line 1 number' e 'Ph' do texto; callback antigo vira não identificado", () => {
    const e = lerRegistro(
      bloco({
        ts: "2026-10-17 09:00:00",
        corpo: "NAME: X\nPh: 5511900\nLine 1 number: 5500000111\nNOTE:",
      }) + bloco({ ts: "2026-10-17 09:01:00", cb: true }),
      "transferencia",
    );
    expect(e[0]).toMatchObject({ funcionario: "5500000111", cliente: "5511900", ligacao: null });
    expect(e[1]?.funcionario).toBe(SEM_FUNCIONARIO);
  });
  it("aceita CRLF", () => {
    const t = bloco({ ts: "2026-10-21 09:00:00", func: A }).replace(/\n/g, "\r\n");
    expect(lerRegistro(t, "transferencia")).toHaveLength(1);
  });
});

describe("montarLigacoes: cada callback é ligado à transferência certa", () => {
  it("pelo código da ligação, mesmo fora de ordem e do mesmo funcionário (o callback NÃO é igual ao total)", () => {
    const txt =
      bloco({ ts: "2026-10-21 09:00:00", func: A, lig: "L1", cli: "111" }) +
      bloco({ ts: "2026-10-21 09:02:00", func: A, lig: "L2", cli: "222" }) +
      bloco({ ts: "2026-10-21 09:03:00", func: A, lig: "L3", cli: "333" }) +
      // só a L1 deu callback, mas o aviso chegou depois das outras transferências
      bloco({ ts: "2026-10-21 09:04:00", func: A, lig: "L1", cli: "111", cb: true });
    const { ligacoes } = montarLigacoes(lerRegistro(txt, "transferencia"));
    expect(ligacoes.map((l) => [l.cliente, l.resultado])).toEqual([
      ["111", "callback"],
      ["222", "atendida"],
      ["333", "atendida"],
    ]);
  });
  it("registro antigo: liga ao último do mesmo funcionário ainda sem callback, dentro da janela", () => {
    const txt =
      bloco({ ts: "2026-10-21 09:00:00", func: A }) +
      bloco({ ts: "2026-10-21 09:01:00", func: B2 }) +
      bloco({ ts: "2026-10-21 09:02:00", func: A, cb: true });
    const { ligacoes } = montarLigacoes(lerRegistro(txt, "transferencia"));
    expect(ligacoes.map((l) => [l.funcionario, l.resultado])).toEqual([
      [A, "callback"],
      [B2, "atendida"],
    ]);
  });
  it("callback antigo sem funcionário vai para a transferência anterior mais próxima; fora da janela vira órfão", () => {
    const txt =
      bloco({ ts: "2026-10-21 08:00:00", func: A }) +
      bloco({ ts: "2026-10-21 09:00:00", func: B2 }) +
      bloco({ ts: "2026-10-21 09:01:00", cb: true }) +
      bloco({ ts: "2026-10-21 14:00:00", cb: true });
    const { ligacoes } = montarLigacoes(lerRegistro(txt, "transferencia"));
    expect(ligacoes.find((l) => l.funcionario === B2)?.resultado).toBe("callback");
    expect(ligacoes.find((l) => l.funcionario === A)?.resultado).toBe("atendida");
    expect(ligacoes.filter((l) => l.semTransferencia)).toHaveLength(1);
  });
  it("cada transferência recebe no máximo um callback; prévia não casa com enviada", () => {
    const txt =
      bloco({ ts: "2026-10-21 09:00:00", func: A, lig: "L1" }) +
      bloco({ ts: "2026-10-21 09:01:00", func: A, lig: "L1", cb: true }) +
      bloco({ ts: "2026-10-21 09:02:00", func: A, lig: "L1", cb: true }) +
      bloco({ ts: "2026-10-21 10:00:00", func: A, lig: "L9", obs: true }) +
      bloco({ ts: "2026-10-21 10:01:00", func: A, lig: "L9", cb: true });
    const { ligacoes } = montarLigacoes(lerRegistro(txt, "transferencia"));
    expect(ligacoes.filter((l) => l.resultado === "callback" && !l.semTransferencia)).toHaveLength(
      1,
    );
    expect(ligacoes.filter((l) => l.semTransferencia)).toHaveLength(2);
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
  it("datas inclusivas; inválidas dão null; domingo fica na semana da segunda anterior", () => {
    expect(periodoPorDatas("2026-10-14", "2026-10-14")?.ate).toEqual(new Date(2026, 9, 15));
    expect(periodoPorDatas("2026-02-30", undefined)).toBeNull();
    expect(periodoPorDatas("2026-10-20", "2026-10-19")).toBeNull();
    expect(periodoNomeado("semana", new Date(2026, 9, 25, 10))?.de).toEqual(new Date(2026, 9, 19));
  });
});

const TRANSF =
  bloco({ ts: "2026-10-21 09:00:00", func: A, lig: "L1", cli: "111" }) +
  bloco({ ts: "2026-10-21 09:01:00", func: A, lig: "L1", cli: "111", cb: true }) +
  bloco({ ts: "2026-10-21 10:00:00", func: A, lig: "L2", cli: "222" }) +
  bloco({ ts: "2026-10-21 11:00:00", func: B2, lig: "L3", cli: "333" }) +
  bloco({ ts: "2026-10-20 09:00:00", func: A, lig: "L4", cli: "444" }) +
  bloco({ ts: "2026-10-14 09:00:00", func: B2, lig: "L5", cli: "555" }) +
  bloco({ ts: "2026-10-21 12:00:00", func: "5500000131", lig: "L6", obs: true });
const LONGA =
  bloco({ ts: "2026-10-21 09:30:00", func: "5500000101" }) +
  bloco({ ts: "2026-10-21 09:40:00", func: A });
const dados = () => ({
  ...montarLigacoes(
    [...lerRegistro(TRANSF, "transferencia"), ...lerRegistro(LONGA, "longa")].map((e, i) => ({
      ...e,
      ordem: i,
    })),
  ),
});

describe("resumir", () => {
  it("hoje: com/sem callback, callbacks e 5 min por funcionário", () => {
    const l = resumir(dados(), periodoNomeado("hoje", AGORA) as never);
    expect(l.find((x) => x.funcionario === A)).toMatchObject({
      comCallback: 2,
      semCallback: 1,
      callbacks: 1,
      longas: 1,
    });
    expect(l.find((x) => x.funcionario === B2)).toMatchObject({
      comCallback: 1,
      semCallback: 1,
      callbacks: 0,
    });
    expect(l.find((x) => x.funcionario === "5500000101")).toMatchObject({
      comCallback: 0,
      longas: 1,
    });
    expect(l.find((x) => x.funcionario === "5500000131")).toBeUndefined();
    expect(totalDe(l)).toMatchObject({ comCallback: 3, semCallback: 2, callbacks: 1, longas: 2 });
  });
  it("semana, tudo e observação", () => {
    const d = dados();
    expect(
      resumir(d, periodoNomeado("semana", AGORA) as never).find((x) => x.funcionario === A)
        ?.comCallback,
    ).toBe(3);
    expect(
      resumir(d, periodoNomeado("tudo", AGORA) as never).find((x) => x.funcionario === B2)
        ?.comCallback,
    ).toBe(2);
    expect(
      resumir(d, periodoNomeado("hoje", AGORA) as never, true).find(
        (x) => x.funcionario === "5500000131",
      )?.comCallback,
    ).toBe(1);
  });
});

describe("registro grava funcionário, cliente e código da ligação", () => {
  it("ida e volta, e o CALLBACK usa o mesmo código da transferência", () => {
    const pasta = mkdtempSync(join(tmpdir(), "rel-"));
    const reg = new RegistroEmArquivo(pasta, undefined, () => new Date(2026, 9, 21, 9, 0, 0));
    const lig = idDaLigacao("5500000111|T1|111");
    reg.registrar({
      tipo: "transferencia",
      estado: "enviada",
      texto: "NAME: X",
      funcionario: A,
      cliente: "111",
      ligacao: lig,
    });
    reg.registrar({
      tipo: "callback",
      estado: "enviada",
      texto: "CALLBACK",
      funcionario: A,
      cliente: "111",
      ligacao: lig,
    });
    const txt = readFileSync(join(pasta, "transferencias-concluidas.txt"), "utf8");
    expect(txt).not.toContain("5500000111|T1");
    const { ligacoes } = montarLigacoes(lerRegistro(txt, "transferencia"));
    expect(ligacoes).toHaveLength(1);
    expect(ligacoes[0]).toMatchObject({ funcionario: A, cliente: "111", resultado: "callback" });
    expect(idDaLigacao("a")).not.toBe(idDaLigacao("b"));
  });
});

describe.skipIf(!CHROMIUM_DE_TESTE)("página HTML (navegador de verdade)", () => {
  let host: HospedeNavegador;
  let arquivo: string;
  beforeAll(async () => {
    host = await navegadorDeTeste();
    const agora = new Date();
    const h = (min: number) =>
      new Date(agora.getFullYear(), agora.getMonth(), agora.getDate(), 0, 0, 5 + min);
    const ontem = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate() - 1, 12, 0, 0);
    arquivo = join(mkdtempSync(join(tmpdir(), "pag-")), "r.html");
    writeFileSync(
      arquivo,
      paginaHtml({
        geradoEm: agora,
        longas: [
          { quando: h(1), funcionario: A, cliente: "9", observacao: false, transferida: null },
        ],
        ligacoes: [
          {
            quando: h(1),
            funcionario: A,
            cliente: "111",
            resultado: "callback",
            observacao: false,
            semTransferencia: false,
            duracaoSeg: null,
          },
          {
            quando: h(2),
            funcionario: A,
            cliente: "222",
            resultado: "atendida",
            observacao: false,
            semTransferencia: false,
            duracaoSeg: 120,
          },
          {
            quando: h(3),
            funcionario: B2,
            cliente: "<b>x</b>",
            resultado: "atendida",
            observacao: false,
            semTransferencia: false,
            duracaoSeg: 300,
          },
          {
            quando: ontem,
            funcionario: B2,
            cliente: "444",
            resultado: "callback",
            observacao: false,
            semTransferencia: false,
            duracaoSeg: null,
          },
          {
            quando: h(4),
            funcionario: A,
            cliente: "555",
            resultado: "atendida",
            observacao: true,
            semTransferencia: false,
            duracaoSeg: 600,
          },
        ],
        inicial: { periodo: "hoje" },
      }),
      "utf8",
    );
  }, 60_000);
  afterAll(async () => host?.encerrar());

  it("mostra os números certos por filtro, sem erro de script e sem interpretar HTML dos dados", async () => {
    const pagina = host.paginaPrincipal();
    const erros: string[] = [];
    pagina.on("pageerror", (e) => erros.push(String(e)));
    await pagina.goto(`file://${arquivo}`);
    const lerTotais = () =>
      pagina.evaluate(
        () => (window as unknown as { __relatorio: { total: unknown } }).__relatorio.total,
      );
    expect(await lerTotais()).toEqual({ total: 3, sem: 2, cb: 1, lg: 1, ds: 420, nd: 2 }); // hoje, sem prévias
    await pagina.click('button[data-p="ontem"]');
    expect(await lerTotais()).toEqual({ total: 1, sem: 0, cb: 1, lg: 0, ds: 0, nd: 0 });
    await pagina.click('button[data-p="tudo"]');
    expect(await lerTotais()).toEqual({ total: 4, sem: 2, cb: 2, lg: 1, ds: 420, nd: 2 });
    await pagina.click('button[data-p="hoje"]');
    await pagina.check("#obs");
    expect(await lerTotais()).toEqual({ total: 4, sem: 3, cb: 1, lg: 1, ds: 1020, nd: 3 });
    expect(await pagina.locator("#detalhe tbody b").count()).toBe(0); // dado nunca vira HTML
    expect(await pagina.locator("#tabela tbody tr").first().innerText()).toContain(A);
    // média na tela: 420 s ÷ 2 = 3 min 30 s (só transferências sem callback, hoje)
    await pagina.click('button[data-p="hoje"]');
    await pagina.uncheck("#obs");
    expect(await pagina.locator("#cartoes").innerText()).toContain("3 min 30 s");
    expect(await pagina.locator("#tabela tfoot").innerText()).toContain("3 min 30 s");
    expect(erros).toEqual([]);
  }, 60_000);
});

describe("CALLBACK por ligação curta no registro e na configuração", () => {
  it("o registro anota o motivo e o relatório continua ligando o callback à transferência", () => {
    const pasta = mkdtempSync(join(tmpdir(), "rel-"));
    const reg = new RegistroEmArquivo(pasta, undefined, () => new Date(2026, 9, 21, 9, 0, 0));
    const lig = idDaLigacao("v1");
    reg.registrar({
      tipo: "transferencia",
      estado: "enviada",
      texto: "NAME: X",
      funcionario: A,
      cliente: "1",
      ligacao: lig,
    });
    reg.registrar({
      tipo: "callback",
      estado: "enviada",
      texto: "CALLBACK",
      funcionario: A,
      cliente: "1",
      ligacao: lig,
      detalhe: "ligação de 12 s",
    });
    const txt = readFileSync(join(pasta, "transferencias-concluidas.txt"), "utf8");
    expect(txt).toContain("CALLBACK (ligação de 12 s)");
    const { ligacoes } = montarLigacoes(lerRegistro(txt, "transferencia"));
    expect(ligacoes).toHaveLength(1);
    expect(ligacoes[0]?.resultado).toBe("callback");
  });
  it("CALLBACK_DURACAO_SEG: padrão 20, configurável, 0 desliga, inválido dá erro", async () => {
    const { validarConfig } = await import("../src/config/config.js");
    const base = { SITE_URL: "https://exemplo.invalid/" };
    expect(validarConfig(base).monitor.callbackDuracaoSeg).toBe(20);
    expect(validarConfig({ ...base, CALLBACK_DURACAO_SEG: "30" }).monitor.callbackDuracaoSeg).toBe(
      30,
    );
    expect(validarConfig({ ...base, CALLBACK_DURACAO_SEG: "0" }).monitor.callbackDuracaoSeg).toBe(
      0,
    );
    expect(() => validarConfig({ ...base, CALLBACK_DURACAO_SEG: "vinte" })).toThrow(
      /CALLBACK_DURACAO_SEG/,
    );
  });
});

describe("duração média das transferências sem callback", () => {
  const dur = (s: string) => lerDuracoes(s);
  it("lê duracoes.txt (última linha vale; lixo é ignorado)", () => {
    const m = dur(
      "2026-10-21 09:05:00 | Ligação: aaa | Duração: 143 s\nlixo\n2026-10-21 09:06:00 | Ligação: bbb | Duração: 60 s\n2026-10-21 09:07:00 | Ligação: aaa | Duração: 150 s\r\n",
    );
    expect(m.get("aaa")).toBe(150);
    expect(m.get("bbb")).toBe(60);
    expect(m.size).toBe(2);
  });
  it("média só das transferências sem callback que têm duração; callback e ligações sem duração ficam de fora", () => {
    const txt =
      bloco({ ts: "2026-10-21 09:00:00", func: A, lig: "L1" }) + // 120 s
      bloco({ ts: "2026-10-21 10:00:00", func: A, lig: "L2" }) + // 240 s
      bloco({ ts: "2026-10-21 11:00:00", func: A, lig: "L3" }) + // callback (tem duração registrada por engano: ignorada)
      bloco({ ts: "2026-10-21 11:01:00", func: A, lig: "L3", cb: true }) +
      bloco({ ts: "2026-10-21 12:00:00", func: A, lig: "L4" }) + // sem duração (registro antigo)
      bloco({ ts: "2026-10-21 13:00:00", func: B2, lig: "L5" }); // 30 s
    const duracoes = new Map([
      ["L1", 120],
      ["L2", 240],
      ["L3", 999],
      ["L5", 30],
    ]);
    const d = montarLigacoes(lerRegistro(txt, "transferencia"), duracoes);
    const linhas = resumir(d, periodoNomeado("hoje", AGORA) as never);
    const a = linhas.find((x) => x.funcionario === A);
    expect(a).toMatchObject({
      comCallback: 4,
      callbacks: 1,
      semCallback: 3,
      comDuracao: 2,
      mediaSeg: 180,
    });
    expect(linhas.find((x) => x.funcionario === B2)).toMatchObject({ mediaSeg: 30, comDuracao: 1 });
    expect(totalDe(linhas)).toMatchObject({ comDuracao: 3, mediaSeg: 130 });
  });
  it("sem nenhuma duração registrada: média nula (a página mostra um traço)", () => {
    const d = montarLigacoes(
      lerRegistro(bloco({ ts: "2026-10-21 09:00:00", func: A, lig: "L1" }), "transferencia"),
    );
    expect(resumir(d, periodoNomeado("hoje", AGORA) as never)[0]?.mediaSeg).toBeNull();
  });
  it("o registro grava a duração e o relatório lê de volta pelo mesmo código da ligação", () => {
    const pasta = mkdtempSync(join(tmpdir(), "rel-"));
    const reg = new RegistroEmArquivo(pasta, undefined, () => new Date(2026, 9, 21, 9, 5, 0));
    const lig = idDaLigacao("v7");
    reg.registrar({
      tipo: "transferencia",
      estado: "enviada",
      texto: "NAME: X",
      funcionario: A,
      cliente: "1",
      ligacao: lig,
    });
    reg.registrarDuracao({ ligacao: lig, duracaoSeg: 143.4 });
    const m = lerDuracoes(readFileSync(join(pasta, "duracoes.txt"), "utf8"));
    expect(m.get(lig)).toBe(143);
    const d = montarLigacoes(
      lerRegistro(
        readFileSync(join(pasta, "transferencias-concluidas.txt"), "utf8"),
        "transferencia",
      ),
      m,
    );
    expect(d.ligacoes[0]?.duracaoSeg).toBe(143);
  });
});
