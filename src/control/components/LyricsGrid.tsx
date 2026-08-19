/**
 * 가사 비교·편집 격자 — 줄마다 여러 언어를 모아 보여 주고 그 자리에서 고친다.
 *
 * ## 왜 이 배치인가
 *
 * 언어를 **열**로 놓으면 편집 칸 479px 에 865px 이 필요해 좌우 스크롤이 생긴다
 * (1440×900 실측: 한국어 228 + 영어 458 + 中文 179). 긴 영어 줄 하나가 칸을 다 쓴다.
 * 그래서 **줄로 묶고 언어를 행**으로 놓는다 — 각 언어가 전체 폭을 쓰고 스크롤이 없다.
 *
 * 어긋남은 세 곳에서 알린다: 절 머리의 언어별 줄 수, 어긋난 절의 표시, 그리고
 * 짝이 없는 자리의 '없음' 칸. 빠진 자리를 목록에서 빼면 아무것도 안 보여
 * '번역이 없다' 를 알 수 없다.
 *
 * ## 상태를 갖지 않는다
 *
 * 글의 원본은 부르는 쪽의 편집 칸 텍스트다. 이 컴포넌트는 그것을 격자로 보여 주고
 * 고친 결과를 돌려줄 뿐이다. 구조를 따로 들고 있으면 두 벌이 어긋난다.
 */

import { useState } from 'react';

import { LANG_LABELS } from '../../../lib/lang-select.ts';
import { buildGrid, removeLang, setCell } from '../../../lib/lyrics-grid.ts';
import { formatLyrics, parseLyrics } from '../../../lib/lyrics-parser.ts';
import type { LangCode } from '../../../shared/types.ts';

interface Props {
  /** 편집 칸의 글 — 이것이 원본이다 */
  text: string;
  /** 격자에 보일 언어. 순서가 화면 위아래 순서가 된다 */
  langs: readonly LangCode[];
  /** 기준 언어 — 이 언어의 줄을 진하게 그린다 */
  primaryLang?: LangCode;
  onChange: (text: string) => void;
}

export function LyricsGrid({
  text,
  langs,
  primaryLang = 'ko',
  onChange,
}: Props): React.JSX.Element {
  /** 지금 고치고 있는 칸 — 하나만 열어 둔다 */
  const [editing, setEditing] = useState<{ section: number; line: number; lang: LangCode } | null>(
    null,
  );
  /** 편집 중인 글자 (커밋 전) */
  const [draft, setDraft] = useState('');

  const sections = parseLyrics(text, { primaryLang });
  const grid = buildGrid(sections, langs);

  function commit(): void {
    if (!editing) return;
    onChange(formatLyrics(setCell(sections, editing.section, editing.line, editing.lang, draft), primaryLang));
    setEditing(null);
  }

  function open(section: number, line: number, lang: LangCode, current: string | null): void {
    setEditing({ section, line, lang });
    setDraft(current ?? '');
  }

  function dropLang(lang: LangCode): void {
    const label = LANG_LABELS[lang] ?? lang;
    if (!window.confirm(`${label} 가사를 모두 지웁니다. 되돌릴 수 없습니다.`)) return;
    onChange(formatLyrics(removeLang(sections, lang), primaryLang));
  }

  if (grid.length === 0) {
    return <p className="hintline muted">가사가 없습니다. 아래 편집 칸에 붙여 넣으세요.</p>;
  }

  return (
    <div className="lyrics-grid">
      {grid.map((section, sectionIndex) => (
        <div className="lg-section" key={`${section.label}-${sectionIndex}`}>
          <div className="lg-head">
            <span className="lg-label">{section.label}</span>
            <span className="lg-counts">
              {langs.map((lang) => {
                const n = section.counts[lang] ?? 0;
                // 어긋난 절에서 수가 모자란 언어를 노랗게 — 어디를 봐야 하는지 바로 보이게
                const off = section.uneven && n > 0 && n !== Math.max(...langs.map((l) => section.counts[l] ?? 0));
                return (
                  <span key={lang} className={off ? 'warn' : undefined}>
                    {LANG_LABELS[lang] ?? lang} {n}
                  </span>
                );
              })}
            </span>
          </div>

          {section.rows.map((row) => (
            <div className="lg-row" key={row.lineIndex}>
              {row.cells.map((cell) => {
                const isEditing =
                  editing?.section === sectionIndex &&
                  editing.line === row.lineIndex &&
                  editing.lang === cell.lang;
                const isPrimary = cell.lang === primaryLang;

                return (
                  <div className={`lg-cell${isPrimary ? ' primary' : ''}`} key={cell.lang}>
                    <span className="lg-lang">
                      {/* 줄 번호는 첫 언어에만 — 세 번 적으면 눈이 어지럽다 */}
                      {cell.lang === langs[0] && <b>{row.lineIndex + 1}</b>}{' '}
                      {LANG_LABELS[cell.lang] ?? cell.lang}
                    </span>

                    {isEditing ? (
                      <input
                        className="lg-input"
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        onBlur={commit}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') commit();
                          // 되돌리기 — 잘못 눌러 들어왔을 때 빠져나갈 길
                          if (e.key === 'Escape') setEditing(null);
                        }}
                        // 예배 준비 중 손이 바로 글자로 가야 한다
                        autoFocus
                        spellCheck={false}
                        aria-label={`${section.label} ${row.lineIndex + 1}번 줄 ${LANG_LABELS[cell.lang] ?? cell.lang}`}
                      />
                    ) : (
                      <button
                        type="button"
                        className={`lg-text${cell.text === null ? ' missing' : ''}`}
                        onClick={() => open(sectionIndex, row.lineIndex, cell.lang, cell.text)}
                        title="눌러서 고치기"
                      >
                        {cell.text ?? '이 줄에 가사가 없습니다 — 눌러서 넣기'}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      ))}

      {/* 언어를 지우는 길 — 격자 안에 두면 실수로 누른다. 아래에 따로 둔다 */}
      <div className="lg-foot">
        {langs
          .filter((lang) => lang !== primaryLang && grid.some((s) => (s.counts[lang] ?? 0) > 0))
          .map((lang) => (
            <button key={lang} type="button" className="del" onClick={() => dropLang(lang)}>
              {LANG_LABELS[lang] ?? lang} 가사 전체 지우기
            </button>
          ))}
      </div>
    </div>
  );
}
