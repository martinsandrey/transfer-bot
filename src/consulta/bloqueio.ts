/**
 * Proteção contra alteração de cadastro (regra inviolável: o bot só LÊ).
 * Evidência do recon (2026-10-16): a Customer Data List tem formulário de exclusão (`/modules/cc_cds/delete.php`, com checkboxes,
 * "Delete Confirm" e "Delete This Account Customer Data") e o formulário de edição envia para `/modules/cc_cds/update.php` (POST).
 * Esta função decide se uma requisição do navegador deve ser ABORTADA (será ligada ao `context.route` da página de consulta).
 */

export interface RequisicaoParaBloqueio {
  metodo: string;
  /** Só o caminho (sem domínio e sem query), ex.: "/modules/cc_cds/update.php". */
  caminho: string;
}

const LEITURA = new Set(["GET", "HEAD", "OPTIONS"]);
/** Endereços que alteram cadastro: bloqueados qualquer que seja o método. */
const ENDERECOS_DE_ESCRITA = /\/(update|delete|insert|add|save|remove|import|upload)[^/]*\.php$/i;

export function deveBloquear(r: RequisicaoParaBloqueio): boolean {
  const caminho = r.caminho.toLowerCase();
  if (ENDERECOS_DE_ESCRITA.test(caminho)) return true;
  // Qualquer escrita (POST/PUT/PATCH/DELETE) dentro do módulo de clientes.
  return caminho.startsWith("/modules/cc_cds/") && !LEITURA.has(r.metodo.toUpperCase());
}
