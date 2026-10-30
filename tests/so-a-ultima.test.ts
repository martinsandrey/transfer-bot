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
  lerRegistro,
  montarLigacoes,
  resumir,
  totalDe,
  type Ligacao,
} from "../src/relatorio/relatorio.js";
import { iniciarServidor, type ServidorRelatorio } from "../src/relatorio/servidor.js";
import { CHROMIUM_DE_TESTE, navegadorDeTeste } from "./helpers/navegador-teste.js";

/**
 * Regra "só a última conta" (decisão do usuário, 2026-10-30): por cliente (telefone) e por dia, conta apenas a ÚLTIMA transferência,
 * no funcionário dela. A última vale pelo que aconteceu com ela (callback ou concluída). As anteriores ficam riscadas na lista e
 * não entram em nenhuma conta. Só no relatório: o Telegram não muda.
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

const LIGADA = { religacao: { janelaMs: 60 * 60_000 } };
function montar(blocos: T[], manuais = "", op: Parameters<typeof montarLigacoes>[3] = LIGADA) {
  return montarLigacoes(
    lerRegistro(blocos.map(bloco).join(""), "transferencia"),
    new Map(),
    lerCallbacksManuais(manuais),
    op,
  );
}
const tudo = { de: null, ate: null, rotulo: "" };
const total = (d: { ligacoes: readonly Ligacao[] }) =>
  totalDe(resumir({ ligacoes: d.ligacoes, longas: [] }, tudo));
const porLig = (d: { ligacoes: Ligacao[] }, codigo: string) =>
  d.ligacoes.find((l) => l.chave === `L:${codigo}`) as Ligacao;

// Cenário base: A transfere X às 9h00, ninguém atende (CALLBACK 9h01); B liga de novo e transfere X às 9h20.
const BASE: T[] = [
  { q: em(9, 0), f: A, c: X, lig: "a1" },
  { q: em(9, 1), f: A, c: X, lig: "a1", cb: true },
  { q: em(9, 20), f: B, c: X, lig: "b1" },
];

describe("só a última conta: callback e nova transferência no mesmo dia", () => {
  it("o pedido: callback e depois a transferência do mesmo cliente = 1 transferência concluída, 0 callback", () => {
    const d = montar(BASE);
    expect(porLig(d, "a1").callbackRemovido).toMatchObject({ funcionario: B, eraCallback: true });
    expect(porLig(d, "b1").callbackRemovido).toBeUndefined();
    expect(porLig(d, "b1").substituiu).toBe(1);
    expect(total(d)).toMatchObject({ comCallback: 1, semCallback: 1, callbacks: 0 });
  });

  it("não exige tempo mínimo nem duração da nova transferência: ela só tem de ter acontecido depois, no mesmo dia", () => {
    expect(total(montar(BASE))).toMatchObject({ comCallback: 1, callbacks: 0 });
  });

  it("a mesma regra para o mesmo funcionário que liga de novo", () => {
    const d = montar([BASE[0] as T, BASE[1] as T, { q: em(9, 20), f: A, c: X, lig: "a2" }]);
    expect(total(d)).toMatchObject({ comCallback: 1, callbacks: 0 });
    expect(porLig(d, "a1").callbackRemovido).toBeDefined();
  });

  it("sem nova transferência no dia o callback continua valendo", () => {
    const d = montar([BASE[0] as T, BASE[1] as T]);
    expect(total(d)).toMatchObject({ comCallback: 1, callbacks: 1 });
  });

  it("outro dia não conta: a transferência do dia seguinte não remove o callback de hoje", () => {
    const amanha = new Date(em(0, 5).getTime() + 24 * 3_600_000);
    const d = montar([BASE[0] as T, BASE[1] as T, { q: amanha, f: B, c: X, lig: "b1" }]);
    expect(d.ligacoes.some((l) => l.callbackRemovido)).toBe(false);
  });
});

describe("só a última conta: duas ou mais transferências do mesmo cliente no dia", () => {
  it("duas transferências sem callback: só a última conta (no funcionário dela); a primeira é desconsiderada", () => {
    const d = montar([
      { q: em(9, 0), f: A, c: X, lig: "a1" },
      { q: em(9, 30), f: B, c: X, lig: "b1" },
    ]);
    expect(porLig(d, "a1").callbackRemovido).toMatchObject({ funcionario: B, eraCallback: false });
    expect(total(d)).toMatchObject({ comCallback: 1, semCallback: 1, callbacks: 0 });
    const linhas = resumir({ ligacoes: d.ligacoes, longas: [] }, tudo);
    expect(linhas.map((x) => [x.funcionario, x.comCallback])).toEqual([[B, 1]]);
  });

  it("vale também para o mesmo funcionário nas duas", () => {
    const d = montar([
      { q: em(9, 0), f: A, c: X, lig: "a1" },
      { q: em(9, 30), f: A, c: X, lig: "a2" },
    ]);
    expect(total(d)).toMatchObject({ comCallback: 1 });
    expect(porLig(d, "a1").callbackRemovido).toBeDefined();
  });

  it("três transferências: só a terceira conta (vale no lugar de 2)", () => {
    const d = montar([
      { q: em(9, 0), f: A, c: X, lig: "a1" },
      { q: em(9, 30), f: B, c: X, lig: "b1" },
      { q: em(10, 0), f: A, c: X, lig: "a2" },
    ]);
    expect(total(d)).toMatchObject({ comCallback: 1 });
    expect(porLig(d, "a2").substituiu).toBe(2);
  });

  it("transferência concluída e depois callback do mesmo cliente: 1 callback (a última)", () => {
    const d = montar([
      { q: em(9, 0), f: A, c: X, lig: "a1" },
      { q: em(9, 30), f: B, c: X, lig: "b1" },
      { q: em(9, 31), f: B, c: X, lig: "b1", cb: true },
    ]);
    expect(total(d)).toMatchObject({ comCallback: 1, callbacks: 1 });
  });

  it("dois callbacks seguidos do mesmo cliente: só o último conta", () => {
    const d = montar([
      { q: em(9, 0), f: A, c: X, lig: "a1" },
      { q: em(9, 1), f: A, c: X, lig: "a1", cb: true },
      { q: em(9, 30), f: B, c: X, lig: "b1" },
      { q: em(9, 31), f: B, c: X, lig: "b1", cb: true },
    ]);
    expect(total(d)).toMatchObject({ comCallback: 1, callbacks: 1 });
    expect(porLig(d, "a1").callbackRemovido).toBeDefined();
  });

  it("clientes diferentes e cliente desconhecido não são agrupados", () => {
    const d = montar([
      { q: em(9, 0), f: A, c: X, lig: "a1" },
      { q: em(9, 30), f: B, c: Y, lig: "b1" },
      { q: em(9, 40), f: A, c: null, lig: "a3" },
      { q: em(9, 50), f: B, c: null, lig: "b3" },
    ]);
    expect(d.ligacoes.some((l) => l.callbackRemovido)).toBe(false);
    expect(total(d)).toMatchObject({ comCallback: 4 });
  });

  it("o mesmo telefone digitado com 0 na frente ou sem o 55 é o mesmo cliente", () => {
    const d = montar([
      { q: em(9, 0), f: A, c: "5511988887777", lig: "a1" },
      { q: em(9, 30), f: B, c: "011988887777", lig: "manual-ab12cd34" },
    ]);
    expect(total(d)).toMatchObject({ comCallback: 1 });
  });

  it("prévia do modo observação não se mistura com mensagem enviada", () => {
    const d = montar([
      { q: em(9, 0), f: A, c: X, lig: "a1" },
      { q: em(9, 30), f: B, c: X, lig: "b1", obs: true },
    ]);
    expect(d.ligacoes.some((l) => l.callbackRemovido)).toBe(false);
  });

  it("CALLBACK sem a transferência no registro (órfão) também some se o cliente foi transferido depois", () => {
    const d = montar([
      { q: em(9, 1), f: A, c: X, lig: "a1", cb: true },
      { q: em(9, 20), f: B, c: X, lig: "b1" },
    ]);
    expect(d.ligacoes.find((l) => l.semTransferencia)?.callbackRemovido).toBeDefined();
    expect(total(d)).toMatchObject({ comCallback: 1, callbacks: 0 });
  });

  it("callback marcado à mão numa transferência anterior some também; marcado na última, a última é callback", () => {
    const anterior = linhaDeMarcacao("L:a1", true, new Date());
    const d1 = montar(
      [
        { q: em(9, 0), f: A, c: X, lig: "a1" },
        { q: em(9, 30), f: B, c: X, lig: "b1" },
      ],
      anterior,
    );
    expect(total(d1)).toMatchObject({ comCallback: 1, callbacks: 0 });
    const ultima = linhaDeMarcacao("L:b1", true, new Date());
    const d2 = montar(
      [
        { q: em(9, 0), f: A, c: X, lig: "a1" },
        { q: em(9, 30), f: B, c: X, lig: "b1" },
      ],
      ultima,
    );
    expect(total(d2)).toMatchObject({ comCallback: 1, callbacks: 1 });
  });

  it("regra desligada (janela 0 ou não informada): tudo como está", () => {
    for (const op of [{}, { religacao: { janelaMs: 0 } }]) {
      const d = montar(BASE, "", op);
      expect(d.ligacoes.some((l) => l.callbackRemovido)).toBe(false);
      expect(total(d)).toMatchObject({ comCallback: 2, callbacks: 1 });
    }
  });
});

describe("só a última conta: configuração do relatório (.env)", () => {
  const env = (texto: string) => {
    const f = join(mkdtempSync(join(tmpdir(), "tb-env-")), ".env");
    writeFileSync(f, texto);
    return lerEnv(f).religacao;
  };
  it("CALLBACK_RELIGACAO_MIN só liga (padrão 60) ou desliga (0) a regra; inválido usa o padrão", () => {
    expect(env("")).toEqual({ janelaMs: 3_600_000 });
    expect(env("CALLBACK_RELIGACAO_MIN=30\n")).toEqual({ janelaMs: 1_800_000 });
    expect(env("CALLBACK_RELIGACAO_MIN=0\n")).toEqual({ janelaMs: 0 });
    expect(env("CALLBACK_RELIGACAO_MIN=abc\n")).toEqual({ janelaMs: 3_600_000 });
    expect(lerEnv(join(tmpdir(), "nao-existe", ".env")).religacao).toEqual({ janelaMs: 3_600_000 });
  });
});

describe.skipIf(!CHROMIUM_DE_TESTE)("só a última conta na página do relatório", () => {
  let host: HospedeNavegador;
  let pagina: Page;
  let srv: ServidorRelatorio;
  const pasta = mkdtempSync(join(tmpdir(), "tb-ultima-"));
  const manuais: string[] = [];
  const dados = () => montar(BASE, manuais.join(""));
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

  it("conta 1 transferência sem callback; a lista mostra as duas, a anterior riscada e explicada", async () => {
    expect(await resumo()).toMatchObject({ total: 1, sem: 1, cb: 0 });
    expect(await pagina.locator("#detalhe tbody tr").count()).toBe(2);
    const t = await textoLista();
    expect(t).toContain("Callback removido");
    expect(t).toContain(`por ${B} (sem apelido); no mesmo dia só a última transferência conta`);
    expect(t).toContain("vale no lugar de 1 transferência anterior do mesmo cliente no dia");
    expect(await pagina.locator("#tabela tbody").innerText()).not.toContain(A);
  });

  it("marcar a última como callback (à mão) deixa 1 callback (a anterior continua desconsiderada); desfazer volta", async () => {
    await pagina.locator("#detalhe button.mini", { hasText: "Marcar como callback" }).click();
    await pagina.locator("#conf-sim").click();
    await expect.poll(() => pagina.locator("#confirma").isVisible()).toBe(false);
    expect(await resumo()).toMatchObject({ total: 1, sem: 0, cb: 1 });
    await pagina.locator("#detalhe button.mini", { hasText: "Desfazer" }).click();
    await pagina.locator("#conf-sim").click();
    await expect.poll(() => pagina.locator("#confirma").isVisible()).toBe(false);
    expect(await resumo()).toMatchObject({ total: 1, sem: 1, cb: 0 });
  });

  it("duas transferências sem callback aparecem como 'Desconsiderada' (não 'Callback removido')", async () => {
    const f = join(pasta, "r.html");
    const d = montar([
      { q: em(9, 0), f: A, c: X, lig: "a1" },
      { q: em(9, 30), f: B, c: X, lig: "b1" },
    ]);
    writeFileSync(f, paginaHtml({ geradoEm: new Date(), ...d, inicial: { periodo: "hoje" } }));
    await pagina.goto(`file://${f}`);
    expect(await resumo()).toMatchObject({ total: 1, sem: 1, cb: 0 });
    const t = await textoLista();
    expect(t).toContain("Desconsiderada");
    expect(t).not.toContain("Callback removido");
  });
});
