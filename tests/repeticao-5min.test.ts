import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { validarConfig } from "../src/config/config.js";
import type { CustomerLookup } from "../src/dominio/tipos.js";
import { TaskQueue } from "../src/fila/task-queue.js";
import { criarConstrutor } from "../src/mensagem/construtor.js";
import { EnviadorFalso } from "../src/mensagem/enviadores.js";
import type { EventoTracker } from "../src/monitor/call-tracker.js";
import { criarNotificadorFalso } from "../src/notificador/notificador.js";
import { longasRecentes } from "../src/registro/recentes.js";
import { RegistroEmArquivo } from "../src/registro/registro-arquivo.js";

const REG = { nome: "Fulano Ficticio", cpf: "000", location: "L", age: "1", phone: "011900000001" };
const busca: CustomerLookup = {
  find: async () => ({ tipo: "ok", registro: REG, multiplos: false }),
};
type L = Extract<EventoTracker, { tipo: "ligacao_longa" }>;
const longa = (
  chave: string,
  vinculo: string,
  callee = "5511900000001",
  callback = "908108",
): L => ({
  tipo: "ligacao_longa",
  ocorrencia: "o",
  chave,
  vinculo,
  callback,
  callee,
});

function criar(
  opcoes: {
    repeticaoMin?: number;
    recentes?: Array<{ cliente: string; em: number }>;
    agora?: () => number;
    sender?: EnviadorFalso;
  } = {},
) {
  const enviados = opcoes.sender ?? new EnviadorFalso();
  const logs: string[] = [];
  const fila = new TaskQueue(
    {
      lookup: busca,
      construtor: criarConstrutor(readFileSync("config/mensagem.txt", "utf8")),
      sender: new EnviadorFalso(),
      senderLonga: enviados,
      log: {
        debug() {},
        info: (_m: string, c?: Record<string, unknown>) => void logs.push(String(c?.["evento"])),
        warn() {},
        error() {},
      },
      notificador: criarNotificadorFalso(),
    },
    {
      modo: "live",
      maxTentativasConsulta: 1,
      maxTentativasEnvio: 1,
      backoffMs: 1,
      ttlTarefasMs: 1e6,
      pausaEntreTarefasMs: 0,
      repeticaoLongaMs: (opcoes.repeticaoMin ?? 30) * 60_000,
      ...(opcoes.recentes ? { longasRecentes: opcoes.recentes } : {}),
      ...(opcoes.agora ? { agora: opcoes.agora } : {}),
    },
  );
  return { fila, enviados, logs };
}
const quantos = (e: EnviadorFalso): number => e.enviados.length;

describe("mensagem de 5 min não se repete para o mesmo cliente", () => {
  it("a mesma ligação aparecendo como ocorrência nova (outro Start Time/vínculo) gera UMA mensagem", async () => {
    const { fila, enviados, logs } = criar();
    expect(fila.enqueue(longa("a", "v1"))).not.toBeNull();
    expect(fila.enqueue(longa("b", "v2"))).toBeNull(); // mesmo cliente, outro discriminador
    expect(fila.enqueue(longa("c", "v3", "+55 (11) 90000-0001"))).toBeNull(); // formato diferente do mesmo número
    await fila.drenar();
    expect(quantos(enviados)).toBe(1);
    expect(logs.filter((x) => x === "longa_repetida")).toHaveLength(2);
  });
  it("outro funcionário com o mesmo cliente dentro da janela também não repete; cliente diferente passa", async () => {
    const { fila, enviados } = criar();
    fila.enqueue(longa("a", "v1"));
    expect(fila.enqueue(longa("b", "v2", "5511900000001", "908114"))).toBeNull();
    expect(fila.enqueue(longa("c", "v3", "5511900000002"))).not.toBeNull();
    await fila.drenar();
    expect(quantos(enviados)).toBe(2);
  });
  it("depois da janela o mesmo cliente pode receber de novo; com janela 0 a regra fica desligada", async () => {
    let agora = 1_000_000;
    const { fila } = criar({ agora: () => agora });
    expect(fila.enqueue(longa("a", "v1"))).not.toBeNull();
    agora += 29 * 60_000;
    expect(fila.enqueue(longa("b", "v2"))).toBeNull();
    agora += 2 * 60_000; // 31 min depois da primeira
    expect(fila.enqueue(longa("c", "v3"))).not.toBeNull();
    const zero = criar({ repeticaoMin: 0 });
    expect(zero.fila.enqueue(longa("a", "v1"))).not.toBeNull();
    expect(zero.fila.enqueue(longa("b", "v2"))).not.toBeNull();
  });
  it("se a primeira não foi enviada (falhou), uma nova detecção pode tentar de novo", async () => {
    const semCadastro: CustomerLookup = { find: async () => ({ tipo: "nenhum" }) };
    const { fila } = criar();
    (fila as unknown as { deps: { lookup: CustomerLookup } }).deps.lookup = semCadastro;
    fila.enqueue(longa("a", "v1"));
    await fila.drenar(); // cliente não encontrado → nada enviado
    expect(fila.enqueue(longa("b", "v2"))).not.toBeNull();
  });
  it("depois de REINICIAR o programa: lê o registro e não repete quem acabou de receber", async () => {
    const pasta = join(mkdtempSync(join(tmpdir(), "rep-")), "registros");
    const agora = new Date(2026, 9, 19, 13, 57, 0);
    const reg = new RegistroEmArquivo(pasta, undefined, () => new Date(agora.getTime() - 60_000));
    reg.registrar({
      tipo: "longa",
      estado: "enviada",
      texto: "NAME: X",
      funcionario: "908108",
      cliente: "017981163993",
      ligacao: "x",
    });
    // um bloco antigo (sem Cliente no cabeçalho) e um velho demais são ignorados
    const regVelho = new RegistroEmArquivo(
      pasta,
      undefined,
      () => new Date(agora.getTime() - 3 * 3600_000),
    );
    regVelho.registrar({
      tipo: "longa",
      estado: "enviada",
      texto: "NAME: Y",
      funcionario: "908111",
      cliente: "011900000009",
      ligacao: "y",
    });
    const recentes = longasRecentes(pasta, agora.getTime(), 30 * 60_000);
    expect(recentes.map((r) => r.cliente)).toEqual(["017981163993"]);
    const { fila, enviados } = criar({ recentes, agora: () => agora.getTime() });
    expect(fila.enqueue(longa("a", "v-novo", "017981163993"))).toBeNull(); // o mesmo cliente que já recebeu antes do reinício
    expect(fila.enqueue(longa("b", "v-y", "011900000009"))).not.toBeNull(); // o de 3 h atrás pode
    await fila.drenar();
    expect(quantos(enviados)).toBe(1);
  });
  it("transferências e CALLBACK não são afetados pela regra", async () => {
    const { fila } = criar();
    const t = (
      chave: string,
      vinculo: string,
    ): Extract<EventoTracker, { tipo: "transferencia" }> => ({
      tipo: "transferencia",
      ocorrencia: "o",
      chave,
      vinculo,
      callback: "908108",
      callee: "5511900000001",
      fase: "agent",
    });
    expect(fila.enqueue(t("t1", "v1"))).not.toBeNull();
    expect(fila.enqueue(t("t2", "v2"))).not.toBeNull();
  });
  it("registro ausente ou corrompido: lista vazia, sem erro", () => {
    const pasta = join(mkdtempSync(join(tmpdir(), "rep-")), "nada");
    expect(longasRecentes(pasta, Date.now(), 1e6)).toEqual([]);
    mkdirSync(pasta, { recursive: true });
    writeFileSync(join(pasta, "ligacoes-5min.txt"), "lixo\n\u0000\n===== quebrado");
    expect(longasRecentes(pasta, Date.now(), 1e6)).toEqual([]);
  });
  it("REPETICAO_5MIN_MIN: padrão 30, configurável, 0 desliga, inválido dá erro", () => {
    const b = { SITE_URL: "https://exemplo.invalid/" };
    expect(validarConfig(b).repeticao5minMin).toBe(30);
    expect(validarConfig({ ...b, REPETICAO_5MIN_MIN: "0" }).repeticao5minMin).toBe(0);
    expect(() => validarConfig({ ...b, REPETICAO_5MIN_MIN: "x" })).toThrow(/REPETICAO_5MIN_MIN/);
  });
});
