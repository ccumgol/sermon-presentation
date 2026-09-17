import { parseInline, type HelpBlock } from '../help/index.ts';

/**
 * 설명서 글 한 덩이를 그린다.
 *
 * 블록 종류마다 **제 모양**이 있다 — 절차는 번호가 붙고, 경고는 눈에 띄고,
 * 단축키는 키 모양으로 나온다. 한 덩이로 뭉뚱그리면 훑어볼 수 없다.
 */

function Inline({ text }: { text: string }): React.JSX.Element {
  return (
    <>
      {parseInline(text).map((token, index) => {
        if (token.t === 'b') return <b key={index}>{token.v}</b>;
        if (token.t === 'code') return <code key={index}>{token.v}</code>;
        return <span key={index}>{token.v}</span>;
      })}
    </>
  );
}

export function HelpBlockView({ block }: { block: HelpBlock }): React.JSX.Element {
  switch (block.t) {
    case 'p':
      return (
        <p className="help-p">
          <Inline text={block.text} />
        </p>
      );

    case 'sub':
      return <h4 className="help-sub">{block.text}</h4>;

    case 'steps':
      return (
        <ol className="help-steps">
          {block.items.map((item, index) => (
            <li key={index}>
              <Inline text={item} />
            </li>
          ))}
        </ol>
      );

    case 'list':
      return (
        <ul className="help-list">
          {block.items.map((item, index) => (
            <li key={index}>
              <Inline text={item} />
            </li>
          ))}
        </ul>
      );

    case 'table':
      return (
        // 좁은 화면에서 표만 옆으로 밀리게 둔다 — 글까지 밀리면 읽을 수 없다
        <div className="help-table-wrap">
          <table className="help-table">
            <thead>
              <tr>
                {block.head.map((cell, index) => (
                  <th key={index}>
                    <Inline text={cell} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {row.map((cell, cellIndex) => (
                    <td key={cellIndex}>
                      <Inline text={cell} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );

    case 'note':
      return (
        <div className={`help-note ${block.kind}`}>
          <span className="mark" aria-hidden="true">
            {block.kind === 'warn' ? '⚠️' : '💡'}
          </span>
          <div>
            <Inline text={block.text} />
          </div>
        </div>
      );

    case 'keys':
      return (
        <table className="help-keys">
          <tbody>
            {block.rows.map((row, index) => (
              <tr key={index}>
                <td className="k">
                  {row.keys.map((key) => (
                    <kbd key={key}>{key}</kbd>
                  ))}
                </td>
                <td>
                  <Inline text={row.what} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      );
  }
}
