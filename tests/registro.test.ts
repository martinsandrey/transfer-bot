import { mkdtempSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { validarConfig } from "../src/config/config.js";
import { TaskQueue } from "../src/fila/task-queue.js";
import { criarConstrutor } from "../src/mensagem/construtor.js";
import { EnviadorFalso } from "../src/mensagem/enviadores.js";
import type { EventoTracker } from "../src/monitor/call-tracker.js";
import { criarNotificadorFalso } from "../src/notificador/notificador.js";
import { NOME_ARQUIVO, RegistroEmArquivo } from "../src/registro/registro-arquivo.js";
import type { CustomerLookup } from "../src/dominio/tipos.js";

const REG = { nome: "Fulano Ficticio", cpf: "000", location: "L", age: "1", phone: "011900000001" };
const busca: CustomerLookup = {
  find: async () => ({ tipo: "ok", registro: REG, multiplos: false }),
};
const T = (chave: string): Extract<EventoTracker, { tipo: "transferencia" }> => ({
  tipo: "transferencia",
  ocorrencia: "o",
  chave,
  vinculo: `v${chave}`,
  fase: "agent",
  callback: "100001",
  callee: "011900000001",
});
const L = (chave: string, vinculo: string): Extract<EventoTracker, { tipo: "ligacao_longa" }> => ({
  tipo: "ligacao_longa",
  ocorrencia: "o",
  chave,
  vinculo,
  callback: "100001",
  callee: "011900000001",
});

function fila(pasta: string, modo: "live" | "observacao", sender = new EnviadorFalso()) {
  const reg = new RegistroEmArquivo(pasta, undefined, () => new Date(2026, 9, 17, 1, 35, 11));
  return new TaskQueue(
    {
      lookup: busca,
      construtor: criarConstrutor(readFileSync("config/mensagem.txt", "utf8")),
      sender,
      senderLonga: new EnviadorFalso(),
      registrar: (r) => reg.registrar(r),
      log: { debug() {}, info() {}, warn() {}, error() {} },
      notificador: criarNotificadorFalso(),
    },
    {
      modo,
      maxTentativasConsulta: 1,
      maxTentativasEnvio: 1,
      backoffMs: 1,
      ttlTarefasMs: 1e6,
      pausaEntreTarefasMs: 0,
    },
  );
}
const ler = (pasta: string, tipo: "transferencia" | "longa"): string =>
  existsSync(join(pasta, NOME_ARQUIVO[tipo]))
    ? readFileSync(join(pasta, NOME_ARQUIVO[tipo]), "utf8")
    : "";

describe("registro das mensagens em .txt", () => {
  it("grava cada mensagem enviada no arquivo certo, acrescentando ao fim, em UTF-8", async () => {
    const pasta = join(mkdtempSync(join(tmpdir(), "tb-reg-")), "registros");
    const f = fila(pasta, "live");
    f.enqueue(T("a"));
    f.enqueue(L("b", "vb"));
    f.enqueue(T("c"));
    await f.drenar();
    const t = ler(pasta, "transferencia");
    const l = ler(pasta, "longa");
    expect(t.match(/=====/g)).toHaveLength(4); // 2 blocos × 2 marcas
    expect(t).toContain("===== 2026-10-17 01:35:11 | ENVIADA | Funcionário: 100001 =====");
    expect(t).toContain("NAME: Fulano Ficticio");
    expect(l.match(/=====/g)).toHaveLength(2);
    expect(t).not.toContain("5 min");
  });

  it("modo observação também registra, marcando que NÃO foi enviada", async () => {
    const pasta = mkdtempSync(join(tmpdir(), "tb-reg-"));
    const f = fila(pasta, "observacao");
    f.enqueue(T("a"));
    await f.drenar();
    expect(ler(pasta, "transferencia")).toContain("OBSERVAÇÃO (não enviada)");
  });

  it("falha de envio não registra; mensagem reaproveitada é registrada e marcada", async () => {
    const pasta = mkdtempSync(join(tmpdir(), "tb-reg-"));
    const ruim = new EnviadorFalso([{ tipo: "falhou", motivo: "x", reenviavel: false }]);
    const f = fila(pasta, "live", ruim);
    f.enqueue(T("a"));
    await f.drenar();
    expect(ler(pasta, "transferencia")).toBe("");

    const pasta2 = mkdtempSync(join(tmpdir(), "tb-reg-"));
    const g = fila(pasta2, "live");
    g.enqueue(L("l", "vv"));
    g.enqueue({ ...T("t"), vinculo: "vv" });
    await g.drenar();
    expect(ler(pasta2, "transferencia")).toContain("| mensagem do grupo de 5 min");
    expect(ler(pasta2, "longa")).not.toContain("| mensagem do grupo de 5 min");
  });

  it("texto em chinês é preservado e uma falha ao gravar não derruba nada", () => {
    const pasta = mkdtempSync(join(tmpdir(), "tb-reg-"));
    new RegistroEmArquivo(pasta).registrar({
      tipo: "longa",
      estado: "enviada",
      texto: "启航 Line 1 一线送单",
    });
    expect(ler(pasta, "longa")).toContain("启航 Line 1 一线送单");

    const arquivoNoLugarDaPasta = join(mkdtempSync(join(tmpdir(), "tb-reg-")), "x");
    writeFileSync(arquivoNoLugarDaPasta, "");
    let avisos = 0;
    const ruim = new RegistroEmArquivo(join(arquivoNoLugarDaPasta, "sub"), () => void avisos++);
    ruim.registrar({ tipo: "longa", estado: "enviada", texto: "a" });
    ruim.registrar({ tipo: "longa", estado: "enviada", texto: "b" });
    expect(avisos).toBe(1);
  });

  it("config: ligado por padrão na pasta 'registros'; REGISTRAR_MENSAGENS=false desliga", () => {
    const c = validarConfig({ SITE_URL: "http://x.invalid/" });
    expect(c.pastaRegistros?.endsWith("registros")).toBe(true);
    expect(
      validarConfig({ SITE_URL: "http://x.invalid/", REGISTRAR_MENSAGENS: "false" }).pastaRegistros,
    ).toBeUndefined();
  });
});
