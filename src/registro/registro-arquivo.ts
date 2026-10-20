import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

export type TipoRegistro = "transferencia" | "longa" | "callback";

export interface RegistroDeMensagem {
  tipo: TipoRegistro;
  /** `enviada` (modo envio real) ou `observada` (modo observação: só prévia, nada foi enviado). */
  estado: "enviada" | "observada";
  texto: string;
  /** Texto reaproveitado da mensagem do grupo de 5 min (transferência). */
  reaproveitada?: boolean;
  /** Callback Number do Stage 1 (funcionário que transferiu): vai no cabeçalho do bloco, para o relatório (`relatorio.bat`). */
  funcionario?: string;
  /** Telefone do cliente (Callee Number) e código da ligação (ver `idDaLigacao`). */
  cliente?: string;
  ligacao?: string;
  /** CALLBACK: motivo (ex.: "ninguém atendeu" ou "ligação de 12 s"). */
  detalhe?: string;
}

export const NOME_ARQUIVO: Record<TipoRegistro, string> = {
  transferencia: "transferencias-concluidas.txt",
  longa: "ligacoes-5min.txt",
  callback: "transferencias-concluidas.txt", // o CALLBACK fica junto das transferências, marcado
};

/**
 * Eventos que NÃO geraram mensagem (funcionário fora do filtro do .env, ex.: equipe do paquistanês), só para o relatório poder
 * comparar equipes e calcular quantas ligações de 5 min viraram transferência. Uma linha-cabeçalho por evento, sem texto de cliente.
 */
export const ARQUIVO_SEM_MENSAGEM = "sem-mensagem.txt";

/** Durações das ligações transferidas e atendidas (uma linha por ligação), para a duração média do relatório. */
export const ARQUIVO_DURACOES = "duracoes.txt";

/**
 * Registro em arquivo de texto das mensagens (pedido do usuário em 2026-10-17): um .txt para transferências concluídas e outro
 * para ligações de 5 minutos, só ACRESCENTANDO ao fim (UTF-8). O texto contém dados de clientes: a pasta é ignorada pelo git
 * e NADA disso vai para o log. Uma falha ao gravar nunca impede o envio (só avisa uma vez).
 */
export class RegistroEmArquivo {
  private avisou = false;
  constructor(
    private readonly pasta: string,
    private readonly aoFalhar: (e: unknown) => void = () => undefined,
    private readonly agora: () => Date = () => new Date(),
  ) {}

  /**
   * Uma linha: quando terminou, código da ligação (o mesmo do cabeçalho das mensagens), a duração em segundos e, se legível,
   * quanto a ligação já durava quando foi transferida ("Até a transferência"; é esta que entra na duração média do relatório).
   */
  registrarDuracao(r: {
    ligacao: string;
    duracaoSeg: number;
    ateTransferenciaSeg?: number | null;
  }): void {
    try {
      mkdirSync(this.pasta, { recursive: true });
      appendFileSync(
        join(this.pasta, ARQUIVO_DURACOES),
        `${this.carimbo()} | Ligação: ${r.ligacao} | Duração: ${Math.max(0, Math.round(r.duracaoSeg))} s${r.ateTransferenciaSeg == null ? "" : ` | Até a transferência: ${Math.max(0, Math.round(r.ateTransferenciaSeg))} s`}\n`,
        { encoding: "utf8" },
      );
    } catch (e) {
      if (!this.avisou) {
        this.avisou = true;
        this.aoFalhar(e);
      }
    }
  }

  registrarSemMensagem(r: {
    tipo: TipoRegistro;
    funcionario: string;
    cliente: string;
    ligacao: string;
    detalhe?: string;
  }): void {
    try {
      mkdirSync(this.pasta, { recursive: true });
      const cab = `===== ${this.carimbo()} | SEM MENSAGEM (fora do filtro) | Tipo: ${r.tipo} | Funcionário: ${r.funcionario.replace(/\s+/g, "")} | Cliente: ${r.cliente.replace(/\s+/g, "")} | Ligação: ${r.ligacao}${r.detalhe ? ` | ${r.detalhe}` : ""} =====\n\n`;
      appendFileSync(join(this.pasta, ARQUIVO_SEM_MENSAGEM), cab, { encoding: "utf8" });
    } catch (e) {
      if (!this.avisou) {
        this.avisou = true;
        this.aoFalhar(e);
      }
    }
  }

  private carimbo(): string {
    const d = this.agora();
    const dois = (n: number): string => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${dois(d.getMonth() + 1)}-${dois(d.getDate())} ${dois(d.getHours())}:${dois(d.getMinutes())}:${dois(d.getSeconds())}`;
  }

  registrar(r: RegistroDeMensagem): void {
    try {
      mkdirSync(this.pasta, { recursive: true });
      const d = this.agora();
      const carimbo = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
      const rotulo = r.estado === "enviada" ? "ENVIADA" : "OBSERVAÇÃO (não enviada)";
      const nota =
        r.tipo === "callback"
          ? ` | CALLBACK (${r.detalhe ?? "ninguém atendeu"})`
          : r.reaproveitada
            ? " | mensagem do grupo de 5 min"
            : "";
      const func = r.funcionario ? ` | Funcionário: ${r.funcionario.replace(/\s+/g, "")}` : "";
      const cli = r.cliente ? ` | Cliente: ${r.cliente.replace(/\s+/g, "")}` : "";
      const lig = r.ligacao ? ` | Ligação: ${r.ligacao}` : "";
      const bloco = `===== ${carimbo} | ${rotulo}${nota}${func}${cli}${lig} =====\n${r.texto}\n\n`;
      appendFileSync(join(this.pasta, NOME_ARQUIVO[r.tipo]), bloco, { encoding: "utf8" });
    } catch (e) {
      if (!this.avisou) {
        this.avisou = true;
        this.aoFalhar(e);
      }
    }
  }
}
