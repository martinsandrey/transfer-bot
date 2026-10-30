import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { interpretarApelidos, rotuloDoFuncionario } from "../src/config/apelidos.js";
import { validarConfig } from "../src/config/config.js";
import type { TableReader, TableSnapshot } from "../src/dominio/tipos.js";
import type { TaskQueue } from "../src/fila/task-queue.js";
import type { CallTracker, EventoTracker } from "../src/monitor/call-tracker.js";
import { Monitor } from "../src/monitor/monitor.js";
import type { HospedeNavegador } from "../src/navegador/navegador.js";
import { criarNotificadorFalso } from "../src/notificador/notificador.js";
import { paginaHtml } from "../src/relatorio/pagina.js";
import {
  lerRegistro,
  montarLigacoes,
  periodoNomeado,
  resumir,
  totalDe,
} from "../src/relatorio/relatorio.js";
import { CHROMIUM_DE_TESTE, navegadorDeTeste } from "./helpers/navegador-teste.js";

const MEU = "5500000111";
const OUTRO = "5500000101";

interface B {
  ts: string;
  func: string;
  lig?: string;
  tipo?: "transferencia" | "callback" | "longa";
  cb?: boolean;
}
const bloco = (b: B): string =>
  `===== ${b.ts} | ENVIADA${b.cb ? " | CALLBACK (ninguém atendeu)" : ""}${b.tipo ? ` | Tipo: ${b.tipo}` : ""} | Funcionário: ${b.func} | Cliente: 0119 | Ligação: ${b.lig ?? "x"} =====\n\n`;

describe("apelidos", () => {
  it("lê 'número=Nome; número=Nome' e mostra SEMPRE nome e número juntos", () => {
    const { apelidos, invalidos } = interpretarApelidos("908113=Maria; 908114 = João Silva ;;");
    expect(invalidos).toEqual([]);
    expect(rotuloDoFuncionario("908113", apelidos)).toBe("Maria (908113)");
    expect(rotuloDoFuncionario("908114", apelidos)).toBe("João Silva (908114)");
    expect(rotuloDoFuncionario("908115", apelidos)).toBe("908115 (sem apelido)");
    expect(rotuloDoFuncionario("+55 908113", new Map([["55908113", "Ana"]]))).toBe(
      "Ana (+55 908113)",
    );
  });
  it("itens inválidos são apontados (config dá erro em português)", () => {
    expect(interpretarApelidos("908113; =Nome; 123=").invalidos).toHaveLength(3);
    const base = { SITE_URL: "https://exemplo.invalid/" };
    expect(() => validarConfig({ ...base, APELIDOS_FUNCIONARIOS: "sem-igual" })).toThrow(
      /APELIDOS_FUNCIONARIOS/,
    );
    expect(
      validarConfig({ ...base, APELIDOS_FUNCIONARIOS: "908113=Maria" }).apelidos.get("908113"),
    ).toBe("Maria");
  });
});

describe("monitor: apelido nos avisos", () => {
  const log = { debug() {}, info() {}, warn() {}, error() {} };
  async function rodar(ev: EventoTracker[], extra: Record<string, unknown>) {
    const tracker = { ingest: () => ev.splice(0), sweep() {} } as unknown as CallTracker;
    const reader: TableReader = {
      read: async (): Promise<TableSnapshot> => ({ readAt: 1, rows: [], valid: true }),
    };
    const notif = criarNotificadorFalso();
    const m = new Monitor(
      {
        reader,
        tracker,
        fila: { enqueue: () => null, drenar: async () => {} } as unknown as TaskQueue,
        log,
        notificador: notif,
      },
      { intervaloMs: 1, invalidasParaAlertar: 3, falhasParaAlertar: 3, limpezaMs: 1e6, ...extra },
    );
    const c = new AbortController();
    const p = m.executar(c.signal);
    await new Promise((r) => setTimeout(r, 25));
    c.abort();
    await p;
    return { notif };
  }
  const t = (cb: string): EventoTracker => ({
    tipo: "transferencia",
    ocorrencia: "o",
    chave: "k" + cb,
    callback: cb,
    callee: "5511987654321",
    vinculo: "v" + cb,
    fase: "agent",
  });
  it("o aviso mostra 'Nome (número)'", async () => {
    const { notif } = await rodar([t("908113")], { apelidos: new Map([["908113", "Maria"]]) });
    expect(notif.alertas[0]?.mensagem).toContain("funcionário Maria (908113)");
  });
});

describe("ligação de 5 min → transferência", () => {
  it("5 min que viraram transferência por funcionário e no total, e as que não", () => {
    const longa =
      bloco({ ts: "2026-10-21 09:00:00", func: MEU, lig: "A" }) + // vira transferência
      bloco({ ts: "2026-10-21 09:10:00", func: MEU, lig: "B" }) + // não vira
      bloco({ ts: "2026-10-21 09:20:00", func: OUTRO, lig: "C" }) + // vira
      bloco({ ts: "2026-10-21 09:30:00", func: OUTRO, lig: "D" }) + // não vira
      bloco({ ts: "2026-10-21 09:40:00", func: OUTRO, lig: "D" }); // repetição do mesmo código: não conta de novo
    const transf =
      bloco({ ts: "2026-10-21 09:05:00", func: MEU, lig: "A" }) +
      bloco({ ts: "2026-10-21 09:25:00", func: OUTRO, lig: "C" });
    const antigo = bloco({ ts: "2026-10-21 09:50:00", func: MEU, lig: "" }).replace(
      " | Ligação: ",
      "",
    );
    const d = montarLigacoes([
      ...lerRegistro(longa, "longa"),
      ...lerRegistro(transf, "transferencia"),
      ...lerRegistro(antigo, "longa").map((x) => ({ ...x, ligacao: null })),
    ]);
    const linhas = resumir(d, periodoNomeado("tudo", new Date(2026, 9, 21)) as never);
    const a = linhas.find((x) => x.funcionario === MEU);
    const b = linhas.find((x) => x.funcionario === OUTRO);
    expect(a).toMatchObject({ longas: 3, longasAvaliadas: 2, longasTransferidas: 1 }); // a antiga (sem código) não entra nas %
    expect(b).toMatchObject({ longas: 2, longasAvaliadas: 2, longasTransferidas: 1 });
    expect(totalDe(linhas)).toMatchObject({ longasAvaliadas: 4, longasTransferidas: 2 });
  });
});

describe.skipIf(!CHROMIUM_DE_TESTE)(
  "página: apelidos, 5 min → transferência e meio-dia (Brasília)",
  () => {
    let host: HospedeNavegador;
    let pagina: Page;
    // Brasília = UTC-3: 10h BRT = 13h UTC; 12h BRT = 15h UTC; 14h BRT = 17h UTC
    const brt = (h: number, m = 0): Date => new Date(Date.UTC(2026, 9, 21, h + 3, m, 0));
    const lig = (h: number, f: string, r: "atendida" | "callback", d: number | null) => ({
      quando: brt(h),
      funcionario: f,
      cliente: "0119",
      resultado: r,
      observacao: false,
      semTransferencia: false,
      duracaoSeg: d,
      duracaoAteTransfSeg: d,
    });
    const lon = (h: number, f: string, x: boolean | null) => ({
      quando: brt(h),
      funcionario: f,
      cliente: "0119",
      observacao: false,
      transferida: x,
    });
    const lerTotais = <K extends string>(k: K) =>
      pagina.evaluate(
        (c) => (window as unknown as Record<string, Record<string, unknown>>)["__relatorio"]?.[c],
        k,
      );

    beforeAll(async () => {
      host = await navegadorDeTeste();
      const arquivo = join(mkdtempSync(join(tmpdir(), "mc-")), "r.html");
      writeFileSync(
        arquivo,
        paginaHtml({
          geradoEm: new Date(),
          apelidos: new Map([["5500000111", "Maria"]]),
          ligacoes: [
            lig(10, MEU, "atendida", 120),
            lig(11, MEU, "callback", null), // manhã: 2 transf, 1 callback
            lig(14, MEU, "callback", null), // tarde: 1 transf, 1 callback
            lig(10, OUTRO, "atendida", 60),
            lig(15, OUTRO, "atendida", 240),
          ],
          longas: [
            lon(9, MEU, true),
            lon(10, MEU, false),
            lon(11, MEU, true), // manhã: 3, 2 transferidas
            lon(13, MEU, false),
            lon(16, MEU, false), // tarde: 2, 0 transferidas
            lon(9, OUTRO, true),
            lon(13, OUTRO, true),
            lon(14, OUTRO, false),
          ],
          inicial: { periodo: "tudo" },
        }),
        "utf8",
      );
      pagina = host.paginaPrincipal();
      await pagina.setViewportSize({ width: 1300, height: 900 });
      await pagina.goto(`file://${arquivo}`);
    }, 60_000);
    afterAll(async () => host?.encerrar());

    it("apelido sempre junto do número (nunca só um deles)", async () => {
      const nomes = await pagina.$$eval("#tabela tbody tr td:first-child", (e) =>
        e.map((x) => (x as HTMLElement).innerText),
      );
      expect(nomes).toContain("Maria (5500000111)");
      expect(nomes).toContain("5500000101 (sem apelido)");
      for (const n of nomes) expect(n).toMatch(/\(.+\)/);
      const detalhe = await pagina.$$eval("#detalhe tbody tr td:nth-child(2)", (e) =>
        e.map((x) => (x as HTMLElement).innerText),
      );
      expect(detalhe.every((n) => /\(.+\)/.test(n))).toBe(true);
    });

    it("5 min que viraram transferência: por funcionário e no total", async () => {
      expect(await lerTotais("conv")).toEqual({ lg: 8, transferidas: 4, avaliadas: 8 });
      const linhas = await pagina.$$eval("#longas tbody tr", (trs) =>
        trs.map((tr) => [...tr.children].map((c) => (c as HTMLElement).innerText)),
      );
      const maria = linhas.find((l) => l[0] === "Maria (5500000111)");
      expect(maria?.slice(1)).toEqual(["5", "2", "40%", "3", "60%"]); // 5 ligações; 2 transferidas; 3 não
      const outro = linhas.find((l) => l[0]?.startsWith("5500000101"));
      expect(outro?.slice(1)).toEqual(["3", "2", "66,7%", "1", "33,3%"]);
      expect(await pagina.locator("#longas tfoot").innerText()).toContain("50%");
    });

    it("antes e depois do meio-dia no horário de Brasília (11h59 BRT é manhã, 12h00 BRT é tarde)", async () => {
      expect(await lerTotais("manha")).toEqual({ lg: 4, tr: 3, cb: 1, lgTr: 3, lgAv: 4 });
      expect(await lerTotais("tarde")).toEqual({ lg: 4, tr: 2, cb: 1, lgTr: 1, lgAv: 4 });
      const t = await pagina.locator("#comparacao").innerText();
      expect(t).toContain("75% (3 de 4)"); // manhã
      expect(t).toContain("25% (1 de 4)"); // tarde
      expect(t).toContain("−50 p.p.");
      // por funcionário (Maria): manhã 3 de 5 min, tarde 2
      const maria = await pagina.$$eval("#meio tbody tr", (trs) =>
        trs
          .map((tr) => [...tr.children].map((c) => (c as HTMLElement).innerText))
          .find((l) => l[0] === "Maria (5500000111)"),
      );
      expect(maria?.slice(1)).toEqual(["3", "2", "66,7%", "2", "1", "0%"]);
      // gráfico por hora: 9h..16h, linha pontilhada no 12h
      const horas = await pagina.$$eval("#horas .h", (e) =>
        e.map((x) => (x as HTMLElement).innerText),
      );
      expect(horas[0]).toBe("09h");
      expect(horas).toContain("12h");
      expect(await pagina.locator("#horas .h.meio").innerText()).toBe("12h");
    });

    it("o limite do meio-dia usa Brasília: 12h00 em Brasília conta como tarde mesmo com o PC em outro fuso", async () => {
      const pg = await host.contexto.newPage();
      const arquivo = join(mkdtempSync(join(tmpdir(), "mc2-")), "r.html");
      writeFileSync(
        arquivo,
        paginaHtml({
          geradoEm: new Date(),
          ligacoes: [
            lig(11, MEU, "atendida", 1),
            { ...lig(12, MEU, "atendida", 1), quando: brt(12, 0) },
          ],
          longas: [],
          inicial: { periodo: "tudo" },
        }),
        "utf8",
      );
      await pg.goto(`file://${arquivo}`);
      const r = await pg.evaluate(
        () =>
          (window as unknown as { __relatorio: { manha: { tr: number }; tarde: { tr: number } } })
            .__relatorio,
      );
      expect([r.manha.tr, r.tarde.tr]).toEqual([1, 1]);
      await pg.close();
    });
  },
);
