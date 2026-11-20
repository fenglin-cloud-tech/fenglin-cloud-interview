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

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      flushList();
      flushPara();
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
