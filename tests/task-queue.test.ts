import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { CustomerLookup, ResultadoBusca } from "../src/dominio/tipos.js";
import { TaskQueue, type EstadoTarefa, type OpcoesFila } from "../src/fila/task-queue.js";
import { criarConstrutor } from "../src/mensagem/construtor.js";
import { EnviadorFalso } from "../src/mensagem/enviadores.js";
import { criarNotificadorFalso } from "../src/notificador/notificador.js";
import type { EventoTracker } from "../src/monitor/call-tracker.js";

const REG = { nome: "Fulano", cpf: "1", location: "L", age: "3", phone: "5521900000101" };
type Transf = Extract<EventoTracker, { tipo: "transferencia" }>;
const ev = (chave = "k1", cb = "5511900000001", callee = "5521900000101"): Transf => ({
  tipo: "transferencia",
  ocorrencia: "o1",
  chave,
  callback: cb,
  callee,
});

class BuscaFalsa implements CustomerLookup {
  chamadas: string[] = [];
  constructor(private readonly respostas: Array<ResultadoBusca | Error>) {}
  async find(callee: string): Promise<ResultadoBusca> {
    this.chamadas.push(callee);
    const r = this.respostas.shift() ?? { tipo: "ok", registro: REG, multiplos: false };
    if (r instanceof Error) throw r;
    return r;
  }
}

function montar(
  over: {
    busca?: BuscaFalsa;
    sender?: EnviadorFalso;
    modo?: OpcoesFila["modo"];
    op?: Partial<OpcoesFila>;
  } = {},
) {
  const busca = over.busca ?? new BuscaFalsa([]);
  const sender = over.sender ?? new EnviadorFalso();
  const notif = criarNotificadorFalso();
  const logs: string[] = [];
  const previas: string[] = [];
  let t = 0;
  const log = {
    debug() {},
    info: (_m: string, c?: object) => void logs.push(JSON.stringify(c ?? {})),
    warn() {},
    error() {},
  };
  const fila = new TaskQueue(
    {
      lookup: busca,
      construtor: criarConstrutor(readFileSync("config/mensagem.txt", "utf8")),
      sender,
      log,
      notificador: notif,
    },
    {
      modo: over.modo ?? "live",
      maxTentativasConsulta: 2,
      maxTentativasEnvio: 3,
      backoffMs: 10,
      ttlTarefasMs: 1000,
      agora: () => t,
      dormir: async (ms) => void (t += ms),
      previa: (x) => previas.push(x),
      ...over.op,
    },
  );
  return { fila, busca, sender, notif, logs, previas, avancar: (ms: number) => void (t += ms) };
}
const estados = (f: TaskQueue): EstadoTarefa[] => f.todas.map((x) => x.estado);

describe("TaskQueue", () => {
  it("caminho feliz (live): na_fila → pesquisando → pronta → enviando → enviada; apaga dados do cliente", async () => {
    const { fila, sender } = montar();
    const t = fila.enqueue(ev());
    expect(t?.estado).toBe("na_fila");
    await fila.drenar();
    expect(t?.historico.map((h) => h.estado)).toEqual([
      "detectada",
      "na_fila",
      "pesquisando",
      "pronta",
      "enviando",
      "enviada",
    ]);
    expect(sender.enviados).toHaveLength(1);
    expect(sender.enviados[0]?.texto).toContain("Line 1 number: 5511900000001");
    expect(t?.cadastro).toBeUndefined();
    expect(t?.mensagem).toBeUndefined();
  });

  it("modo observação: monta, mostra a prévia, NÃO envia", async () => {
    const { fila, sender, previas } = montar({ modo: "observacao" });
    const t = fila.enqueue(ev());
    await fila.drenar();
    expect(t?.estado).toBe("observada");
    expect(sender.enviados).toHaveLength(0);
    expect(previas[0]).toContain("NAME: Fulano");
  });

  it("deduplica por chave e permite chaves diferentes (duas transferências do mesmo funcionário)", async () => {
    const { fila, busca } = montar();
    expect(fila.enqueue(ev("k1"))).not.toBeNull();
    expect(fila.enqueue(ev("k1"))).toBeNull();
    expect(fila.enqueue(ev("k2"))).not.toBeNull();
    await fila.drenar();
    expect(busca.chamadas).toHaveLength(2);
  });

  it("processamento sequencial e trava contra drenagens concorrentes", async () => {
    let ativos = 0;
    let pico = 0;
    const busca: CustomerLookup = {
      find: async () => {
        ativos++;
        pico = Math.max(pico, ativos);
        await new Promise((r) => setTimeout(r, 5));
        ativos--;
        return { tipo: "ok", registro: REG, multiplos: false };
      },
    };
    const { fila } = montar({ busca: busca as BuscaFalsa });
    fila.enqueue(ev("a"));
    fila.enqueue(ev("b"));
    fila.enqueue(ev("c"));
    await Promise.all([fila.drenar(), fila.drenar(), fila.drenar()]);
    expect(pico).toBe(1);
    expect(estados(fila)).toEqual(["enviada", "enviada", "enviada"]);
  });

  it("fica 'ocupada' só durante a tarefa e faz uma pausa entre tarefas para o monitor voltar a ler", async () => {
    const eventos: string[] = [];
    const ref: { fila?: TaskQueue } = {};
    const busca: CustomerLookup = {
      find: async () => {
        eventos.push(`consulta(ocupada=${ref.fila?.ocupada})`);
        return { tipo: "ok", registro: REG, multiplos: false };
      },
    };
    const m = montar({
      busca: busca as BuscaFalsa,
      op: {
        pausaEntreTarefasMs: 5000,
        dormir: async (ms) => void eventos.push(`pausa(${ms},ocupada=${ref.fila?.ocupada})`),
      },
    });
    ref.fila = m.fila;
    const fila = m.fila;
    fila.enqueue(ev("a"));
    fila.enqueue(ev("b"));
    await fila.drenar();
    expect(eventos).toEqual([
      "consulta(ocupada=true)",
      "pausa(5000,ocupada=false)",
      "consulta(ocupada=true)",
    ]);
    expect(fila.ocupada).toBe(false);
  });

  it("0 resultados: ignorada, nada enviado, alerta de erro", async () => {
    const { fila, sender, notif } = montar({ busca: new BuscaFalsa([{ tipo: "nenhum" }]) });
    const t = fila.enqueue(ev());
    await fila.drenar();
    expect(t?.estado).toBe("ignorada");
    expect(sender.enviados).toHaveLength(0);
    expect(notif.alertas.some((a) => a.nivel === "erro")).toBe(true);
  });

  it("telefone divergente: ignorada, nada enviado, alerta", async () => {
    const { fila, sender, notif } = montar({
      busca: new BuscaFalsa([{ tipo: "telefone_divergente" }]),
    });
    fila.enqueue(ev());
    await fila.drenar();
    expect(estados(fila)).toEqual(["ignorada"]);
    expect(sender.enviados).toHaveLength(0);
    expect(notif.alertas[0]?.mensagem).toMatch(/cliente errado/);
  });

  it("vários resultados: alerta sonoro e segue com o primeiro", async () => {
    const { fila, notif } = montar({
      busca: new BuscaFalsa([{ tipo: "ok", registro: REG, multiplos: true }]),
    });
    fila.enqueue(ev());
    await fila.drenar();
    expect(estados(fila)).toEqual(["enviada"]);
    expect(notif.alertas.some((a) => a.nivel === "aviso" && /mais de um/.test(a.mensagem))).toBe(
      true,
    );
  });

  it("consulta com falha: retry limitado com backoff, depois falhou", async () => {
    const { fila, busca, notif } = montar({
      busca: new BuscaFalsa([new Error("x"), new Error("y")]),
    });
    fila.enqueue(ev());
    await fila.drenar();
    expect(busca.chamadas).toHaveLength(2);
    expect(estados(fila)).toEqual(["falhou"]);
    expect(notif.alertas.at(-1)?.nivel).toBe("erro");
  });

  it("consulta que se recupera no retry segue normalmente", async () => {
    const { fila } = montar({ busca: new BuscaFalsa([new Error("x")]) });
    fila.enqueue(ev());
    await fila.drenar();
    expect(estados(fila)).toEqual(["enviada"]);
  });

  it("envio que falha de forma reenviável é repetido (limitado); depois falhou", async () => {
    const falha = { tipo: "falhou", motivo: "rede", reenviavel: true } as const;
    const { fila, sender } = montar({ sender: new EnviadorFalso([falha, falha, falha]) });
    fila.enqueue(ev());
    await fila.drenar();
    expect(sender.enviados).toHaveLength(3);
    expect(estados(fila)).toEqual(["falhou"]);
  });

  it("envio incerto NUNCA é reenviado sozinho: fica incerta e alerta", async () => {
    const { fila, sender, notif } = montar({
      sender: new EnviadorFalso([{ tipo: "incerta", motivo: "timeout" }]),
    });
    fila.enqueue(ev());
    await fila.drenar();
    expect(estados(fila)).toEqual(["incerta"]);
    expect(sender.enviados).toHaveLength(1);
    expect(notif.alertas.at(-1)?.mensagem).toMatch(/INCERTO/);
  });

  it("exceção no envio conta como incerta (não sabemos se saiu)", async () => {
    const { fila, sender } = montar({ sender: new EnviadorFalso([new Error("conexão caiu")]) });
    fila.enqueue(ev());
    await fila.drenar();
    expect(estados(fila)).toEqual(["incerta"]);
    expect(sender.enviados).toHaveLength(1);
  });

  it("incerta + verificação: entregue → enviada; não encontrada → falhou (sem reenvio); indeterminado → incerta", async () => {
    for (const [v, esperado] of [
      ["entregue", "enviada"],
      ["nao_encontrada", "falhou"],
      ["indeterminado", "incerta"],
    ] as const) {
      const { fila, sender } = montar({
        sender: new EnviadorFalso([{ tipo: "incerta", motivo: "t" }], v),
      });
      fila.enqueue(ev());
      await fila.drenar();
      expect(estados(fila)).toEqual([esperado]);
      expect(sender.enviados).toHaveLength(1);
    }
  });

  it("decisão manual sobre tarefa incerta", async () => {
    const mk = async () => {
      const m = montar({ sender: new EnviadorFalso([{ tipo: "incerta", motivo: "t" }]) });
      const t = m.fila.enqueue(ev());
      await m.fila.drenar();
      return { ...m, id: t?.id ?? "" };
    };
    let m = await mk();
    await m.fila.decidirIncerta(m.id, "dar_como_enviada");
    expect(m.fila.get(m.id)?.estado).toBe("enviada");
    m = await mk();
    await m.fila.decidirIncerta(m.id, "descartar");
    expect(m.fila.get(m.id)?.estado).toBe("falhou");
    m = await mk();
    await m.fila.decidirIncerta(m.id, "reenviar");
    expect(m.fila.get(m.id)?.estado).toBe("enviada");
    expect(m.sender.enviados).toHaveLength(2);
    await expect(m.fila.decidirIncerta(m.id, "descartar")).rejects.toThrow();
  });

  it("logs de estado não contêm telefones nem dados do cliente", async () => {
    const { fila, logs } = montar();
    fila.enqueue(ev());
    await fila.drenar();
    const tudo = logs.join("\n");
    expect(tudo).not.toContain("5511900000001");
    expect(tudo).not.toContain("Fulano");
  });

  it("limpeza remove terminais antigos, mas mantém incertas", async () => {
    const m = montar({ sender: new EnviadorFalso([{ tipo: "incerta", motivo: "t" }]) });
    m.fila.enqueue(ev("a"));
    m.fila.enqueue(ev("b"));
    await m.fila.drenar(); // a: incerta, b: enviada
    m.avancar(5000);
    expect(m.fila.limpar()).toBe(1);
    expect(estados(m.fila)).toEqual(["incerta"]);
  });
});
