import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BuscaSemCadastro } from "../src/consulta/sem-cadastro.js";
import { TaskQueue } from "../src/fila/task-queue.js";
import { LeitorTabelaHtml } from "../src/leitura/leitor-tabela.js";
import { criarConstrutor } from "../src/mensagem/construtor.js";
import { EnviadorFalso } from "../src/mensagem/enviadores.js";
import { CallTracker } from "../src/monitor/call-tracker.js";
import { Monitor } from "../src/monitor/monitor.js";
import type { HospedeNavegador } from "../src/navegador/navegador.js";
import { criarNotificadorFalso } from "../src/notificador/notificador.js";
import { CHROMIUM_DE_TESTE, navegadorDeTeste } from "./helpers/navegador-teste.js";
import { iniciarSiteSimulado, type SiteSimulado } from "./helpers/site-simulado.js";

function filaDoModoReal(previas: string[]) {
  const notif = criarNotificadorFalso();
  const log = { debug() {}, info() {}, warn() {}, error() {} };
  const sender = new EnviadorFalso();
  const fila = new TaskQueue(
    {
      lookup: new BuscaSemCadastro(),
      construtor: criarConstrutor(readFileSync("config/mensagem.txt", "utf8")),
      sender,
      log,
      notificador: notif,
    },
    {
      modo: "observacao",
      maxTentativasConsulta: 1,
      maxTentativasEnvio: 1,
      backoffMs: 1,
      ttlTarefasMs: 1e6,
      previa: (t) => previas.push(t),
    },
  );
  return { fila, notif, log, sender };
}

describe("modo real provisório: mensagem preparada e exibida, sem cadastro e sem envio", () => {
  it("BuscaSemCadastro + fila em observação: só Ph e Line 1 number preenchidos; nada é enviado", async () => {
    const previas: string[] = [];
    const { fila, sender } = filaDoModoReal(previas);
    fila.enqueue({
      tipo: "transferencia",
      ocorrencia: "o1",
      chave: "k",
      vinculo: "v-k",
      callback: "908112",
      callee: "011941445986",
    });
    await fila.drenar();
    expect(fila.todas[0]?.estado).toBe("observada");
    expect(sender.enviados).toHaveLength(0);
    expect(previas[0]).toBe(
      [
        "NAME: ",
        "CPF : ",
        "Location: ",
        "Age: ",
        "Occupation: ",
        "Ph: 011941445986",
        "Line 1 number: 908112",
        "NOTE:",
      ].join("\n"),
    );
  });
});

describe.skipIf(!CHROMIUM_DE_TESTE)(
  "ponta a ponta na estrutura confirmada pelo recon (site simulado)",
  () => {
    let site: SiteSimulado;
    let nav: HospedeNavegador;
    beforeAll(async () => {
      site = await iniciarSiteSimulado(300);
      nav = await navegadorDeTeste();
    }, 60000);
    afterAll(async () => {
      await nav?.encerrar();
      await site?.fechar();
    });

    it("lê a tabela, detecta Stage 1 Agent → Stage 3 Agent e prepara a mensagem", async () => {
      await nav.abrirUrl(`${site.url}/layout-evidencia`);
      await nav.paginaPrincipal().waitForSelector("#corpo tr");
      const previas: string[] = [];
      const { fila, notif, log } = filaDoModoReal(previas);
      const tracker = new CallTracker({
        leiturasConfirmacao: 2,
        ausenciaMaxLeituras: 3,
        ttlOcorrenciasMs: 1e6,
      });
      const monitor = new Monitor(
        {
          reader: new LeitorTabelaHtml(nav.paginaPrincipal()),
          tracker,
          fila,
          log,
          notificador: notif,
        },
        { intervaloMs: 100, invalidasParaAlertar: 50, falhasParaAlertar: 50, limpezaMs: 1e9 },
      );
      const fim = Date.now() + 6000;
      while (Date.now() < fim && previas.length === 0) {
        await monitor.passo();
        await new Promise((r) => setTimeout(r, 100));
      }
      await fila.drenar();
      expect(previas.length).toBeGreaterThanOrEqual(1);
      expect(previas[0]).toContain("Line 1 number: 900001"); // Callback Number do Stage 1 (o antigo)
      expect(previas[0]).not.toContain("900301"); // o Callback Number novo, do Stage 3, não entra no texto
      expect(previas[0]).toContain("Ph: 021900000101");
      expect(previas[0]).toContain("NAME: \n");
      expect(notif.alertas.some((a) => /TRANSFERÊNCIA detectada/.test(a.mensagem))).toBe(true);
    }, 30000);
  },
);
