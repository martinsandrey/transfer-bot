/**
 * Gerador mínimo de planilha Excel (.xlsx) sem bibliotecas, usado pelo botão "Baixar planilha" da página do relatório.
 *
 * A função `montarXlsx` roda no NAVEGADOR: a página recebe o código dela por `montarXlsx.toString()` (ver pagina.ts). Por isso
 * ela é autocontida (não usa nada de fora do próprio corpo, nem imports) e só usa recursos que existem no Node e no navegador.
 * O arquivo gerado é um ZIP sem compressão com o mínimo do formato Office Open XML: textos inline, estilos fixos (abaixo),
 * larguras de coluna, linhas congeladas, autofiltro e células mescladas.
 */

/** Estilos disponíveis (índice em `cellXfs` do styles.xml gerado). */
export const ESTILO = {
  padrao: 0,
  titulo: 1,
  subtitulo: 2,
  cabecalho: 3,
  texto: 4,
  inteiro: 5,
  porcentagem: 6,
  duracao: 7,
  dataHora: 8,
  totalTexto: 9,
  totalInteiro: 10,
  totalPorcentagem: 11,
  totalDuracao: 12,
  atendida: 13,
  callback: 14,
  removido: 15,
  rotulo: 16,
  secao: 17,
} as const;

/** `v`: texto, número (porcentagem = fração; duração = fração do dia; data = número de série do Excel) ou vazio. */
export interface CelulaXlsx {
  v: string | number | null;
  e?: number;
}

export interface AbaXlsx {
  nome: string;
  /** Largura de cada coluna (em caracteres). */
  larguras: number[];
  linhas: (CelulaXlsx | null)[][];
  /** Quantas linhas do topo ficam congeladas ao rolar. */
  congelar?: number;
  /** Intervalo com autofiltro, ex.: "A3:H40". */
  filtro?: string;
  /** Intervalos mesclados, ex.: ["A1:F1"]. */
  mesclar?: string[];
  /** Página na horizontal ao imprimir. */
  paisagem?: boolean;
}

export function montarXlsx(abas: AbaXlsx[]): Uint8Array {
  const enc = new TextEncoder();
  const esc = (s: string): string =>
    s
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  const coluna = (i: number): string => {
    let s = "";
    for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26))
      s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
    return s;
  };
  const nomeDaAba = (nome: string, i: number, usados: Set<string>): string => {
    let n =
      nome
        .replace(/[[\]:*?/\\']/g, " ")
        .trim()
        .slice(0, 31) || `Aba ${i + 1}`;
    while (usados.has(n.toLowerCase())) n = `${n.slice(0, 28)} ${i + 1}`;
    usados.add(n.toLowerCase());
    return n;
  };
  const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
  const NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';
  const NSR = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

  const usados = new Set<string>();
  const nomes = abas.map((a, i) => nomeDaAba(a.nome, i, usados));

  const planilha = (a: AbaXlsx): string => {
    const partes: string[] = [XML, `<worksheet ${NS} ${NSR}>`];
    if (a.paisagem) partes.push('<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>');
    const n = a.congelar ?? 0;
    partes.push(
      n > 0
        ? `<sheetViews><sheetView workbookViewId="0"><pane ySplit="${n}" topLeftCell="A${n + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>`
        : '<sheetViews><sheetView workbookViewId="0"/></sheetViews>',
    );
    if (a.larguras.length)
      partes.push(
        "<cols>" +
          a.larguras
            .map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`)
            .join("") +
          "</cols>",
      );
    partes.push("<sheetData>");
    a.linhas.forEach((linha, r) => {
      const cels: string[] = [];
      linha.forEach((c, k) => {
        if (!c) return;
        const ref = `${coluna(k)}${r + 1}`;
        const s = c.e ? ` s="${c.e}"` : "";
        if (c.v === null || c.v === "" || (typeof c.v === "number" && !Number.isFinite(c.v)))
          cels.push(`<c r="${ref}"${s}/>`);
        else if (typeof c.v === "number") cels.push(`<c r="${ref}"${s}><v>${c.v}</v></c>`);
        else
          cels.push(
            `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${esc(c.v)}</t></is></c>`,
          );
      });
      partes.push(`<row r="${r + 1}">${cels.join("")}</row>`);
    });
    partes.push("</sheetData>");
    if (a.filtro) partes.push(`<autoFilter ref="${a.filtro}"/>`);
    if (a.mesclar?.length)
      partes.push(
        `<mergeCells count="${a.mesclar.length}">` +
          a.mesclar.map((m) => `<mergeCell ref="${m}"/>`).join("") +
          "</mergeCells>",
      );
    partes.push(
      '<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/>',
    );
    if (a.paisagem)
      partes.push('<pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0"/>');
    partes.push("</worksheet>");
    return partes.join("");
  };

  const BORDA = 'applyBorder="1" borderId="1"';
  const estilos =
    XML +
    `<styleSheet ${NS}>` +
    '<numFmts count="3"><numFmt numFmtId="164" formatCode="0.0%"/><numFmt numFmtId="165" formatCode="[h]:mm:ss"/>' +
    '<numFmt numFmtId="166" formatCode="dd/mm/yyyy hh:mm:ss"/></numFmts>' +
    '<fonts count="8">' +
    '<font><sz val="11"/><name val="Calibri"/><family val="2"/></font>' +
    '<font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font>' +
    '<font><b/><sz val="16"/><color rgb="FF1F4E79"/><name val="Calibri"/><family val="2"/></font>' +
    '<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/></font>' +
    '<font><i/><sz val="10"/><color rgb="FF5F6B7A"/><name val="Calibri"/><family val="2"/></font>' +
    '<font><b/><sz val="11"/><color rgb="FF1E7B3A"/><name val="Calibri"/><family val="2"/></font>' +
    '<font><b/><sz val="11"/><color rgb="FFB45309"/><name val="Calibri"/><family val="2"/></font>' +
    '<font><strike/><sz val="11"/><color rgb="FF8A94A3"/><name val="Calibri"/><family val="2"/></font>' +
    "</fonts>" +
    '<fills count="5"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>' +
    '<fill><patternFill patternType="solid"><fgColor rgb="FF1F4E79"/><bgColor indexed="64"/></patternFill></fill>' +
    '<fill><patternFill patternType="solid"><fgColor rgb="FFDCE6F2"/><bgColor indexed="64"/></patternFill></fill>' +
    '<fill><patternFill patternType="solid"><fgColor rgb="FFEEF2F7"/><bgColor indexed="64"/></patternFill></fill>' +
    "</fills>" +
    '<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border>' +
    '<border><left style="thin"><color rgb="FFC9D3E0"/></left><right style="thin"><color rgb="FFC9D3E0"/></right>' +
    '<top style="thin"><color rgb="FFC9D3E0"/></top><bottom style="thin"><color rgb="FFC9D3E0"/></bottom><diagonal/></border></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="18">' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' + // 0 padrão
    '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>' + // 1 título
    '<xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="1"><alignment wrapText="0"/></xf>' + // 2 subtítulo
    `<xf numFmtId="0" fontId="3" fillId="2" ${BORDA} xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>` + // 3 cabeçalho
    `<xf numFmtId="0" fontId="0" fillId="0" ${BORDA} xfId="0"/>` + // 4 texto
    `<xf numFmtId="1" fontId="0" fillId="0" ${BORDA} xfId="0" applyNumberFormat="1"/>` + // 5 inteiro
    `<xf numFmtId="164" fontId="0" fillId="0" ${BORDA} xfId="0" applyNumberFormat="1"/>` + // 6 porcentagem
    `<xf numFmtId="165" fontId="0" fillId="0" ${BORDA} xfId="0" applyNumberFormat="1"/>` + // 7 duração
    `<xf numFmtId="166" fontId="0" fillId="0" ${BORDA} xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="left"/></xf>` + // 8 data e hora
    `<xf numFmtId="0" fontId="1" fillId="3" ${BORDA} xfId="0" applyFont="1" applyFill="1"/>` + // 9 total texto
    `<xf numFmtId="1" fontId="1" fillId="3" ${BORDA} xfId="0" applyFont="1" applyFill="1" applyNumberFormat="1"/>` + // 10 total inteiro
    `<xf numFmtId="164" fontId="1" fillId="3" ${BORDA} xfId="0" applyFont="1" applyFill="1" applyNumberFormat="1"/>` + // 11 total %
    `<xf numFmtId="165" fontId="1" fillId="3" ${BORDA} xfId="0" applyFont="1" applyFill="1" applyNumberFormat="1"/>` + // 12 total duração
    `<xf numFmtId="0" fontId="5" fillId="0" ${BORDA} xfId="0" applyFont="1"/>` + // 13 atendida
    `<xf numFmtId="0" fontId="6" fillId="0" ${BORDA} xfId="0" applyFont="1"/>` + // 14 callback
    `<xf numFmtId="0" fontId="7" fillId="0" ${BORDA} xfId="0" applyFont="1"/>` + // 15 removido
    '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>' + // 16 rótulo
    `<xf numFmtId="0" fontId="1" fillId="4" borderId="0" xfId="0" applyFont="1" applyFill="1"/>` + // 17 seção
    "</cellXfs>" +
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
    "</styleSheet>";

  const nomeNaFormula = (n: string): string => `'${n.replace(/'/g, "''")}'`;
  const filtros = abas
    .map((a, i) => (a.filtro ? { i, ref: a.filtro.replace(/([A-Z]+)(\d+)/g, "$$$1$$$2") } : null))
    .filter((x): x is { i: number; ref: string } => x !== null);
  const arquivos: [string, string][] = [
    [
      "[Content_Types].xml",
      XML +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
        abas
          .map(
            (_, i) =>
              `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
          )
          .join("") +
        "</Types>",
    ],
    [
      "_rels/.rels",
      XML +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
        "</Relationships>",
    ],
    [
      "xl/workbook.xml",
      XML +
        `<workbook ${NS} ${NSR}><bookViews><workbookView/></bookViews><sheets>` +
        nomes
          .map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
          .join("") +
        "</sheets>" +
        (filtros.length
          ? "<definedNames>" +
            filtros
              .map(
                (f) =>
                  `<definedName name="_xlnm._FilterDatabase" localSheetId="${f.i}" hidden="1">${esc(nomeNaFormula(nomes[f.i] as string))}!${f.ref}</definedName>`,
              )
              .join("") +
            "</definedNames>"
          : "") +
        "</workbook>",
    ],
    [
      "xl/_rels/workbook.xml.rels",
      XML +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        abas
          .map(
            (_, i) =>
              `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
          )
          .join("") +
        `<Relationship Id="rId${abas.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
        "</Relationships>",
    ],
    ["xl/styles.xml", estilos],
    ...abas.map((a, i): [string, string] => [`xl/worksheets/sheet${i + 1}.xml`, planilha(a)]),
  ];

  // ZIP sem compressão ("stored"), nomes em UTF-8.
  const tabela = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    tabela[n] = c >>> 0;
  }
  const crc32 = (b: Uint8Array): number => {
    let c = 0xffffffff;
    for (let i = 0; i < b.length; i++)
      c = (tabela[(c ^ (b[i] as number)) & 0xff] as number) ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const agora = new Date();
  const hora = (agora.getHours() << 11) | (agora.getMinutes() << 5) | (agora.getSeconds() >> 1);
  const data =
    ((Math.max(1980, agora.getFullYear()) - 1980) << 9) |
    ((agora.getMonth() + 1) << 5) |
    agora.getDate();
  const blocos: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let pos = 0;
  for (const [nome, conteudo] of arquivos) {
    const n = enc.encode(nome);
    const d = enc.encode(conteudo);
    const crc = crc32(d);
    const local = new Uint8Array(30 + n.length);
    const vl = new DataView(local.buffer);
    vl.setUint32(0, 0x04034b50, true);
    vl.setUint16(4, 20, true);
    vl.setUint16(6, 0x0800, true);
    vl.setUint16(8, 0, true);
    vl.setUint16(10, hora, true);
    vl.setUint16(12, data, true);
    vl.setUint32(14, crc, true);
    vl.setUint32(18, d.length, true);
    vl.setUint32(22, d.length, true);
    vl.setUint16(26, n.length, true);
    vl.setUint16(28, 0, true);
    local.set(n, 30);
    const cab = new Uint8Array(46 + n.length);
    const vc = new DataView(cab.buffer);
    vc.setUint32(0, 0x02014b50, true);
    vc.setUint16(4, 20, true);
    vc.setUint16(6, 20, true);
    vc.setUint16(8, 0x0800, true);
    vc.setUint16(10, 0, true);
    vc.setUint16(12, hora, true);
    vc.setUint16(14, data, true);
    vc.setUint32(16, crc, true);
    vc.setUint32(20, d.length, true);
    vc.setUint32(24, d.length, true);
    vc.setUint16(28, n.length, true);
    vc.setUint32(42, pos, true);
    cab.set(n, 46);
    blocos.push(local, d);
    central.push(cab);
    pos += local.length + d.length;
  }
  const tamCentral = central.reduce((s, b) => s + b.length, 0);
  const fim = new Uint8Array(22);
  const vf = new DataView(fim.buffer);
  vf.setUint32(0, 0x06054b50, true);
  vf.setUint16(8, arquivos.length, true);
  vf.setUint16(10, arquivos.length, true);
  vf.setUint32(12, tamCentral, true);
  vf.setUint32(16, pos, true);
  const todos = [...blocos, ...central, fim];
  const saida = new Uint8Array(todos.reduce((s, b) => s + b.length, 0));
  let p = 0;
  for (const b of todos) {
    saida.set(b, p);
    p += b.length;
  }
  return saida;
}
