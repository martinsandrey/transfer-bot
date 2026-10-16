import { describe, expect, it } from "vitest";
import { ErroDeConfiguracao, validarConfig } from "../src/config/config.js";
import { criarLogger, sanearCampos } from "../src/log/logger.js";
import {
  GerenciadorLogin,
  type AdaptadorLogin,
  type EstadoSessao,
} from "../src/login/login-manager.js";
import { criarNotificador, criarNotificadorFalso } from "../src/notificador/notificador.js";
import { Anonimizador, formaDoValor, politicaDaColuna } from "../src/recon/anonimizador.js";
import { varrerTexto } from "../src/recon/escritor.js";
import { formaJson, padraoCaminho } from "../src/recon/forma-json.js";
import { mascararTelefone, mascararTexto, somenteDigitos } from "../src/util/mascara.js";

describe("máscara", () => {
  it("mascara telefone mantendo 4 dígitos", () => {
    expect(mascararTelefone("+55 (11) 90000-1234")).toBe("***1234");
    expect(mascararTelefone("12")).toBe("***");
    expect(somenteDigitos("(11) 9-0000")).toBe("1190000");
  });
  it("mascara CPF, e-mail e telefones em texto livre", () => {
    const t = mascararTexto("cpf 123.456.789-09 tel +55 11 90000-1234 mail a.b@x.com ok 12345");
    expect(t).toContain("***CPF***");
    expect(t).toContain("***1234");
    expect(t).toContain("***EMAIL***");
    expect(t).toContain("ok 12345");
    expect(t).not.toContain("123.456");
  });
});

describe("configuração", () => {
  const base = { SITE_URL: "https://exemplo.invalid/" };
  it("aplica padrões seguros", () => {
    const c = validarConfig({ ...base, LOCALAPPDATA: "C:\\Users\\x\\AppData\\Local" });
    expect(c.modo).toBe("observacao");
    expect(c.navegador).toBe("msedge");
    expect(c.site.loginAutomatico).toBe(false);
    expect(c.monitor.intervaloMs).toBe(1000);
  });
  it("erros em português, agrupados", () => {
    try {
      validarConfig({ SITE_URL: "abc", SEND_MODE: "talvez", INTERVALO_LEITURA_MS: "10" });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ErroDeConfiguracao);
      const m = (e as Error).message;
      expect(m).toContain("SITE_URL");
      expect(m).toContain("SEND_MODE");
      expect(m).toContain("INTERVALO_LEITURA_MS");
    }
  });
  it("exige credenciais para login automático e nunca ecoa a senha", () => {
    expect(() => validarConfig({ ...base, LOGIN_AUTOMATICO: "true" })).toThrow(/SITE_USUARIO/);
    try {
      validarConfig({ ...base, SITE_SENHA: "segredo-xyz", SEND_MODE: "x" });
    } catch (e) {
      expect((e as Error).message).not.toContain("segredo-xyz");
    }
  });
  it("expande %VAR% na pasta de dados", () => {
    const c = validarConfig({ ...base, PASTA_DADOS: "%BASE%/TB", BASE: "/tmp/b" });
    expect(c.pastas.dados.replace(/\\/g, "/")).toContain("/tmp/b/TB");
  });
});

describe("logger", () => {
  it("descarta campos fora da lista e mascara valores", () => {
    const r = sanearCampos({
      evento: "x",
      callbackMascarado: "tel 11900001234",
      nome: "Fulano",
      cpf: "123",
    });
    expect(r.descartados).toBe(2);
    expect(r.campos).toEqual({ evento: "x", callbackMascarado: "tel ***1234" });
  });
  it("não grava PII no arquivo nem no console", () => {
    const linhas: string[] = [];
    const arquivo: string[] = [];
    const log = criarLogger({
      pastaLogs: "",
      nivel: "debug",
      console: (l) => linhas.push(l),
      destino: { write: (s: string) => void arquivo.push(s) },
    });
    log.info("ligou para 11900001234 cpf 123.456.789-09", { evento: "t", nome: "Maria" });
    const tudo = linhas.join("\n") + arquivo.join("\n");
    expect(tudo).not.toContain("11900001234");
    expect(tudo).not.toContain("123.456.789-09");
    expect(tudo).not.toContain("Maria");
    expect(tudo).toContain("***1234");
  });
});

describe("logger: nível", () => {
  it("o console não mostra mensagens abaixo do nível configurado", () => {
    const linhas: string[] = [];
    const log = criarLogger({
      pastaLogs: "",
      nivel: "info",
      console: (l) => linhas.push(l),
      destino: { write: () => undefined },
    });
    log.debug("detalhe interno");
    log.info("importante");
    expect(linhas).toHaveLength(1);
    expect(linhas[0]).toContain("importante");
  });
});

describe("notificador", () => {
  it("usa PowerShell no Windows e BEL nos demais", () => {
    const chamadas: string[] = [];
    const saida: string[] = [];
    const filho = { on: () => filho, unref: () => undefined };
    const win = criarNotificador({
      plataforma: "win32",
      escrever: (t) => saida.push(t),
      spawnFn: ((cmd: string) => {
        chamadas.push(cmd);
        return filho;
      }) as never,
    });
    win.alerta("aviso", "teste");
    win.alerta("info", "silencioso");
    expect(chamadas).toEqual(["powershell.exe"]);
    const linux = criarNotificador({ plataforma: "linux", escrever: (t) => saida.push(t) });
    linux.alerta("erro", "x");
    expect(saida.join("")).toContain("\x07");
  });
  it("falso guarda alertas", () => {
    const n = criarNotificadorFalso();
    n.alerta("erro", "a");
    expect(n.alertas).toEqual([{ nivel: "erro", mensagem: "a" }]);
  });
});

describe("login", () => {
  function montar(sequencia: EstadoSessao[], opc: { auto: boolean; erroAoPreencher?: boolean }) {
    let i = 0;
    let t = 0;
    const envios: number[] = [];
    const adaptador: AdaptadorLogin = {
      detectar: async () => sequencia[Math.min(i++, sequencia.length - 1)] ?? "desconhecido",
      preencherEEnviar: async () => {
        envios.push(t);
        if (opc.erroAoPreencher) throw new Error("falha");
      },
    };
    const notif = criarNotificadorFalso();
    const log = { debug() {}, info() {}, warn() {}, error() {} };
    const g = new GerenciadorLogin(
      adaptador,
      {
        loginAutomatico: opc.auto,
        usuario: opc.auto ? "u" : undefined,
        senha: opc.auto ? "s" : undefined,
        esperaAposEnvioMs: 3000,
        intervaloVerificacaoMs: 1000,
        intervaloAvisoMs: 5000,
        agora: () => t,
        dormir: async (ms) => void (t += ms),
      },
      log,
      notif,
    );
    return { g, envios, notif };
  }
  it("já logado: não faz nada", async () => {
    const { g, envios } = montar(["logado"], { auto: true });
    expect(await g.garantirLogin(new AbortController().signal)).toBe("ja_logado");
    expect(envios).toHaveLength(0);
  });
  it("automático: uma única tentativa", async () => {
    const { g, envios } = montar(["nao_logado", "nao_logado", "logado"], { auto: true });
    expect(await g.garantirLogin(new AbortController().signal)).toBe("logado_automatico");
    expect(envios).toHaveLength(1);
  });
  it("automático que falha cai para o manual, sem segundo envio, com avisos sonoros", async () => {
    const seq: EstadoSessao[] = [
      "nao_logado",
      ...Array<EstadoSessao>(20).fill("nao_logado"),
      "logado",
    ];
    const { g, envios, notif } = montar(seq, { auto: true });
    expect(await g.garantirLogin(new AbortController().signal)).toBe("logado_manual");
    expect(envios).toHaveLength(1);
    expect(notif.alertas.length).toBeGreaterThanOrEqual(1);
  });
  it("erro ao preencher cai para o manual", async () => {
    const { g, envios } = montar(["nao_logado", "nao_logado", "logado"], {
      auto: true,
      erroAoPreencher: true,
    });
    expect(await g.garantirLogin(new AbortController().signal)).toBe("logado_manual");
    expect(envios).toHaveLength(1);
  });
  it("sem automático: nunca envia formulário", async () => {
    const { g, envios } = montar(["nao_logado", "nao_logado", "logado"], { auto: false });
    expect(await g.garantirLogin(new AbortController().signal)).toBe("logado_manual");
    expect(envios).toHaveLength(0);
  });
  it("espera manual pode ser cancelada", async () => {
    const { g } = montar(["nao_logado"], { auto: false });
    const c = new AbortController();
    const p = g.garantirLogin(c.signal);
    c.abort();
    await expect(p).rejects.toThrow(/cancelada/);
  });
});

describe("anonimizador", () => {
  it("marcadores estáveis; política por cabeçalho", () => {
    const a = new Anonimizador(["joao.silva"]);
    expect(politicaDaColuna(" Callback  Number ")).toBe("funcionario");
    const m1 = a.celula("funcionario", 0, "5511900000001");
    expect(a.celula("funcionario", 0, "5511900000001")).toBe(m1);
    expect(a.celula("funcionario", 0, "5511900000002")).not.toBe(m1);
    expect(m1).toBe("FUNC_01");
    expect(a.celula("status", 2, "Stage 1 Agent")).toBe("Stage 1 Agent");
    expect(a.celula("generica", 5, "Fulano de Tal")).toBe("COL5_01");
    expect(a.limparTexto("Olá joao.silva")).toBe("Olá <USUARIO>");
    expect(formaDoValor("Ab 12-34")).toBe("Aa 99-99");
    expect(a.estatisticas().formatos["Callback Number"]).toEqual(["9999999999999"]);
  });
  it("atributos com números longos viram marcador", () => {
    const a = new Anonimizador();
    expect(a.limparAtributo("data-id", "cliente-123456")).toBe("cliente-<ATTR_data-id_01>");
    expect(a.limparAtributo("class", "tabela larga")).toBe("tabela larga");
  });
});

describe("forma do JSON e caminhos", () => {
  it("mantém chaves e tipos, nunca valores", () => {
    const f = JSON.stringify(
      formaJson({ linhas: [{ numero: "5511900000001", n: 3, ok: true }], 12345678: 1 }),
    );
    expect(f).not.toContain("5511900000001");
    expect(f).toContain("numero");
    expect(f).toContain("<CHAVE_NUMERICA>");
  });
  it("padroniza identificadores no caminho", () => {
    expect(padraoCaminho("/api/cliente/123456/editar")).toBe("/api/cliente/:num/editar");
    expect(padraoCaminho("/api/chamadas")).toBe("/api/chamadas");
  });
});

describe("varredura da saída", () => {
  it("acusa PII e ignora formas feitas de noves", () => {
    expect(varrerTexto("a.json", '"forma": "+99 (99) 99999-9999"', [])).toHaveLength(0);
    expect(varrerTexto("a.json", '"x": "11 90000-1234"', [])).toHaveLength(1);
    expect(varrerTexto("a.json", '"x": "joao.silva"', ["joao.silva"])).toHaveLength(1);
  });
});

describe("config do Telegram", () => {
  it("live exige api_id e api_hash; padrão de destino é 'me'", async () => {
    const { validarConfig } = await import("../src/config/config.js");
    const base = { SITE_URL: "http://x.invalid/" };
    expect(validarConfig(base).telegram.destino).toBe("me");
    expect(() => validarConfig({ ...base, SEND_MODE: "live" })).toThrow(/TELEGRAM_API_ID/);
    expect(
      validarConfig({
        ...base,
        SEND_MODE: "live",
        TELEGRAM_API_ID: "123",
        TELEGRAM_API_HASH: "abc",
      }).telegram.apiId,
    ).toBe(123);
    expect(() => validarConfig({ ...base, TELEGRAM_API_ID: "abc" })).toThrow(/TELEGRAM_API_ID/);
  });
});
