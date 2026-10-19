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
  vinculo: `v-${chave}`,
  fase: "agent",
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

  it("incerta + verificação: entregue → enviada (1 envio); não encontrada → REENVIA e chega (2 envios); indeterminado → incerta", async () => {
    for (const [v, esperado, envios] of [
      ["entregue", "enviada", 1],
      ["nao_encontrada", "enviada", 2],
      ["indeterminado", "incerta", 1],
    ] as const) {
      const { fila, sender } = montar({
        sender: new EnviadorFalso([{ tipo: "incerta", motivo: "t" }], v),
      });
      fila.enqueue(ev());
      await fila.drenar();
      expect(estados(fila)).toEqual([esperado]);
      expect(sender.enviados).toHaveLength(envios);
    }
  });

  it("incerta e não encontrada em TODAS as tentativas: reenvia até o limite e então falha com alerta (sem laço infinito)", async () => {
    const { fila, sender, notif } = montar({
      sender: new EnviadorFalso(
        [
          { tipo: "incerta", motivo: "t" },
          { tipo: "incerta", motivo: "t" },
          { tipo: "incerta", motivo: "t" },
        ],
        "nao_encontrada",
      ),
    });
    fila.enqueue(ev());
    await fila.drenar();
    expect(estados(fila)).toEqual(["falhou"]);
    expect(sender.enviados).toHaveLength(3); // maxTentativasEnvio = 3
    expect(notif.alertas.some((a) => /acabaram as tentativas/.test(a.mensagem))).toBe(true);
  });

  it("não deu para conferir de primeira (conexão caída) mas a 2ª conferência lê: resolve sozinha", async () => {
    const sender = new EnviadorFalso([{ tipo: "incerta", motivo: "t" }]);
    const leituras = ["indeterminado", "indeterminado", "entregue"] as const;
    let i = 0;
    sender.verify = async () => leituras[Math.min(i++, leituras.length - 1)] as "entregue";
    const { fila } = montar({ sender });
    fila.enqueue(ev());
    await fila.drenar();
    expect(estados(fila)).toEqual(["enviada"]);
    expect(sender.enviados).toHaveLength(1);
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

  it("fila: uma 2ª transferência que chega durante a 1ª espera e é enviada logo depois, na ordem", async () => {
    const ref: { fila?: TaskQueue } = {};
    let entrou = false;
    const busca: CustomerLookup = {
      find: async (callee) => {
        if (!entrou) {
          entrou = true; // enquanto a 1ª ainda está sendo consultada/escrita, chegam mais duas
          ref.fila?.enqueue(ev("k2", "5511900000002", "5521900000102"));
          ref.fila?.enqueue(ev("k3", "5511900000003", "5521900000103"));
          void ref.fila?.drenar(); // o monitor também chama drenar(): deve só somar à execução em curso
        }
        return { tipo: "ok", registro: { ...REG, phone: callee }, multiplos: false };
      },
    };
    const m = montar();
    const fila = new TaskQueue(
      {
        lookup: busca,
        construtor: criarConstrutor(readFileSync("config/mensagem.txt", "utf8")),
        sender: m.sender,
        log: { debug() {}, info() {}, warn() {}, error() {} },
        notificador: m.notif,
      },
      {
        modo: "live",
        maxTentativasConsulta: 1,
        maxTentativasEnvio: 1,
        backoffMs: 1,
        ttlTarefasMs: 1000,
        pausaEntreTarefasMs: 0,
      },
    );
    ref.fila = fila;
    fila.enqueue(ev("k1", "5511900000001", "5521900000101"));
    await fila.drenar();
    expect(estados(fila)).toEqual(["enviada", "enviada", "enviada"]);
    expect(m.sender.enviados.map((e) => /Line 1 number: (\d+)/.exec(e.texto)?.[1])).toEqual([
      "5511900000001",
      "5511900000002",
      "5511900000003",
    ]);
    expect(m.notif.alertas.filter((a) => /entrou na fila/.test(a.mensagem))).toHaveLength(2);
  });

  it("fila: tarefa que entra logo depois que o laço esvaziou ainda é processada", async () => {
    const m = montar({ op: { pausaEntreTarefasMs: 0 } });
    m.fila.enqueue(ev("k1"));
    const p = m.fila.drenar();
    // enfileira no instante em que a 1ª termina, antes de `drenando` ser limpo
    void p.then(() => undefined);
    await Promise.resolve();
    m.fila.enqueue(ev("k2", "5511900000002", "5521900000102"));
    void m.fila.drenar();
    await m.fila.drenar();
    await p;
    expect(estados(m.fila)).toEqual(["enviada", "enviada"]);
  });

  describe("reaproveita a mensagem do grupo de 5 min na transferência da mesma ligação", () => {
    type Longa = Extract<EventoTracker, { tipo: "ligacao_longa" }>;
    const longa = (vinc: string, cb = "5511900000001", callee = "5521900000101"): Longa => ({
      tipo: "ligacao_longa",
      ocorrencia: "o1",
      chave: `L-${vinc}`,
      vinculo: vinc,
      callback: cb,
      callee,
    });
    const transf = (vinc: string, chave = "T-" + vinc): Transf => ({ ...ev(chave), vinculo: vinc });
    function dois(
      over: Parameters<typeof montar>[0] = {},
      respostasLonga: ConstructorParameters<typeof EnviadorFalso>[0] = [],
    ) {
      const longaSender = new EnviadorFalso(respostasLonga);
      const m = montar({ op: { pausaEntreTarefasMs: 0 }, ...over });
      const fila = new TaskQueue(
        {
          lookup: m.busca,
          construtor: criarConstrutor(readFileSync("config/mensagem.txt", "utf8")),
          sender: m.sender,
          senderLonga: longaSender,
          log: { debug() {}, info() {}, warn() {}, error() {} },
          notificador: m.notif,
        },
        {
          modo: over.modo ?? "live",
          maxTentativasConsulta: 1,
          maxTentativasEnvio: 1,
          backoffMs: 1,
          ttlTarefasMs: 1e6,
          pausaEntreTarefasMs: 0,
          ...over.op,
          previa: (x, tipo) => m.previas.push(`${tipo}:${x}`),
        },
      );
      return { fila, m, longaSender };
    }

    it("5 min enviada → transferência reenvia o mesmo texto ao outro grupo, sem nova consulta", async () => {
      const { fila, m, longaSender } = dois();
      fila.enqueue(longa("V1"));
      fila.enqueue(transf("V1"));
      await fila.drenar();
      expect(estados(fila)).toEqual(["enviada", "enviada"]);
      expect(m.busca.chamadas).toHaveLength(1); // só a consulta da ligação longa
      expect(m.sender.enviados).toHaveLength(1);
      expect(longaSender.enviados).toHaveLength(1);
      expect(m.sender.enviados[0]?.texto).toBe(longaSender.enviados[0]?.texto);
      expect(fila.todas[1]?.reaproveitada).toBe(true);
    });

    it("a pessoa EDITOU a mensagem no grupo de 5 min: a transferência envia o texto editado", async () => {
      const { fila, m, longaSender } = dois();
      fila.enqueue(longa("VE"));
      const p1 = fila.drenar();
      await p1;
      longaSender.relido = "NAME: TEXTO EDITADO PELA PESSOA";
      fila.enqueue(transf("VE"));
      await fila.drenar();
      expect(m.sender.enviados[0]?.texto).toBe("NAME: TEXTO EDITADO PELA PESSOA");
      expect(m.busca.chamadas).toHaveLength(1);
    });

    it("mensagem apagada ou ilegível no grupo de 5 min: usa o texto original guardado e avisa", async () => {
      for (const relido of ["apagada", null] as const) {
        const { fila, m, longaSender } = dois();
        fila.enqueue(longa("VX"));
        await fila.drenar();
        longaSender.relido = relido;
        fila.enqueue(transf("VX"));
        await fila.drenar();
        expect(m.sender.enviados[0]?.texto).toBe(longaSender.enviados[0]?.texto);
        expect(m.notif.alertas.some((a) => /usei o texto original/.test(a.mensagem))).toBe(true);
      }
    });

    it("transferência antes dos 5 min (sem mensagem longa): cria a mensagem normalmente", async () => {
      const { fila, m } = dois();
      fila.enqueue(transf("V2"));
      await fila.drenar();
      expect(m.busca.chamadas).toHaveLength(1);
      expect(fila.todas[0]?.reaproveitada).toBeUndefined();
      expect(m.sender.enviados).toHaveLength(1);
    });

    it("mensagem longa que falhou: a transferência faz o fluxo normal (consulta e cria)", async () => {
      const { fila, m } = dois({}, [{ tipo: "falhou", motivo: "x", reenviavel: false }]);
      fila.enqueue(longa("V3"));
      fila.enqueue(transf("V3"));
      await fila.drenar();
      expect(estados(fila)).toEqual(["falhou", "enviada"]);
      expect(m.busca.chamadas).toHaveLength(2);
      expect(fila.todas[1]?.reaproveitada).toBeUndefined();
    });

    it("ligações diferentes não se misturam", async () => {
      const { fila, m } = dois();
      fila.enqueue(longa("VA"));
      fila.enqueue(transf("VB"));
      await fila.drenar();
      expect(m.busca.chamadas).toHaveLength(2);
    });

    it("memória vencida: não reaproveita", async () => {
      const { fila, m } = dois({ op: { memoriaMensagemLongaMs: -1 } });
      fila.enqueue(longa("V4"));
      fila.enqueue(transf("V4"));
      await fila.drenar();
      expect(m.busca.chamadas).toHaveLength(2);
    });

    it("modo observação: a prévia da transferência reaproveita o texto da prévia de 5 min", async () => {
      const { fila, m } = dois({ modo: "observacao" });
      fila.enqueue(longa("V5"));
      fila.enqueue(transf("V5"));
      await fila.drenar();
      expect(m.busca.chamadas).toHaveLength(1);
      const [a, b] = m.previas;
      expect(a?.startsWith("longa:")).toBe(true);
      expect(b?.startsWith("transferencia:")).toBe(true);
      expect(a?.slice(6)).toBe(b?.slice(14));
    });

    it("a mensagem guardada é usada uma única vez", async () => {
      const { fila, m } = dois();
      fila.enqueue(longa("V6"));
      fila.enqueue(transf("V6", "T6a"));
      fila.enqueue(transf("V6", "T6b"));
      await fila.drenar();
      expect(m.busca.chamadas).toHaveLength(2); // 1 da longa + 1 da segunda transferência (sem reaproveitar)
    });
  });

  describe("CALLBACK (ninguém atendeu o Stage 3)", () => {
    type Cb = Extract<EventoTracker, { tipo: "callback" }>;
    const cb = (vinc: string, chave = "C-" + vinc): Cb => ({
      tipo: "callback",
      motivo: "sem_atendimento",
      ocorrencia: "o1",
      chave,
      vinculo: vinc,
      callback: "5511900000001",
      callee: "5521900000101",
    });

    it("responde à mensagem de transferência já enviada, com o texto CALLBACK, sem consultar o cadastro", async () => {
      const m = montar({ op: { pausaEntreTarefasMs: 0 } });
      m.fila.enqueue({ ...ev("t1"), vinculo: "VC" });
      m.fila.enqueue(cb("VC"));
      await m.fila.drenar();
      expect(estados(m.fila)).toEqual(["enviada", "enviada"]);
      expect(m.busca.chamadas).toHaveLength(1);
      const [t, c] = m.sender.enviados;
      expect(c?.texto).toBe("CALLBACK");
      expect(c?.opcoes?.responderA).toBe("ok"); // a confirmação do envio da transferência
      expect(c?.opcoes?.reserva).toContain("Line 1 number: 5511900000001");
      expect(t?.opcoes).toBeUndefined();
    });

    it("se a mensagem de transferência NÃO foi enviada (falhou), o CALLBACK não é enviado", async () => {
      const sender = new EnviadorFalso([{ tipo: "falhou", motivo: "x", reenviavel: false }]);
      const m = montar({ sender, op: { pausaEntreTarefasMs: 0 } });
      m.fila.enqueue({ ...ev("t1"), vinculo: "VD" });
      m.fila.enqueue(cb("VD"));
      await m.fila.drenar();
      expect(estados(m.fila)).toEqual(["falhou", "ignorada"]);
      expect(sender.enviados).toHaveLength(1);
      expect(m.notif.alertas.some((a) => /CALLBACK não foi enviado/.test(a.mensagem))).toBe(true);
    });

    it("sem transferência anterior para essa ligação: não envia", async () => {
      const m = montar({ op: { pausaEntreTarefasMs: 0 } });
      m.fila.enqueue(cb("VZ"));
      await m.fila.drenar();
      expect(estados(m.fila)).toEqual(["ignorada"]);
      expect(m.sender.enviados).toHaveLength(0);
    });

    it("modo observação: mostra a prévia do CALLBACK", async () => {
      const m = montar({ modo: "observacao", op: { pausaEntreTarefasMs: 0 } });
      m.fila.enqueue({ ...ev("t1"), vinculo: "VO" });
      m.fila.enqueue(cb("VO"));
      await m.fila.drenar();
      expect(estados(m.fila)).toEqual(["observada", "observada"]);
      expect(m.previas).toHaveLength(2);
    });

    it("sem o ID da mensagem original (confirmada só pela verificação): manda o texto completo, sem resposta", async () => {
      const sender = new EnviadorFalso([{ tipo: "incerta", motivo: "timeout_no_envio" }]);
      sender.verificacao = "entregue";
      const m = montar({ sender, op: { pausaEntreTarefasMs: 0 } });
      m.fila.enqueue({ ...ev("t1"), vinculo: "VV" });
      m.fila.enqueue(cb("VV"));
      await m.fila.drenar();
      const c = sender.enviados[1];
      expect(c?.opcoes).toBeUndefined();
      expect(c?.texto).toContain("CALLBACK");
      expect(c?.texto).toContain("Line 1 number: 5511900000001");
    });
  });
});
