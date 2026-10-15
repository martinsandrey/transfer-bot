import { describe, expect, it } from "vitest";
import { NOME_PROGRAMA } from "../src/versao.js";

describe("esqueleto", () => {
  it("expõe o nome do programa", () => {
    expect(NOME_PROGRAMA).toBe("Transfer Bot");
  });
});
