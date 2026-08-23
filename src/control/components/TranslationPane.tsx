/**
 * 타언어 가사 입력 — 한국어를 옆에 두고 **줄 맞춰** 적는다.
 *
 * ## 전에는 왜 불편했나
 *
 * 번역을 넣는 길이 접힌 `<details>` 안에 있었고, 넣은 뒤 '짝 맞춰 채우기' 를 눌러야
 * 했다. 그리고 줄이 맞는지는 **누른 뒤에야** 알 수 있었다. 실제로 4,396곡 중 영어
 * 가사가 들어간 곡은 **1곡(2줄)** 이었다 — 쓰이지 않는 기능이었다.
 *
 * ## 지금
 *
 * 언어를 고르면 창이 열리고, **왼쪽에 한국어가 그대로 보인다.** 오른쪽에 같은 줄 수로
 * 적으면 그때그때 `|` 형식으로 짝지어 들어간다. 줄이 어긋나면 **적는 동안** 알려 준다.
 *
 * ## 저장은 사람이 누른다
 *
 * 이 창은 위의 가사 편집 칸을 채울 뿐이다. 자동 결과는 제안이라는 이 프로젝트의
 * 규칙을 따른다 — 사람이 보고 저장을 누른다.
 */

import { useEffect, useMemo, useState } from 'react';

import { LANG_LABELS, PRIMARY_LANG, langChoices } from '../../../lib/lang-select.ts';
import {
  compareLineCounts,
  extractSecondaryLyrics,
  mergeSecondaryLyrics,
  stripLang,
} from '../../../lib/lyrics-merge.ts';
import type { LangCode } from '../../../shared/types.ts';

interface Props {
  /** 가사 원문 (`|` 형식) — 이 창이 채우는 대상 */
  text: string;
  onChange: (next: string) => void;
  /** 이 곡에 이미 들어 있는 언어 — 켜진 언어와 합쳐 고를 수 있게 한다 */
  existingLangs: readonly LangCode[];
}

/**
 * 절별 줄 수를 한 줄로 요약한다 — `1절 4/4 · 2절 0/4`
 *
 * 다 맞으면 짧게 '모두 맞습니다' 만 보여 준다. 잘 하고 있을 때 화면이 시끄러우면
 * 정작 어긋난 절이 묻힌다.
 */
function summarize(counts: readonly { label: string; primary: number; secondary: number }[]): {
  text: string;
  ok: boolean;
} {
  const filled = counts.filter((c) => c.secondary > 0);
  const mismatched = counts.filter((c) => c.secondary > 0 && c.secondary !== c.primary);
  const empty = counts.filter((c) => c.secondary === 0);

  if (filled.length === 0) return { text: '아직 비어 있습니다', ok: false };
  if (mismatched.length === 0 && empty.length === 0) {
    return { text: `${counts.length}개 절 모두 줄 수가 맞습니다`, ok: true };
  }
  const parts = counts.map((c) => `${c.label} ${c.secondary}/${c.primary}`);
  return {
    text: parts.join(' · '),
    ok: mismatched.length === 0 && empty.length === 0,
  };
}

export function TranslationPane({ text, onChange, existingLangs }: Props): React.JSX.Element {
  /** 열려 있는 번역 창 */
  const [open, setOpen] = useState<LangCode[]>([]);
  /** 창마다의 입력 — 원문에서 되읽지 않고 여기서 들고 있는다(입력 중 커서가 튀지 않게) */
  const [drafts, setDrafts] = useState<Partial<Record<LangCode, string>>>({});

  const addable = langChoices(existingLangs).filter(
    (lang) => lang !== PRIMARY_LANG && !open.includes(lang),
  );
  const [picked, setPicked] = useState<LangCode | ''>('');

  /**
   * 이미 번역이 들어 있는 언어는 처음부터 열어 둔다.
   *
   * 빈 창을 주면 '아직 없다' 고 오해해 다시 적고, 그러면 있던 번역이 덮인다.
   */
  useEffect(() => {
    const withData = existingLangs.filter((lang) => lang !== PRIMARY_LANG);
    if (withData.length === 0) return;
    setOpen((prev) => {
      const next = [...prev];
      for (const lang of withData) if (!next.includes(lang)) next.push(lang);
      return next;
    });
    setDrafts((prev) => {
      const next = { ...prev };
      for (const lang of withData) {
        if (next[lang] === undefined) next[lang] = extractSecondaryLyrics(text, lang);
      }
      return next;
    });
    // text 를 의존성에 넣지 않는다 — 채울 때마다 창을 다시 만들면 입력이 끊긴다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existingLangs.join(',')]);

  /** 왼쪽에 보여 줄 한국어 — 줄을 맞출 기준이다 */
  const primaryBlock = useMemo(
    () => extractSecondaryLyrics(text, PRIMARY_LANG),
    [text],
  );

  function apply(lang: LangCode, value: string): void {
    setDrafts((prev) => ({ ...prev, [lang]: value }));
    // 비웠으면 그 언어를 걷어낸다 — 병합은 '빈 입력' 을 '그대로 두기' 로 읽는다
    onChange(
      value.trim().length === 0
        ? stripLang(text, lang)
        : mergeSecondaryLyrics(text, value, lang).text,
    );
  }

  function close(lang: LangCode): void {
    setOpen((prev) => prev.filter((l) => l !== lang));
    setDrafts((prev) => ({ ...prev, [lang]: undefined }));
  }

  return (
    <div className="translation-panes">
      <div className="row detail-controls">
        <label>타언어 가사</label>
        <select
          value={picked}
          onChange={(event) => setPicked(event.target.value as LangCode | '')}
          disabled={addable.length === 0}
          aria-label="추가할 언어"
        >
          <option value="">언어 고르기…</option>
          {addable.map((lang) => (
            <option key={lang} value={lang}>
              {LANG_LABELS[lang] ?? lang}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={picked === ''}
          onClick={() => {
            if (picked === '') return;
            setOpen((prev) => [...prev, picked]);
            setDrafts((prev) => ({
              ...prev,
              [picked]: prev[picked] ?? extractSecondaryLyrics(text, picked),
            }));
            setPicked('');
          }}
        >
          ＋ 타언어 가사 추가
        </button>
        {addable.length === 0 && open.length > 0 && (
          <span className="hintline muted">켜진 언어를 모두 열었습니다</span>
        )}
      </div>

      {open.map((lang) => {
        const value = drafts[lang] ?? '';
        const merged = value.trim().length > 0 ? mergeSecondaryLyrics(text, value, lang) : null;
        const status = summarize(compareLineCounts(text, lang));

        return (
          <div className="translation-pane" key={lang}>
            <div className="row translation-head">
              <b>{LANG_LABELS[lang] ?? lang}</b>
              <span className={status.ok ? 'hintline ok' : 'hintline muted'}>{status.text}</span>
              <button type="button" className="ghost" onClick={() => close(lang)}>
                창 닫기
              </button>
            </div>

            <div className="translation-cols">
              <label className="translation-col">
                <span className="muted">한국어 (기준)</span>
                <textarea
                  className="lyrics-editor"
                  value={primaryBlock}
                  readOnly
                  spellCheck={false}
                  rows={12}
                  tabIndex={-1}
                />
              </label>
              <label className="translation-col">
                <span className="muted">{LANG_LABELS[lang] ?? lang} — 같은 줄 수로 적으세요</span>
                <textarea
                  className="lyrics-editor"
                  value={value}
                  onChange={(event) => apply(lang, event.target.value)}
                  spellCheck={false}
                  rows={12}
                  placeholder={'[1절]\n첫 줄 번역\n둘째 줄 번역\n\n[2절]\n…'}
                />
              </label>
            </div>

            {merged !== null && merged.problems.length > 0 && (
              <ul className="hintline warn translation-problems">
                {merged.problems.slice(0, 4).map((problem) => (
                  <li key={problem}>{problem}</li>
                ))}
              </ul>
            )}
            {merged !== null && merged.dropped.length > 0 && (
              <p className="hintline warn">
                넘친 줄 {merged.dropped.length}개는 들어가지 않았습니다 — 한국어 줄 수를 넘었습니다.
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
