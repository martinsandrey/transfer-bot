import { describe, expect, it } from "vitest";
import { deveBloquear } from "../src/consulta/bloqueio.js";

describe("bloqueio de requisições de escrita no cadastro", () => {
  it("bloqueia update/delete e qualquer escrita no módulo de clientes", () => {
    expect(deveBloquear({ metodo: "POST", caminho: "/modules/cc_cds/update.php" })).toBe(true);
    expect(deveBloquear({ metodo: "GET", caminho: "/modules/cc_cds/update.php" })).toBe(true);
    expect(deveBloquear({ metodo: "POST", caminho: "/modules/cc_cds/delete.php" })).toBe(true);
    expect(deveBloquear({ metodo: "post", caminho: "/modules/cc_cds/" })).toBe(true);
    expect(deveBloquear({ metodo: "PUT", caminho: "/modules/cc_cds/edit.php" })).toBe(true);
    expect(deveBloquear({ metodo: "GET", caminho: "/modules/cc_cds/add.php" })).toBe(true);
  });
  it("deixa passar leituras: pesquisa, tela de edição, menu e a tabela de chamadas", () => {
    expect(deveBloquear({ metodo: "GET", caminho: "/modules/cc_cds/" })).toBe(false);
    expect(deveBloquear({ metodo: "GET", caminho: "/modules/cc_cds/edit.php" })).toBe(false);
    expect(deveBloquear({ metodo: "GET", caminho: "/modules/menu.php" })).toBe(false);
    expect(deveBloquear({ metodo: "GET", caminho: "/modules/cc_monitor/get_curcall_in.php" })).toBe(
      false,
    );
    expect(deveBloquear({ metodo: "OPTIONS", caminho: "/modules/cc_cds/" })).toBe(false);
  });
});
