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
