import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  NumberFormat,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';

/**
 * 把导出用的 Markdown 转成 Word（docx）。
 *
 * 只依赖 docx 这个纯 JS 库，不引入任何需要编译的原生模块；
 * 中文字体只写字体名（宋体），不内嵌字体文件，避免产物膨胀。
 */

const FONT = { ascii: 'Calibri', hAnsi: 'Calibri', eastAsia: '宋体', cs: '宋体' };
const CODE_FONT = { ascii: 'Consolas', hAnsi: 'Consolas', eastAsia: '宋体' };

const LINE = { style: BorderStyle.SINGLE, size: 4, color: 'C9BFAD' };
const TABLE_BORDERS = {
  top: LINE,
  bottom: LINE,
  left: LINE,
  right: LINE,
  insideHorizontal: LINE,
  insideVertical: LINE,
};

const HEADING_LEVEL: Record<number, (typeof HeadingLevel)[keyof typeof HeadingLevel]> = {
  1: HeadingLevel.HEADING_1,
  2: HeadingLevel.HEADING_2,
  3: HeadingLevel.HEADING_3,
  4: HeadingLevel.HEADING_4,
};

/** 行内语法：**粗体** 与 `行内代码`，其余按普通文本。 */
function inlineRuns(text: string, forceBold = false): TextRun[] {
  const runs: TextRun[] = [];
  const emit = (value: string, bold: boolean, code: boolean) => {
    const parts = value.split('\n');
    parts.forEach((part, index) => {
      runs.push(
        new TextRun({
          text: part,
          bold: bold || forceBold,
          font: code ? CODE_FONT : FONT,
          break: index > 0 ? 1 : undefined,
        }),
      );
    });
  };
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) emit(text.slice(last, m.index), false, false);
    if (m[0].startsWith('**')) emit(m[0].slice(2, -2), true, false);
    else emit(m[0].slice(1, -1), false, true);
    last = m.index + m[0].length;
  }
  if (last < text.length) emit(text.slice(last), false, false);
  return runs;
}

function heading(level: number, text: string): Paragraph {
  return new Paragraph({
    heading: HEADING_LEVEL[level] || HeadingLevel.HEADING_4,
    keepNext: true,
    spacing: { before: level === 1 ? 0 : 240, after: 120 },
    children: inlineRuns(text, true),
  });
}

function bulletItem(text: string): Paragraph {
  return new Paragraph({
    children: inlineRuns(text),
    bullet: { level: 0 },
    indent: { left: 420, hanging: 210 },
    spacing: { after: 60 },
  });
}

function numberedItem(text: string): Paragraph {
  return new Paragraph({
    children: inlineRuns(text),
    numbering: { reference: 'ordered-list', level: 0 },
    spacing: { after: 60 },
  });
}

function rule(): Paragraph {
  return new Paragraph({
    spacing: { before: 80, after: 160 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'D8CFBE' } },
  });
}

function splitRow(line: string): string[] {
  const body = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return body.split('|').map((c) => c.trim());
}

function isSeparator(line: string): boolean {
  const cells = splitRow(line);
  return cells.length > 0 && cells.every((c) => /^:?-{2,}:?$/.test(c));
}

function cell(text: string, header: boolean): TableCell {
  return new TableCell({
    children: [new Paragraph({ children: inlineRuns(text, header), spacing: { after: 20 } })],
    shading: header ? { fill: 'F4EFE4' } : undefined,
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
  });
}

function table(rows: string[][]): Table {
  const header = rows[0] || [];
  const body = rows.slice(1);
  const columnCount = Math.max(header.length, ...body.map((r) => r.length));
  const pad = (r: string[]) => Array.from({ length: columnCount }, (_, i) => r[i] ?? '');
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: TABLE_BORDERS,
    rows: [
      new TableRow({ tableHeader: true, children: pad(header).map((t) => cell(t, true)) }),
      ...body.map((r) => new TableRow({ children: pad(r).map((t) => cell(t, false)) })),
    ],
  });
}

const BLOCK_START = /^(#{1,4}\s|[-*·•]\s|\d+[.、)]\s|\||-{3,}$)/;

/** Markdown → 文档块（段落 / 表格）。 */
export function markdownToBlocks(md: string): Array<Paragraph | Table> {
  const lines = md.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Array<Paragraph | Table> = [];
  let i = 0;

  while (i < lines.length) {
    const trimmed = lines[i].trim();
    if (!trimmed) {
      i += 1;
      continue;
    }

    // 表格：表头行 + 分隔行 + 若干数据行
    if (trimmed.startsWith('|') && i + 1 < lines.length && isSeparator(lines[i + 1])) {
      const rows: string[][] = [splitRow(trimmed)];
      i += 2;
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        rows.push(splitRow(lines[i].trim()));
        i += 1;
      }
      blocks.push(table(rows));
      continue;
    }

    if (/^-{3,}$/.test(trimmed)) {
      blocks.push(rule());
      i += 1;
      continue;
    }

    const h = /^(#{1,4})\s+(.*)$/.exec(trimmed);
    if (h) {
      blocks.push(heading(h[1].length, h[2]));
      i += 1;
      continue;
    }

    const ul = /^[-*·•]\s+(.*)$/.exec(trimmed);
    if (ul) {
      blocks.push(bulletItem(ul[1]));
      i += 1;
      continue;
    }

    const ol = /^(\d+)[.、)]\s+(.*)$/.exec(trimmed);
    if (ol) {
      blocks.push(numberedItem(ol[2]));
      i += 1;
      continue;
    }

    // 普通段落：合并连续的非空、非特殊起始行
    const para: string[] = [trimmed];
    i += 1;
    while (i < lines.length) {
      const next = lines[i].trim();
      if (!next || BLOCK_START.test(next)) break;
      para.push(next);
      i += 1;
    }
    blocks.push(new Paragraph({ children: inlineRuns(para.join('\n')), spacing: { after: 120 } }));
  }

  return blocks;
}

/** 生成 docx 文件内容（Buffer）。 */
export async function buildDocx(title: string, markdown: string): Promise<Buffer> {
  const blocks = markdownToBlocks(markdown);
  const doc = new Document({
    creator: '丰麟云面',
    title,
    description: '由丰麟云面导出',
    styles: {
      default: {
        document: {
          run: { font: FONT, size: 21 },
          paragraph: { spacing: { after: 100, line: 300 } },
        },
      },
    },
    numbering: {
      config: [
        {
          reference: 'ordered-list',
          levels: [
            {
              level: 0,
              format: NumberFormat.DECIMAL,
              text: '%1.',
              alignment: AlignmentType.LEFT,
              style: { paragraph: { indent: { left: 420, hanging: 260 } } },
            },
          ],
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: 11906, height: 16838 }, // A4
            margin: { top: 1134, right: 1134, bottom: 1134, left: 1134 }, // 2cm
          },
        },
        children: blocks,
      },
    ],
  });
  return Buffer.from(await Packer.toBuffer(doc));
}
