import { useMemo, useRef, useState } from 'react';

import { HelpBlockView } from '../components/HelpBlocks.tsx';
import { HELP_CHAPTERS, HELP_SECTIONS, sectionText, type HelpSection } from '../help/index.ts';
import { useColumnSplit } from '../hooks/useColumnSplit.ts';
import { ColumnResizer } from '../components/ColumnResizer.tsx';

/**
 * **사용설명서 탭** (사용자 요청 2026-09-17).
 *
 * ## 왜 왼쪽 차례 + 오른쪽 본문인가
 *
 * 설명서를 여는 사람은 두 종류다. **처음 쓰는 사람**은 위에서 아래로 읽고,
 * **막힌 사람**은 지금 막힌 것만 찾는다. 차례를 늘 띄워 두면 둘 다 된다 —
 * 앞사람은 다음 장이 보이고, 뒷사람은 훑어 고른다.
 *
 * ## 검색은 본문까지 본다
 *
 * 제목만 뒤지면 '격리' 나 'CP949' 같은 낱말로 찾을 수 없다. 그런데 막힌 사람이
 * 손에 쥔 것은 대개 **화면에 뜬 낱말 하나**다. 그래서 표 칸까지 납작하게 펴서 본다.
 *
 * ## 한 장씩만 그린다
 *
 * 전부 그려 놓고 스크롤하는 길도 있지만, 그러면 '지금 어디를 읽는 중인지' 가
 * 흐려지고 검색 결과로 뛰어도 어디가 걸렸는지 눈에 띄지 않는다.
 */

/** 검색용으로 한 번만 펴 둔다 — 글자를 칠 때마다 다시 펴면 목록이 버벅인다 */
const HAYSTACK: ReadonlyArray<{ id: string; text: string }> = HELP_SECTIONS.map((section) => ({
  id: section.id,
  text: sectionText(section).toLowerCase(),
}));

function matches(query: string): Set<string> | null {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return null;
  return new Set(HAYSTACK.filter((row) => row.text.includes(needle)).map((row) => row.id));
}

export function HelpPanel(): React.JSX.Element {
  const [currentId, setCurrentId] = useState<string>(HELP_SECTIONS[0]?.id ?? '');
  const [query, setQuery] = useState('');
  const bodyRef = useRef<HTMLDivElement>(null);

  const hits = useMemo(() => matches(query), [query]);

  const current: HelpSection | undefined =
    HELP_SECTIONS.find((section) => section.id === currentId) ?? HELP_SECTIONS[0];

  const flat = HELP_SECTIONS;
  const at = flat.findIndex((section) => section.id === current?.id);
  const prev = at > 0 ? flat[at - 1] : undefined;
  const next = at >= 0 && at < flat.length - 1 ? flat[at + 1] : undefined;

  /** 장을 옮기면 본문을 맨 위로 — 긴 장을 읽다 옮기면 중간부터 보인다 */
  function go(id: string): void {
    setCurrentId(id);
    bodyRef.current?.scrollTo({ top: 0 });
  }

  const split = useColumnSplit('help', { edge: 'start', min: 180, minNeighbor: 320, label: '차례' });

  return (
    <div className="help" style={split.style}>
      <nav className="help-toc">
        <input
          type="search"
          className="help-search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="설명서에서 찾기"
          aria-label="설명서에서 찾기"
        />

        {hits !== null && (
          <p className="help-hits">
            {hits.size > 0 ? `${hits.size}개 장에서 찾았습니다` : '찾은 것이 없습니다'}
          </p>
        )}

        {HELP_CHAPTERS.map((chapter) => {
          const shown = chapter.sections.filter((section) => hits === null || hits.has(section.id));
          // 검색 중에 걸린 것이 없는 부(部)는 통째로 숨긴다 — 빈 제목만 남으면 헷갈린다
          if (shown.length === 0) return null;

          return (
            <section key={chapter.id}>
              <h3>{chapter.title}</h3>
              <ul>
                {shown.map((section) => (
                  <li key={section.id}>
                    <button
                      type="button"
                      className={`help-link${section.id === current?.id ? ' active' : ''}`}
                      onClick={() => go(section.id)}
                    >
                      <span className="t">{section.title}</span>
                      <span className="s">{section.summary}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </nav>

      <ColumnResizer {...split.resizer} />

      <div className="help-body" ref={bodyRef}>
        {current === undefined ? (
          <p className="hintline muted">설명서가 비어 있습니다.</p>
        ) : (
          <article className="card help-article">
            <h2>{current.title}</h2>
            <p className="help-summary">{current.summary}</p>

            {current.blocks.map((block, index) => (
              <HelpBlockView key={index} block={block} />
            ))}

            <div className="help-nav">
              {prev !== undefined && (
                <button type="button" onClick={() => go(prev.id)}>
                  ◀ {prev.title}
                </button>
              )}
              <span className="spacer" />
              {next !== undefined && (
                <button type="button" onClick={() => go(next.id)}>
                  {next.title} ▶
                </button>
              )}
            </div>
          </article>
        )}
      </div>
    </div>
  );
}
