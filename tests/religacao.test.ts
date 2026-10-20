import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright";
import type { HospedeNavegador } from "../src/navegador/navegador.js";
import {
  carimbo,
  lerCallbacksManuais,
  linhaDeMarcacao,
} from "../src/relatorio/callbacks-manuais.js";
import { lerEnv } from "../src/relatorio/env.js";
import { dadosDasLigacoes, paginaHtml } from "../src/relatorio/pagina.js";
import {
  lerDuracoes,
  lerDuracoesAteTransferencia,
  lerRegistro,
  montarLigacoes,
  resumir,
  totalDe,
  type Ligacao,
} from "../src/relatorio/relatorio.js";
import { iniciarServidor, type ServidorRelatorio } from "../src/relatorio/servidor.js";
import { CHROMIUM_DE_TESTE, navegadorDeTeste } from "./helpers/navegador-teste.js";

/**
 * Regra da religação (só no relatório): o CALLBACK do bot é removido quando o MESMO cliente é transferido de novo, por qualquer
 * funcionário, até 60 min depois do CALLBACK, e essa nova transferência foi atendida por pelo menos 20 s (duração registrada).
 * As duas viram UMA transferência normal, contada na nova.
 */
const hoje = new Date();
const em = (h: number, m: number, s = 0): Date =>
  new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate(), h, m, s);
const A = "908113";
const B = "908114";
const X = "5511988887777";
const Y = "5511911112222";

interface T {
  q: Date;
  f: string;
  c: string | null;
  lig?: string | null;
  cb?: boolean;
  obs?: boolean;
}
const bloco = (b: T): string =>
  `===== ${carimbo(b.q)} | ${b.obs ? "OBSERVAÇÃO (não enviada)" : "ENVIADA"}${b.cb ? " | CALLBACK (ninguém atendeu)" : ""} | Funcionário: ${b.f}${
    b.c ? ` | Cliente: ${b.c}` : ""
  }${b.lig ? ` | Ligação: ${b.lig}` : ""} =====\n${b.cb ? "CALLBACK" : "NAME: X"}\n\n`;
const dur = (lig: string, s: number): string =>
  `${carimbo(em(23, 0))} | Ligação: ${lig} | Duração: ${s} s | Até a transferência: ${s} s\n`;

const PADRAO = { religacao: { janelaMs: 60 * 60_000, duracaoMinSeg: 20 } };
function montar(blocos: T[], duracoes = "", manuais = "", op = PADRAO) {
  return montarLigacoes(
    lerRegistro(blocos.map(bloco).join(""), "transferencia"),
    lerDuracoes(duracoes),
    lerCallbacksManuais(manuais),
    { ...op, ateTransferencia: lerDuracoesAteTransferencia(duracoes) },
  );
}
const tudo = { de: null, ate: null, rotulo: "" };
const total = (d: { ligacoes: readonly Ligacao[] }) =>
  totalDe(resumir({ ligacoes: d.ligacoes, longas: [] }, tudo));
const porLig = (d: { ligacoes: Ligacao[] }, codigo: string) =>
  d.ligacoes.find((l) => l.chave === `L:${codigo}`) as Ligacao;

// Cenário base: A transfere X às 9h00, ninguém atende (CALLBACK 9h01); B liga de novo e transfere X às 9h20, atendida por 45 s.
const BASE: T[] = [
  { q: em(9, 0), f: A, c: X, lig: "a1" },
  { q: em(9, 1), f: A, c: X, lig: "a1", cb: true },
  { q: em(9, 20), f: B, c: X, lig: "b1" },
];

describe("religação: o callback do bot é removido e as duas viram uma transferência", () => {
  it("caso do pedido: outro funcionário transfere de novo e é atendido por 45 s → 1 transferência, 0 callback", () => {
    const d = montar(BASE, dur("b1", 45));
    expect(porLig(d, "a1").callbackRemovido).toEqual({ quando: em(9, 20), funcionario: B });
    expect(porLig(d, "b1")).toMatchObject({ resultado: "atendida", substituiu: 1, duracaoSeg: 45 });
    const linhas = resumir({ ligacoes: d.ligacoes, longas: [] }, tudo);
    expect(linhas.find((l) => l.funcionario === A)).toBeUndefined(); // o callback (e a transferência) saem da linha 1
    expect(linhas.find((l) => l.funcionario === B)).toMatchObject({
      comCallback: 1,
      semCallback: 1,
      callbacks: 0,
      mediaSeg: 45,
    });
    expect(totalDe(linhas)).toMatchObject({
      comCallback: 1,
      semCallback: 1,
      callbacks: 0,
      comDuracao: 1,
    });
  });

  it("vale também quando é o MESMO funcionário que liga de novo", () => {
    const d = montar(
      [BASE[0] as T, BASE[1] as T, { q: em(9, 20), f: A, c: X, lig: "b1" }],
      dur("b1", 45),
    );
    expect(porLig(d, "a1").callbackRemovido).toBeDefined();
    expect(total(d)).toMatchObject({ comCallback: 1, callbacks: 0 });
  });

  it("sem a regra (janela 0 ou não informada) nada muda: 2 transferências, 1 callback", () => {
    for (const op of [{}, { religacao: { janelaMs: 0, duracaoMinSeg: 20 } }]) {
      const d = montar(BASE, dur("b1", 45), "", op as typeof PADRAO);
      expect(porLig(d, "a1").callbackRemovido).toBeUndefined();
      expect(total(d)).toMatchObject({ comCallback: 2, callbacks: 1 });
    }
  });
});

describe("religação: quando NÃO remove (para não errar)", () => {
  const removido = (blocos: T[], duracoes: string, manuais = "") =>
    montar(blocos, duracoes, manuais).ligacoes.some((l) => l.callbackRemovido);

  it("nova transferência curta (19 s) não remove; 20 s em diante remove (mesma regra do callback por ligação curta)", () => {
    expect(removido(BASE, dur("b1", 19))).toBe(false);
    expect(removido(BASE, dur("b1", 20))).toBe(true);
    expect(removido(BASE, dur("b1", 21))).toBe(true);
  });

  it("nova transferência sem duração registrada (ainda em andamento, ou registro antigo) não remove", () => {
    expect(removido(BASE, "")).toBe(false);
    expect(removido(BASE, dur("outra", 300))).toBe(false);
  });

  it("nova transferência que também deu callback não remove", () => {
    const d = montar([...BASE, { q: em(9, 21), f: B, c: X, lig: "b1", cb: true }], dur("b1", 45));
    expect(d.ligacoes.some((l) => l.callbackRemovido)).toBe(false);
    expect(total(d)).toMatchObject({ comCallback: 2, callbacks: 2 });
  });

  it("janela de 60 min contada a partir do CALLBACK: 10h01 ainda remove, 10h01min01s não", () => {
    const com = (q: Date) =>
      removido([BASE[0] as T, BASE[1] as T, { q, f: B, c: X, lig: "b1" }], dur("b1", 45));
    expect(com(em(10, 1, 0))).toBe(true);
    expect(com(em(10, 1, 1))).toBe(false);
    // CALLBACK registrado tarde (9h30): a janela vai até 10h30, mesmo a transferência original sendo das 9h00
    const tarde: T[] = [
      BASE[0] as T,
      { q: em(9, 30), f: A, c: X, lig: "a1", cb: true },
      { q: em(10, 25), f: B, c: X, lig: "b1" },
    ];
    expect(removido(tarde, dur("b1", 45))).toBe(true);
  });

  it("outro cliente não remove; cliente desconhecido (registro antigo sem telefone) não remove", () => {
    expect(
      removido(
        [BASE[0] as T, BASE[1] as T, { q: em(9, 20), f: B, c: Y, lig: "b1" }],
        dur("b1", 45),
      ),
    ).toBe(false);
    const semCliente: T[] = [
      { q: em(9, 0), f: A, c: null, lig: "a1" },
      { q: em(9, 1), f: A, c: null, lig: "a1", cb: true },
      { q: em(9, 20), f: B, c: null, lig: "b1" },
    ];
    expect(removido(semCliente, dur("b1", 45))).toBe(false);
  });

  it("transferência atendida ANTES do callback não remove (tem de ser uma nova ligação, depois)", () => {
    const antes: T[] = [
      { q: em(8, 40), f: B, c: X, lig: "b0" },
      { q: em(9, 0), f: A, c: X, lig: "a1" },
      { q: em(9, 1), f: A, c: X, lig: "a1", cb: true },
    ];
    expect(removido(antes, dur("b0", 300))).toBe(false);
    // e um callback que vem DEPOIS de uma atendida não é removido por ela
    const depois: T[] = [
      { q: em(9, 0), f: B, c: X, lig: "b0" },
      { q: em(9, 10), f: A, c: X, lig: "a1" },
      { q: em(9, 11), f: A, c: X, lig: "a1", cb: true },
    ];
    expect(removido(depois, dur("b0", 300))).toBe(false);
  });

  it("prévia do modo observação não se mistura com mensagem enviada", () => {
    const misto: T[] = [
      BASE[0] as T,
      BASE[1] as T,
      { q: em(9, 20), f: B, c: X, lig: "b1", obs: true },
    ];
    expect(removido(misto, dur("b1", 45))).toBe(false);
  });

  it("callback marcado à mão no relatório fica como está; e se a nova transferência for marcada à mão como callback, o callback antigo volta", () => {
    const manualA: T[] = [
      { q: em(9, 0), f: A, c: X, lig: "a1" },
      { q: em(9, 20), f: B, c: X, lig: "b1" },
    ];
    expect(removido(manualA, dur("b1", 45), linhaDeMarcacao("L:a1", true, em(12, 0)))).toBe(false);
    expect(removido(BASE, dur("b1", 45), linhaDeMarcacao("L:b1", true, em(12, 0)))).toBe(false);
    // desfez a marcação da nova → remove de novo
    expect(
      removido(
        BASE,
        dur("b1", 45),
        linhaDeMarcacao("L:b1", true, em(12, 0)) + linhaDeMarcacao("L:b1", false, em(12, 5)),
      ),
    ).toBe(true);
  });
});

describe("religação: casos com mais de um callback", () => {
  it("duas tentativas com callback e a terceira atendida → as três viram 1 transferência (a terceira substitui 2)", () => {
    const d = montar(
      [
        { q: em(9, 0), f: A, c: X, lig: "a1" },
        { q: em(9, 1), f: A, c: X, lig: "a1", cb: true },
        { q: em(9, 10), f: A, c: X, lig: "a2" },
        { q: em(9, 11), f: A, c: X, lig: "a2", cb: true },
        { q: em(9, 30), f: B, c: X, lig: "b1" },
      ],
      dur("b1", 90),
    );
    expect(porLig(d, "a1").callbackRemovido).toBeDefined();
    expect(porLig(d, "a2").callbackRemovido).toBeDefined();
    expect(porLig(d, "b1").substituiu).toBe(2);
    expect(total(d)).toMatchObject({ comCallback: 1, semCallback: 1, callbacks: 0 });
  });

  it("cada callback usa a SUA janela: o de 9h01 fica (nova às 10h20 passou de 60 min), o de 9h41 é removido", () => {
    const d = montar(
      [
        { q: em(9, 0), f: A, c: X, lig: "a1" },
        { q: em(9, 1), f: A, c: X, lig: "a1", cb: true },
        { q: em(9, 40), f: A, c: X, lig: "a2" },
        { q: em(9, 41), f: A, c: X, lig: "a2", cb: true },
        { q: em(10, 20), f: B, c: X, lig: "b1" },
      ],
      dur("b1", 90),
    );
    expect(porLig(d, "a1").callbackRemovido).toBeUndefined();
    expect(porLig(d, "a2").callbackRemovido).toBeDefined();
    expect(total(d)).toMatchObject({ comCallback: 2, callbacks: 1 });
  });

  it("o callback vai para a PRIMEIRA nova transferência atendida (a seguinte conta normalmente)", () => {
    const d = montar(
      [...BASE, { q: em(9, 40), f: B, c: X, lig: "b2" }],
      dur("b1", 45) + dur("b2", 60),
    );
    expect(porLig(d, "a1").callbackRemovido?.quando).toEqual(em(9, 20));
    expect(porLig(d, "b1").substituiu).toBe(1);
    expect(porLig(d, "b2").substituiu).toBeUndefined();
    expect(total(d)).toMatchObject({ comCallback: 2, semCallback: 2, callbacks: 0 });
  });

  it("callback sem a transferência no registro e registro antigo sem código também são removidos", () => {
    const orfao = montar(
      [
        { q: em(9, 1), f: A, c: X, lig: "a1", cb: true },
        { q: em(9, 20), f: B, c: X, lig: "b1" },
      ],
      dur("b1", 45),
    );
    expect(orfao.ligacoes.find((l) => l.semTransferencia)?.callbackRemovido).toBeDefined();
    expect(total(orfao)).toMatchObject({ comCallback: 1, callbacks: 0 });

    const antigo = montar(
      [
        { q: em(9, 0), f: A, c: X, lig: null },
        { q: em(9, 1), f: A, c: X, lig: null, cb: true },
        { q: em(9, 20), f: B, c: X, lig: "b1" },
      ],
      dur("b1", 45),
    );
    expect(antigo.ligacoes.find((l) => l.chave?.startsWith("T:"))?.callbackRemovido).toBeDefined();
    expect(total(antigo)).toMatchObject({ comCallback: 1, callbacks: 0 });
  });
});

describe("religação: configuração do relatório (.env)", () => {
  const env = (texto: string) => {
    const f = join(mkdtempSync(join(tmpdir(), "tb-env-")), ".env");
    writeFileSync(f, texto);
    return lerEnv(f).religacao;
  };
  it("padrão 60 min e 20 s; lê CALLBACK_RELIGACAO_MIN e CALLBACK_DURACAO_SEG; valor inválido usa o padrão", () => {
    expect(env("")).toEqual({ janelaMs: 3_600_000, duracaoMinSeg: 20 });
    expect(env("CALLBACK_RELIGACAO_MIN=30\nCALLBACK_DURACAO_SEG=25\n")).toEqual({
      janelaMs: 1_800_000,
      duracaoMinSeg: 25,
    });
    expect(env("CALLBACK_RELIGACAO_MIN=0\n")).toMatchObject({ janelaMs: 0 });
    expect(env("CALLBACK_RELIGACAO_MIN=abc\nCALLBACK_DURACAO_SEG=-5\n")).toEqual({
      janelaMs: 3_600_000,
      duracaoMinSeg: 20,
    });
    expect(lerEnv(join(tmpdir(), "nao-existe", ".env")).religacao).toEqual({
      janelaMs: 3_600_000,
      duracaoMinSeg: 20,
    });
  });
});

describe.skipIf(!CHROMIUM_DE_TESTE)("religação na página do relatório", () => {
  let host: HospedeNavegador;
  let pagina: Page;
  let srv: ServidorRelatorio;
  const pasta = mkdtempSync(join(tmpdir(), "tb-relig-"));
  const manuais: string[] = [];
  const dados = () => montar(BASE, dur("b1", 45), manuais.join(""));
  const TOKEN = "b2".repeat(24);
  const resumo = () =>
    pagina.evaluate(
      () =>
        (window as unknown as { __relatorio: { total: Record<string, number> } }).__relatorio.total,
    );
  const textoLista = () => pagina.locator("#detalhe tbody").innerText();

  beforeAll(async () => {
    srv = await iniciarServidor({
      token: TOKEN,
      pagina: () =>
        paginaHtml({
          geradoEm: new Date(),
          ...dados(),
          inicial: { periodo: "hoje" },
          servidor: { token: TOKEN },
        }),
      marcar: (chave, marcar) => (manuais.push(linhaDeMarcacao(chave, marcar, new Date())), true),
      ligacoes: () => dadosDasLigacoes(dados().ligacoes),
    });
    host = await navegadorDeTeste();
    pagina = host.paginaPrincipal();
    await pagina.setViewportSize({ width: 1200, height: 900 });
    await pagina.goto(srv.url);
  }, 60_000);
  afterAll(async () => {
    await host?.encerrar();
    await srv?.fechar();
  });

  it("conta 1 transferência sem callback; a lista mostra as duas, com 'Callback removido' explicado", async () => {
    expect(await resumo()).toMatchObject({ total: 1, sem: 1, cb: 0, nd: 1, ds: 45 });
    expect(await pagina.locator("#detalhe tbody tr").count()).toBe(2);
    const t = await textoLista();
    expect(t).toContain("Callback removido");
    expect(t).toContain(`por ${B} (sem apelido) e atendido`);
    expect(t).toContain("substitui 1 callback anterior do mesmo cliente");
    expect(await pagina.locator("#tabela tbody").innerText()).not.toContain(A);
  });

  it("marcar a nova transferência como callback (à mão) faz o callback antigo voltar, sem recarregar a página", async () => {
    await pagina.locator("#detalhe button.mini", { hasText: "Marcar como callback" }).click();
    await pagina.locator("#conf-sim").click();
    await expect.poll(() => pagina.locator("#confirma").isVisible()).toBe(false);
    expect(await resumo()).toMatchObject({ total: 2, sem: 0, cb: 2 });
    expect(await textoLista()).not.toContain("Callback removido");
    // desfazer → volta a ser uma transferência só
    await pagina.locator("#detalhe button.mini", { hasText: "Desfazer" }).click();
    await pagina.locator("#conf-sim").click();
    await expect.poll(() => pagina.locator("#confirma").isVisible()).toBe(false);
    expect(await resumo()).toMatchObject({ total: 1, sem: 1, cb: 0 });
    expect(await textoLista()).toContain("Callback removido");
  });

  it("arquivo sem servidor (relatorio.html) aplica a mesma regra", async () => {
    const f = join(pasta, "r.html");
    writeFileSync(
      f,
      paginaHtml({ geradoEm: new Date(), ...dados(), inicial: { periodo: "hoje" } }),
    );
    await pagina.goto(`file://${f}`);
    expect(await resumo()).toMatchObject({ total: 1, sem: 1, cb: 0 });
  });
});
