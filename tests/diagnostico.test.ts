import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  deslocamentoMin,
  executarDiagnostico,
  formatar,
  resumirLog,
  variaveisFaltando,
  verificarNode,
  verificarRelogio,
  type DepsDiagnostico,
} from "../src/diagnostico/verificacoes.js";

const T = Date.UTC(2026, 9, 19, 15, 0, 0); // 12:00 em Brasília

function ambiente(textoEnv: string | null, extra: Partial<DepsDiagnostico> = {}) {
  const dir = mkdtempSync(join(tmpdir(), "tb-diag-"));
  const dados = join(dir, "dados");
  if (textoEnv !== null) writeFileSync(join(dir, ".env"), textoEnv);
  writeFileSync(
    join(dir, ".env.example"),
    "SITE_URL=\nSEND_MODE=observacao\n# COMENTADA=1\nNOVA_VAR=10\n",
  );
  const chamadas: string[] = [];
  const deps: DepsDiagnostico = {
    caminhoEnv: join(dir, ".env"),
    caminhoExemplo: join(dir, ".env.example"),
    env: {
      PASTA_DADOS: dados,
      PASTA_REGISTROS: join(dir, "registros"),
      ARQUIVO_MENSAGEM: "config/mensagem.txt",
    },
    versaoNode: "24.1.0",
    plataforma: "win32",
    agora: () => T,
    fusoLocal: "America/Sao_Paulo",
    processoVivo: () => false,
    abrirSite: () => (chamadas.push("site"), Promise.resolve(200)),
    testarTelegram: (cfg) => (
      chamadas.push("telegram"),
      Promise.resolve([{ destino: cfg.telegram.destino, erro: null }])
    ),
    notificacoesDoSistemaLigadas: () => Promise.resolve(true),
    ...extra,
  };
  return { dir, dados, deps, chamadas };
}

const situacaoDe = (rs: { item: string; situacao: string }[], item: string) =>
  rs.find((r) => r.item === item)?.situacao;

describe("diagnóstico", () => {
  it("Node: aceita a versão mínima ou maior e recusa a antiga", () => {
    expect(verificarNode("22.13.0").situacao).toBe("ok");
    expect(verificarNode("24.0.0").situacao).toBe("ok");
    expect(verificarNode("22.12.9").situacao).toBe("erro");
    expect(verificarNode("20.18.0").detalhe).toContain("nodejs.org");
  });

  it("variáveis do .env.example que faltam no .env (comentadas não contam)", () => {
    expect(variaveisFaltando("SITE_URL=x\n", "SITE_URL=\n# B=1\nC=2\nD=\n")).toEqual(["C", "D"]);
    expect(variaveisFaltando("\uFEFFA=1\nB=2", "A=\nB=")).toEqual([]);
  });

  it("relógio: Brasília = ok; outro fuso = aviso com a diferença e a hora de Brasília", () => {
    expect(deslocamentoMin("America/Sao_Paulo", T)).toBe(-180);
    expect(deslocamentoMin("Europe/Lisbon", T)).toBe(60); // horário de verão em outubro
    expect(verificarRelogio("America/Sao_Paulo", T)).toMatchObject({ situacao: "ok" });
    const r = verificarRelogio("Europe/Lisbon", T);
    expect(r.situacao).toBe("aviso");
    expect(r.detalhe).toContain("+4 h");
    expect(r.detalhe).toContain("12:00:00");
    expect(verificarRelogio("America/Manaus", T).detalhe).toContain("−1 h");
  });

  it("sem .env: só os itens básicos e um erro explicando o configurar.bat", async () => {
    const { deps, chamadas } = ambiente(null);
    const rs = await executarDiagnostico(deps);
    expect(rs.map((r) => r.item)).toEqual(["Node.js", "Relógio", "Arquivo .env"]);
    expect(rs[2]?.detalhe).toContain("configurar.bat");
    expect(chamadas).toEqual([]);
  });

  it(".env inválido: lista os problemas em português e não testa navegador nem Telegram", async () => {
    const { deps, chamadas } = ambiente("SITE_URL=nao-e-url\nSEND_MODE=talvez\n");
    const rs = await executarDiagnostico(deps);
    const cfg = rs.find((r) => r.item === "Configuração (.env)");
    expect(cfg?.situacao).toBe("erro");
    expect(cfg?.detalhe).toContain("SITE_URL");
    expect(cfg?.detalhe).toContain("SEND_MODE");
    expect(chamadas).toEqual([]);
    expect(formatar(rs)).toMatch(/Resultado: \d problema/);
  });

  it("tudo certo (observação, sem Telegram configurado): testa o site e pula o Telegram", async () => {
    const { deps, chamadas } = ambiente(
      "SITE_URL=https://exemplo.invalid/\nSEND_MODE=observacao\nNOVA_VAR=1\n",
    );
    const rs = await executarDiagnostico(deps);
    expect(rs.filter((r) => r.situacao === "erro")).toEqual([]);
    expect(situacaoDe(rs, "Navegador e site")).toBe("ok");
    expect(situacaoDe(rs, "Telegram")).toBe("pulado");
    expect(situacaoDe(rs, "Variáveis novas")).toBe("ok");
    expect(situacaoDe(rs, "Pasta de dados")).toBe("ok");
    expect(chamadas).toEqual(["site"]);
    expect(formatar(rs)).toContain("Resultado: tudo certo.");
  });

  it("aponta as variáveis novas que faltam no .env", async () => {
    const { deps } = ambiente("SITE_URL=https://exemplo.invalid/\n");
    const rs = await executarDiagnostico(deps);
    const v = rs.find((r) => r.item === "Variáveis novas");
    expect(v?.situacao).toBe("aviso");
    expect(v?.detalhe).toContain("SEND_MODE");
    expect(v?.detalhe).toContain("NOVA_VAR");
    expect(v?.detalhe).not.toContain("COMENTADA");
  });

  it("Telegram: mostra o motivo por destino; o bot aberto faz pular o teste (não disputa a sessão)", async () => {
    const env =
      "SITE_URL=https://exemplo.invalid/\nTELEGRAM_API_ID=123\nTELEGRAM_API_HASH=abc\nTELEGRAM_DESTINO=Grupo A\nTELEGRAM_DESTINO_5MIN=Grupo B\n";
    const ruim = ambiente(env, {
      testarTelegram: () =>
        Promise.resolve([
          { destino: "Grupo A", erro: null },
          { destino: "Grupo B", erro: "não achei uma conversa com esse nome" },
        ]),
    });
    const rs = await executarDiagnostico(ruim.deps);
    const tg = rs.find((r) => r.item === "Telegram");
    expect(tg?.situacao).toBe("erro");
    expect(tg?.detalhe).toContain('"Grupo B": não achei');
    expect(tg?.detalhe).not.toContain("Grupo A");

    const aberto = ambiente(env, { processoVivo: () => true });
    mkdirSync(aberto.dados, { recursive: true });
    writeFileSync(join(aberto.dados, "bot.lock"), "4242");
    const rs2 = await executarDiagnostico(aberto.deps);
    expect(rs2.find((r) => r.item === "Bot aberto agora")?.detalhe).toContain("4242");
    expect(situacaoDe(rs2, "Telegram")).toBe("pulado");
    expect(aberto.chamadas).toEqual(["site"]);
  });

  it("navegador ausente e site fora do ar viram explicações diferentes", async () => {
    const semEdge = ambiente("SITE_URL=https://exemplo.invalid/\n", {
      abrirSite: () =>
        Promise.reject(new Error('Chromium distribution "msedge" is not found at ...')),
    });
    const r1 = (await executarDiagnostico(semEdge.deps)).find((r) => r.item === "Navegador e site");
    expect(r1?.situacao).toBe("erro");
    expect(r1?.detalhe).toContain("Edge não foi encontrado");

    const foraDoAr = ambiente("SITE_URL=https://exemplo.invalid/\n", {
      abrirSite: () =>
        Promise.reject(new Error("net::ERR_NAME_NOT_RESOLVED at https://exemplo.invalid/\nlog")),
    });
    const r2 = (await executarDiagnostico(foraDoAr.deps)).find(
      (r) => r.item === "Navegador e site",
    );
    expect(r2?.detalhe).toContain("ERR_NAME_NOT_RESOLVED");
    expect(r2?.detalhe).toContain("VPN");
    expect(r2?.detalhe).not.toContain("\nlog");
  });

  it("notificações desligadas no Windows = aviso; fora do Windows = pulado", async () => {
    const off = ambiente("SITE_URL=https://exemplo.invalid/\n", {
      notificacoesDoSistemaLigadas: () => Promise.resolve(false),
    });
    expect(situacaoDe(await executarDiagnostico(off.deps), "Notificações do Windows")).toBe(
      "aviso",
    );
    const linux = ambiente("SITE_URL=https://exemplo.invalid/\n", { plataforma: "linux" });
    expect(situacaoDe(await executarDiagnostico(linux.deps), "Notificações do Windows")).toBe(
      "pulado",
    );
  });

  it("modelo de mensagem inválido aparece como erro", async () => {
    const { dir, deps } = ambiente("SITE_URL=https://exemplo.invalid/\n");
    writeFileSync(join(dir, "modelo.txt"), "Olá {{nome}}");
    deps.env["ARQUIVO_MENSAGEM"] = join(dir, "modelo.txt");
    const m = (await executarDiagnostico(deps)).find((r) => r.item === "Modelo da mensagem");
    expect(m?.situacao).toBe("erro");
    expect(m?.detalhe).toContain("{{cpf}}");
  });

  it("log: conta aberturas do programa e resume avisos/erros pelo código do evento", () => {
    const pasta = mkdtempSync(join(tmpdir(), "tb-diag-log-"));
    writeFileSync(
      join(pasta, "transfer-bot-2026-10-18.log"),
      JSON.stringify({ level: 50, evento: "x" }) + "\n",
    );
    const linhas = [
      ...Array.from({ length: 5 }, () => ({ level: 30, evento: "programa_iniciado" })),
      { level: 40, evento: "menu_nao_abriu" },
      { level: 40, evento: "menu_nao_abriu" },
      { level: 50, evento: "envio_falhou" },
      { level: 30, evento: "transferencia" },
    ];
    writeFileSync(
      join(pasta, "transfer-bot-2026-10-19.log"),
      linhas.map((l) => JSON.stringify(l)).join("\n") + "\nlixo\n",
    );
    const r = resumirLog(pasta);
    expect(r.situacao).toBe("aviso");
    expect(r.detalhe).toContain("transfer-bot-2026-10-19.log");
    expect(r.detalhe).toContain("programa aberto 5×");
    expect(r.detalhe).toContain("2 aviso(s), 1 erro(s): menu não abriu ×2, envio falhou ×1");
    expect(r.detalhe).toContain("reinícios");
    expect(resumirLog(join(pasta, "nao-existe")).situacao).toBe("pulado");
  });
});
