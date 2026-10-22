import { randomBytes } from "node:crypto";
import { carimbo } from "./callbacks-manuais.js";

/**
 * Transferências adicionadas à mão no relatório (pedido do usuário, 2026-10-22): `registros/transferencias-manuais.txt`, só
 * ACRESCENTANDO, um bloco por transferência no mesmo formato das mensagens (nome, CPF, telefone e "Line 1 number"; Location, Age e
 * Occupation ficam vazios). Contém dados de cliente, como os outros registros: a pasta é ignorada pelo git e nada disto vai para o
 * log. Vale só para o relatório: nada é enviado ao Telegram.
 */
export const ARQUIVO_TRANSFERENCIAS_MANUAIS = "transferencias-manuais.txt";

export interface TransferenciaManual {
  nome: string;
  cpf: string;
  telefone: string;
  /** "Line 1 number": o número do funcionário (Callback Number da linha 1). */
  linha1: string;
  /** `AAAA-MM-DDTHH:MM` no fuso do programa; ausente = agora. */
  quando?: string;
}

const SEM_CONTROLE = /[\u0000-\u001f\u007f]/; // eslint-disable-line no-control-regex
const digitos = (t: string): string => t.replace(/\D/g, "");

/** Confere o que foi digitado; devolve os dados limpos ou a mensagem de erro (em português) para mostrar na tela. */
export function validarTransferenciaManual(
  entrada: unknown,
): { ok: true; dados: TransferenciaManual } | { ok: false; erro: string } {
  const e = (entrada ?? {}) as Record<string, unknown>;
  const texto = (campo: string): string => (typeof e[campo] === "string" ? e[campo].trim() : "");
  const nomeBruto = texto("nome");
  const nome = nomeBruto.replace(/ +/g, " ");
  if (nome === "" || nome.length > 100 || SEM_CONTROLE.test(nomeBruto))
    return { ok: false, erro: "Informe o nome (até 100 letras, em uma linha só)." };
  const cpfTexto = texto("cpf");
  if (!/^[\d.\-\s]+$/.test(cpfTexto) || digitos(cpfTexto).length !== 11)
    return { ok: false, erro: "O CPF precisa ter 11 números." };
  const telTexto = texto("telefone");
  const tel = digitos(telTexto);
  if (!/^[\d+()\-\s]+$/.test(telTexto) || tel.length < 8 || tel.length > 15)
    return { ok: false, erro: "O telefone precisa ter de 8 a 15 números." };
  const linhaTexto = texto("linha1");
  const linha1 = digitos(linhaTexto);
  if (!/^[\d\s]+$/.test(linhaTexto) || linha1.length < 4 || linha1.length > 15)
    return { ok: false, erro: "A Line 1 number precisa ter de 4 a 15 números." };
  const quando = texto("quando");
  if (quando !== "") {
    const m = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d)$/.exec(quando);
    const d =
      m && new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
    if (!m || !d || d.getMonth() !== Number(m[2]) - 1 || d.getHours() !== Number(m[4]))
      return { ok: false, erro: "Data e hora inválidas." };
  }
  return {
    ok: true,
    dados: {
      nome,
      cpf: cpfTexto.replace(/\s+/g, ""),
      telefone: tel,
      linha1,
      ...(quando ? { quando } : {}),
    },
  };
}

/** Bloco a acrescentar ao arquivo. O código `manual-…` identifica a ligação (dá para marcá-la como callback depois). */
export function blocoDeTransferenciaManual(
  d: TransferenciaManual,
  agora: Date = new Date(),
  codigo: string = randomBytes(4).toString("hex"),
): string {
  const quando = d.quando ? new Date(`${d.quando}:00`) : agora; // sem fuso na string = horário local do programa
  const cab = `===== ${carimbo(quando)} | SEM MENSAGEM (adicionada à mão) | Tipo: transferencia | Funcionário: ${d.linha1} | Cliente: ${d.telefone} | Ligação: manual-${codigo} =====`;
  return `${cab}\nNAME: ${d.nome}\nCPF : ${d.cpf}\nLocation: \nAge: \nOccupation: \nPh: ${d.telefone}\nLine 1 number: ${d.linha1}\n\n`;
}
