import { describe, expect, it } from "vitest";
import { validarConfig } from "../src/config/config.js";
import { criarNotificador } from "../src/notificador/notificador.js";
import { criarToastWindows, scriptDoToast } from "../src/notificador/toast-windows.js";

/** spawn falso: guarda os comandos que seriam executados. */
function spawnFalso() {
  const chamadas: Array<{ cmd: string; args: string[] }> = [];
  const fn = ((cmd: string, args: string[]) => {
    chamadas.push({ cmd, args });
    return { on() {}, unref() {} };
  }) as never;
  return { chamadas, fn };
}
const decodificar = (args: string[]): string =>
  Buffer.from(args[args.indexOf("-EncodedCommand") + 1] as string, "base64").toString("utf16le");

describe("toast do Windows", () => {
  it("script: título e texto só entram em base64 (aspas, acentos e chinês não quebram nada)", () => {
    const s = scriptDoToast("Transfer Bot — ERRO", `Falhou 'agora' "assim" <b>& 启航 💥`);
    expect(s).not.toContain("启航");
    expect(s).not.toContain("<b>");
    expect(s).toContain("ToastNotificationManager");
    expect(s).toContain("ShowBalloonTip"); // reserva se o toast falhar
    const b64 = [...s.matchAll(/FromBase64String\('([A-Za-z0-9+/=]+)'\)/g)].map((m) =>
      Buffer.from(m[1] as string, "base64").toString("utf8"),
    );
    expect(b64).toEqual(["Transfer Bot — ERRO", `Falhou 'agora' "assim" <b>& 启航 💥`]);
  });

  it("só funciona no Windows; em outros sistemas não faz nada (e não dá erro)", () => {
    const { chamadas, fn } = spawnFalso();
    criarToastWindows({ plataforma: "linux", spawnFn: fn })("T", "texto");
    expect(chamadas).toHaveLength(0);
  });

  it("no Windows chama o PowerShell com o comando codificado", () => {
    const { chamadas, fn } = spawnFalso();
    criarToastWindows({ plataforma: "win32", spawnFn: fn })("Transfer Bot", "Envio falhou");
    expect(chamadas).toHaveLength(1);
    expect(chamadas[0]?.cmd).toBe("powershell.exe");
    expect(decodificar(chamadas[0]?.args as string[])).toContain("CreateToastNotifier");
  });

  it("telefones e CPF são mascarados antes de ir para a notificação", () => {
    const { chamadas, fn } = spawnFalso();
    criarToastWindows({ plataforma: "win32", spawnFn: fn })(
      "T",
      "Cliente 011900000001 cpf 123.456.789-09 falhou",
    );
    const script = decodificar(chamadas[0]?.args as string[]);
    const texto = Buffer.from(
      [...script.matchAll(/FromBase64String\('([^']+)'\)/g)][1]?.[1] as string,
      "base64",
    ).toString("utf8");
    expect(texto).not.toContain("011900000001");
    expect(texto).not.toContain("123.456.789-09");
  });

  it("a mesma mensagem não repete dentro da janela; depois da janela volta", () => {
    const { chamadas, fn } = spawnFalso();
    let t = 0;
    const toast = criarToastWindows({
      plataforma: "win32",
      spawnFn: fn,
      agora: () => t,
      janelaRepeticaoMs: 120_000,
    });
    toast("T", "mesma");
    toast("T", "mesma");
    t = 60_000;
    toast("T", "mesma");
    expect(chamadas).toHaveLength(1);
    t = 200_000;
    toast("T", "mesma");
    expect(chamadas).toHaveLength(2);
  });

  it("no máximo 4 por minuto; o excedente vira UM aviso 'mais N avisos'", () => {
    const { chamadas, fn } = spawnFalso();
    let t = 0;
    const agendados: Array<() => void> = [];
    const toast = criarToastWindows({
      plataforma: "win32",
      spawnFn: fn,
      agora: () => t,
      agendar: (f) => void agendados.push(f),
    });
    for (let i = 0; i < 10; i++) toast("T", `mensagem diferente ${i}`);
    expect(chamadas).toHaveLength(4);
    expect(agendados).toHaveLength(1); // um único resumo agendado
    t = 61_000;
    agendados[0]?.();
    expect(chamadas).toHaveLength(5);
    expect(decodificar(chamadas[4]?.args as string[])).toBeDefined();
    const resumo = Buffer.from(
      [
        ...decodificar(chamadas[4]?.args as string[]).matchAll(/FromBase64String\('([^']+)'\)/g),
      ][1]?.[1] as string,
      "base64",
    ).toString("utf8");
    expect(resumo).toContain("Mais 6 avisos");
  });

  it("falha ao iniciar o PowerShell nunca lança erro", () => {
    const toast = criarToastWindows({
      plataforma: "win32",
      spawnFn: (() => {
        throw new Error("sem powershell");
      }) as never,
    });
    expect(() => toast("T", "texto")).not.toThrow();
  });
});

describe("quais alertas viram notificação", () => {
  function montar(informativos = false, longas = false) {
    const toasts: Array<{ t: string; m: string }> = [];
    const n = criarNotificador({
      plataforma: "linux",
      escrever: () => undefined,
      toast: (t, m) => void toasts.push({ t, m }),
      toastInformativos: informativos,
      toastLigacoesLongas: longas,
    });
    return { n, toasts };
  }
  it("transferência e 5 min têm botões independentes", () => {
    const so5 = montar(false, true);
    so5.n.alerta("aviso", "transf", { windows: "informativo" });
    so5.n.alerta("aviso", "cinco", { windows: "informativo_5min" });
    expect(so5.toasts.map((x) => x.m)).toEqual(["cinco"]);
    const soT = montar(true, false);
    soT.n.alerta("aviso", "transf", { windows: "informativo" });
    soT.n.alerta("aviso", "cinco", { windows: "informativo_5min" });
    expect(soT.toasts.map((x) => x.m)).toEqual(["transf"]);
    const nenhum = montar();
    nenhum.n.alerta("aviso", "cinco", { windows: "informativo_5min" });
    expect(nenhum.toasts).toEqual([]);
    expect(
      validarConfig({ SITE_URL: "http://x.invalid/", NOTIFICAR_5MIN: "true" }).notificacoes.longas,
    ).toBe(true);
  });
  it("erro: sempre; aviso comum: não; aviso marcado: sim; info: não", () => {
    const { n, toasts } = montar();
    n.alerta("erro", "envio falhou");
    n.alerta("aviso", "algo menor");
    n.alerta("aviso", "login necessário", { windows: true });
    n.alerta("info", "só console");
    expect(toasts.map((x) => x.m)).toEqual(["envio falhou", "login necessário"]);
    expect(toasts[0]?.t).toContain("ERRO");
    expect(toasts[1]?.t).toContain("atenção");
  });
  it("informativos (transferência detectada etc.) só com a opção ligada", () => {
    const a = montar(false);
    a.n.alerta("aviso", "TRANSFERÊNCIA detectada", { windows: "informativo" });
    expect(a.toasts).toHaveLength(0);
    const b = montar(true);
    b.n.alerta("aviso", "TRANSFERÊNCIA detectada", { windows: "informativo" });
    expect(b.toasts).toHaveLength(1);
  });
  it("windows:false silencia até um erro; e uma notificação que falha não atrapalha o alerta", () => {
    const { n, toasts } = montar();
    n.alerta("erro", "barulho demais", { windows: false });
    expect(toasts).toHaveLength(0);
    const ruim = criarNotificador({
      plataforma: "linux",
      escrever: () => undefined,
      toast: () => {
        throw new Error("x");
      },
    });
    expect(() => ruim.alerta("erro", "ok")).not.toThrow();
  });
  it("config: ligado por padrão; informativas desligadas por padrão", () => {
    const c = validarConfig({ SITE_URL: "http://x.invalid/" });
    expect(c.notificacoes).toEqual({
      windows: true,
      informativas: false,
      longas: false,
      numerosCompletos: true,
    });
    expect(
      validarConfig({
        SITE_URL: "http://x.invalid/",
        NOTIFICAR_WINDOWS: "false",
        NOTIFICAR_TRANSFERENCIAS: "true",
      }).notificacoes,
    ).toEqual({ windows: false, informativas: true, longas: false, numerosCompletos: true });
  });
});

describe("integração: problemas reais chegam como notificação", () => {
  it("envio que falha, cliente não encontrado, mensagem velha e sessão expirada → notificações; transferência normal → nenhuma", async () => {
    const { readFileSync } = await import("node:fs");
    const { TaskQueue } = await import("../src/fila/task-queue.js");
    const { criarConstrutor } = await import("../src/mensagem/construtor.js");
    const { EnviadorFalso } = await import("../src/mensagem/enviadores.js");
    const toasts: string[] = [];
    const n = criarNotificador({
      plataforma: "linux",
      escrever: () => undefined,
      toast: (_t, m) => void toasts.push(m),
    });
    const ev = (c: string) => ({
      tipo: "transferencia" as const,
      ocorrencia: "o",
      chave: c,
      vinculo: c,
      callback: "100001",
      callee: "011900000001",
      fase: "agent" as const,
    });
    const montarFila = (
      find: () => Promise<
        never | { tipo: "ok"; registro: never; multiplos: false } | { tipo: "nenhum" }
      >,
      sender = new EnviadorFalso(),
    ) =>
      new TaskQueue(
        {
          lookup: { find } as never,
          construtor: criarConstrutor(readFileSync("config/mensagem.txt", "utf8")),
          sender,
          log: { debug() {}, info() {}, warn() {}, error() {} },
          notificador: n,
        },
        {
          modo: "live",
          maxTentativasConsulta: 1,
          maxTentativasEnvio: 1,
          backoffMs: 1,
          ttlTarefasMs: 1e6,
          pausaEntreTarefasMs: 0,
        },
      );
    const ok = async () => ({
      tipo: "ok" as const,
      registro: { nome: "N", cpf: "C", location: "L", age: "1", phone: "x" } as never,
      multiplos: false as const,
    });

    // 1) transferência normal: sem notificação
    const a = montarFila(ok);
    a.enqueue(ev("a"));
    await a.drenar();
    expect(toasts).toEqual([]);

    // 2) envio falhou
    const b = montarFila(
      ok,
      new EnviadorFalso([{ tipo: "falhou", motivo: "destino_ambiguo_x", reenviavel: false }]),
    );
    b.enqueue(ev("b"));
    await b.drenar();
    expect(toasts.at(-1)).toMatch(/o envio falhou/);

    // 3) cliente não encontrado
    const c = montarFila(async () => ({ tipo: "nenhum" }));
    c.enqueue(ev("c"));
    await c.drenar();
    expect(toasts.at(-1)).toMatch(/nenhum cliente encontrado/);

    // 4) consulta travando: falha da tarefa
    const d = montarFila(async () => {
      throw new Error("página travou");
    });
    d.enqueue(ev("d"));
    await d.drenar();
    expect(toasts.at(-1)).toMatch(/não foi possível consultar o cliente/);
    expect(toasts.length).toBe(3);
  });
});

describe("números completos na notificação", () => {
  const texto = "cliente 5511987654321 funcionario 5511900000111 CPF 123.456.789-09";
  function mostrado(mascararTelefones?: boolean): string {
    const { chamadas, fn } = spawnFalso();
    criarToastWindows({
      plataforma: "win32",
      spawnFn: fn,
      ...(mascararTelefones === undefined ? {} : { mascararTelefones }),
    })("T", texto);
    const script = decodificar(chamadas[0]?.args as string[]);
    return Buffer.from(
      [...script.matchAll(/FromBase64String\('([^']+)'\)/g)][1]?.[1] as string,
      "base64",
    ).toString("utf8");
  }
  it("padrão do toast mascara; com mascararTelefones:false mostra os números (CPF continua mascarado)", () => {
    expect(mostrado()).not.toContain("5511987654321");
    const aberto = mostrado(false);
    expect(aberto).toContain("5511987654321");
    expect(aberto).toContain("5511900000111");
    expect(aberto).not.toContain("123.456.789-09");
  });
  it("config: padrão true; pode desligar", () => {
    expect(validarConfig({ SITE_URL: "http://x.invalid/" }).notificacoes.numerosCompletos).toBe(
      true,
    );
    expect(
      validarConfig({ SITE_URL: "http://x.invalid/", NOTIFICAR_NUMEROS_COMPLETOS: "false" })
        .notificacoes.numerosCompletos,
    ).toBe(false);
  });
});
