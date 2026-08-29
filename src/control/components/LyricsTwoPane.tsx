/**
 * 가사 편집 — **두 칸을 나란히 두고 양쪽을 고친다.**
 *
 * ## 전에는 왜 복잡했나
 *
 * 편집 수단이 넷이었다 — 줄 격자, 'X 가사 전체 지우기', '원문으로 편집', '타언어 가사'.
 * 각각 성격이 달라 무엇을 쓸지 고르는 것부터 일이었고, 타언어 창은 **한국어가 읽기
 * 전용**이라 한국어를 고치려면 다른 수단으로 옮겨 가야 했다 (2026-08-29 사용자).
 *
 * 이제 한 가지다. 왼쪽에 한국어, 오른쪽에 다른 언어, 둘 다 고칠 수 있고, 줄 수만 맞추면
 * 저장된다.
 *
 * ## 입력값을 여기서 들고 있는다
 *
 * 두 칸의 글은 `useState` 로 여기 둔다. 합친 결과에서 되읽으면 **한글을 조합하는
 * 도중에 커서가 튄다** — 자음·모음이 합쳐지기 전 값으로 칸이 다시 그려지기 때문이다.
 * 부모에게는 합친 결과만 올려 보낸다.
 */

import { useEffect, useMemo, useState } from 'react';

import { composeLyrics, toBlock, type SectionCount } from '../../../lib/lyrics-compose.ts';
import { LANG_LABELS, PRIMARY_LANG, langChoices } from '../../../lib/lang-select.ts';
import { parseLyrics } from '../../../lib/lyrics-parser.ts';
import type { LangCode } from '../../../shared/types.ts';

interface Props {
  /** 이 곡의 현재 가사 (`|` 형식). 곡이 바뀌면 두 칸을 다시 채운다 */
  text: string;
  /** 곡 식별자 — 이 값이 바뀔 때만 칸을 다시 채운다 (입력 중에 덮이지 않게) */
  songId: number;
  /** 이 곡이 가진 언어 */
  langs: readonly LangCode[];
  onChange: (next: string) => void;
}

/**
 * 절별 줄 수를 한 줄로 요약한다.
 *
 * 다 맞으면 짧게 말한다. 잘 하고 있을 때 화면이 시끄러우면 정작 어긋난 절이 묻힌다.
 */
function summarize(counts: readonly SectionCount[]): { text: string; ok: boolean } {
  if (counts.length === 0) return { text: '가사가 비어 있습니다', ok: false };
  const filled = counts.filter((c) => c.secondary > 0);
  if (filled.length === 0) return { text: `${counts.length}개 절 · 번역 없음`, ok: true };
  const off = counts.filter((c) => c.secondary > 0 && c.secondary !== c.primary);
  const empty = counts.filter((c) => c.secondary === 0);
  if (off.length === 0 && empty.length === 0) {
    return { text: `${counts.length}개 절 모두 줄 수가 맞습니다`, ok: true };
  }
  return { text: counts.map((c) => `${c.label} ${c.secondary}/${c.primary}`).join(' · '), ok: false };
}

export function LyricsTwoPane({ text, songId, langs, onChange }: Props): React.JSX.Element {
  /** 오른쪽 칸의 언어 — 곡에 있는 것을 먼저, 없으면 영어 */
  const [lang, setLang] = useState<LangCode>(
    () => langs.find((l) => l !== PRIMARY_LANG) ?? 'en',
  );
  const [ko, setKo] = useState('');
  const [other, setOther] = useState('');

  /*
   * 곡이 바뀌거나 언어를 바꿀 때만 칸을 다시 채운다. `text` 를 의존성에 넣으면
   * 우리가 올려 보낸 값이 되돌아와 입력 중에 칸이 덮인다.
   */
  useEffect(() => {
    const sections = parseLyrics(text);
    setKo(toBlock(sections, PRIMARY_LANG));
    setOther(toBlock(sections, lang));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [songId, lang]);

  const result = useMemo(
    () => composeLyrics(ko, other, lang, { text, langs }),
    // text·langs 는 손대지 않은 언어를 되살리는 데만 쓴다
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ko, other, lang],
  );

  /** 합친 결과를 부모에게 올린다 — 저장은 부모의 '가사 저장' 이 한다 */
  useEffect(() => {
    onChange(result.text);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result.text]);

  const status = summarize(result.counts);
  const others = langChoices(langs).filter((l) => l !== PRIMARY_LANG);
  const label = LANG_LABELS[lang] ?? lang;

  return (
    <div className="translation-pane">
      <div className="row translation-head">
        <b>{LANG_LABELS[PRIMARY_LANG]} ↔ {label}</b>
        <span className={status.ok ? 'hintline ok' : 'hintline warn'}>{status.text}</span>
        <span className="candidates">
          {others.map((code) => (
            <button
              key={code}
              type="button"
              className={code === lang ? 'primary' : undefined}
              onClick={() => setLang(code)}
              title={langs.includes(code) ? '' : '아직 이 언어 가사가 없습니다'}
            >
              {LANG_LABELS[code] ?? code}
              {!langs.includes(code) && ' +'}
            </button>
          ))}
        </span>
      </div>

      <div className="translation-cols">
        <label className="translation-col">
          <span className="muted">한국어 — 절 나눔과 줄 수의 기준입니다</span>
          <textarea
            className="lyrics-editor"
            value={ko}
            onChange={(event) => setKo(event.target.value)}
            spellCheck={false}
            rows={14}
            placeholder={'[1절]\n첫 줄\n둘째 줄\n\n[2절]\n…'}
            aria-label="한국어 가사"
          />
        </label>
        <label className="translation-col">
          <span className="muted">{label} — 같은 줄 수로 적으세요</span>
          <textarea
            className="lyrics-editor"
            value={other}
            onChange={(event) => setOther(event.target.value)}
            spellCheck={false}
            rows={14}
            placeholder={'[1절]\n첫 줄 번역\n둘째 줄 번역\n\n[2절]\n…'}
            aria-label={`${label} 가사`}
          />
        </label>
      </div>

      {result.problems.length > 0 && (
        <ul className="hintline warn translation-problems">
          {result.problems.slice(0, 4).map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      )}
      <p className="hintline muted">
        <code>[1절]</code> 로 절을 나눕니다. 줄바꿈이 그대로 화면 줄이 됩니다.
        번역을 지우려면 오른쪽 칸을 비우고 저장하세요.
      </p>
    </div>
  );
}
