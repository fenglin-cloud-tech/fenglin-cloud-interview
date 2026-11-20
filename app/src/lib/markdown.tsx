import React from 'react';

/** 极简 Markdown 渲染：只支持简历场景需要的语法，全部走 React 节点，不使用 innerHTML。 */
export function renderMarkdown(text: string): React.ReactNode {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const blocks: React.ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let para: string[] = [];

  const flushList = () => {
    if (!list) return;
    const items = list.items.map((item, i) => <li key={i}>{inline(item)}</li>);
    blocks.push(list.ordered ? <ol key={`l${blocks.length}`}>{items}</ol> : <ul key={`l${blocks.length}`}>{items}</ul>);
    list = null;
  };
  const flushPara = () => {
    if (!para.length) return;
    blocks.push(<p key={`p${blocks.length}`}>{inline(para.join('\n'))}</p>);
    para = [];
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trimEnd();
    if (!line.trim()) {
      flushList();
      flushPara();
      continue;
    }
    // 表格：当前行是表头，下一行是 | --- | 分隔行
    if (line.trim().startsWith('|') && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      flushList();
      flushPara();
      const header = splitRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        rows.push(splitRow(lines[i]));
        i += 1;
      }
      i -= 1;
      blocks.push(
        <table className="md-table" key={`tbl${blocks.length}`}>
          <thead>
            <tr>
              {header.map((cell, ci) => (
                <th key={ci}>{inline(cell)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => (
              <tr key={ri}>
                {header.map((_, ci) => (
                  <td key={ci}>{inline(row[ci] ?? '')}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>,
      );
      continue;
    }
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) {
      flushList();
      flushPara();
      const level = h[1].length;
      const content = inline(h[2]);
      blocks.push(
        level === 1 ? (
          <h2 key={blocks.length} className="md-h1">
            {content}
          </h2>
        ) : level === 2 ? (
          <h3 key={blocks.length} className="md-h2">
            {content}
          </h3>
        ) : (
          <h4 key={blocks.length} className="md-h3">
            {content}
          </h4>
        ),
      );
      continue;
    }
    if (/^---+$/.test(line.trim())) {
      flushList();
      flushPara();
      blocks.push(<hr key={blocks.length} />);
      continue;
    }
    const ul = /^[-·•*]\s+(.*)$/.exec(line.trim());
    const ol = /^(\d+)[.、)]\s+(.*)$/.exec(line.trim());
    if (ul) {
      flushPara();
      if (!list || list.ordered) {
        flushList();
        list = { ordered: false, items: [] };
      }
      list.items.push(ul[1]);
      continue;
    }
    if (ol) {
      flushPara();
      if (!list || !list.ordered) {
        flushList();
        list = { ordered: true, items: [] };
      }
      list.items.push(ol[2]);
      continue;
    }
    flushList();
    para.push(line);
  }
  flushList();
  flushPara();
  return <>{blocks}</>;
}

function inline(text: string): React.ReactNode {
  const nodes: React.ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) nodes.push(withBreaks(text.slice(last, m.index), `t${key++}`));
    const token = m[0];
    if (token.startsWith('**')) {
      nodes.push(<strong key={`b${key++}`}>{token.slice(2, -2)}</strong>);
    } else {
      nodes.push(<code key={`c${key++}`}>{token.slice(1, -1)}</code>);
    }
    last = m.index + token.length;
  }
  if (last < text.length) nodes.push(withBreaks(text.slice(last), `t${key++}`));
  return nodes;
}

function withBreaks(text: string, keyPrefix: string): React.ReactNode {
  const parts = text.split('\n');
  return (
    <React.Fragment key={keyPrefix}>
      {parts.map((p, i) => (
        <React.Fragment key={i}>
          {i > 0 && <br />}
          {p}
        </React.Fragment>
      ))}
    </React.Fragment>
  );
}

function splitRow(line: string): string[] {
  const body = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return body.split('|').map((cell) => cell.trim());
}

function isTableSeparator(line: string): boolean {
  const cells = splitRow(line);
  return cells.length > 0 && cells.every((cell) => /^:?-{2,}:?$/.test(cell));
}
