/**
 * 낱말로 절 찾기.
 *
 * 성경 탭은 참조(`요 3:16`)만 받았다. 설교를 준비하며 '사랑이 나오는 절' 을 찾는 길이
 * 앱 안에 없어서 밖에서 찾아 참조를 옮겨 적어야 했다. 서버는 처음부터 되어 있었고
 * (`GET /api/bible/search`) 화면에만 길이 없었다 (2026-09-03 전수 조사 §4.6 U-1).
 *
 * **찾은 절을 곧바로 송출하지 않는다.** 누르면 참조 칸에 넣기만 하고, 송출은 사람이
 * 한 번 더 누른다. 예배 중에도 쓰는 화면이라, 목록을 훑다가 잘못 누른 절이 회중 앞
 * 화면에 나가면 안 된다.
 */

import { useEffect, useRef, useState } from 'react';

import { highlightParts } from '../../../lib/search-highlight.ts';
import type { SearchResult, Testament, Translation } from '../../../shared/types.ts';
import { api, ApiError } from '../api.ts';

/** 한 번에 보여 줄 절 수. 더 있으면 '몇 절 중 몇 절' 로 알린다 */
const HIT_LIMIT = 50;

/** 찬양 검색과 같은 간격 — 한 글자 칠 때마다 부르지 않는다 */
const DEBOUNCE_MS = 200;

const SCOPES: ReadonlyArray<{ value: Testament | 'all'; label: string }> = [
  { value: 'all', label: '전체' },
  { value: 'OT', label: '구약' },
  { value: 'NT', label: '신약' },
];

interface Props {
  /** 어느 역본에서 찾을지 — 성경 탭의 주 역본을 그대로 쓴다 */
  translation: Translation | undefined;
  /** 찾은 절을 골랐을 때. 참조 칸에 넣는 일만 한다 */
  onPick: (reference: string) => void;
}

/**
 * 찾는 방식을 한 줄로 알린다.
 *
 * 왜 보여 주는가: 한국어는 **띄어쓰기까지 그대로** 있어야 걸린다(부분일치). 그걸 모르면
 * `주의은혜` 로 찾고 '없다' 는 결과를 받는다 — 자료가 없는 것이 아니라 찾는 방식이
 * 다른 것이다. 실제로 `주의 은혜를` 은 걸리고 `주의은혜` 는 안 걸린다.
 */
function strategyHint(strategy: SearchResult['strategy']): string {
  return strategy === 'like'
    ? '띄어쓰기까지 그대로 있는 절을 찾습니다'
    : '낱말 단위로 찾습니다 (여러 낱말은 모두 들어 있는 절)';
}

export function BibleSearch({ translation, onPick }: Props): React.JSX.Element {
  const [term, setTerm] = useState('');
  const [scope, setScope] = useState<Testament | 'all'>('all');
  const [result, setResult] = useState<SearchResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** 방금 참조 칸으로 보낸 절 — 목록에서 어디까지 봤는지 잃지 않게 표시만 한다 */
  const [picked, setPicked] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const translationId = translation?.id;

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  /**
   * 역본·범위를 바꾸면 이전 결과를 **먼저 지운다.**
   *
   * 안 지우면 새 결과가 오기까지 200여 ms 동안 옛 결과가 새 이름 아래 남는다 —
   * 헬라어에서 개역개정으로 바꾼 순간 '개역개정 · 291절' 아래 헬라어 절이 깔린다
   * (2026-09-03 실측). 검색어를 치는 동안에는 지우지 않는다. 한 글자마다 목록이
   * 비었다 차면 눈이 따라가지 못한다.
   */
  useEffect(() => {
    setResult(null);
  }, [translationId, scope]);

  useEffect(() => {
    const trimmed = term.trim();
    if (trimmed.length === 0 || translationId === undefined) {
      setResult(null);
      setError(null);
      setBusy(false);
      return;
    }

    setBusy(true);
    let cancelled = false;
    const timer = setTimeout(() => {
      void api
        .searchBible(trimmed, translationId, scope === 'all' ? undefined : scope, HIT_LIMIT)
        .then((found) => {
          if (cancelled) return;
          setResult(found);
          setError(null);
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          // 이전 결과를 남겨 두면 방금 친 검색어의 결과로 잘못 읽는다
          setResult(null);
          setError(err instanceof ApiError ? err.message : '찾지 못했습니다');
        })
        .finally(() => {
          if (!cancelled) setBusy(false);
        });
    }, DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [term, scope, translationId]);

  /** 이 역본에 없는 범위는 고를 수 없게 한다 (헬라어=신약만, 히브리어=구약만) */
  const coverage = translation?.coverage ?? ['OT', 'NT'];

  /**
   * 역본을 바꿨는데 고른 범위가 그 역본에 없으면 '전체' 로 되돌린다.
   *
   * 없으면 막다른 골목이 된다 — '구약' 을 골라 둔 채 헬라어로 바꾸면 그 버튼이
   * **켜진 채 꺼져(disabled)** 눌러서 풀 수도 없고, 결과는 늘 0 이라 헬라어에 그
   * 낱말이 없는 것으로 읽힌다 (2026-09-03 실측).
   */
  useEffect(() => {
    if (scope !== 'all' && !coverage.includes(scope)) setScope('all');
  }, [scope, coverage.join(',')]);

  return (
    <div className="bible-search">
      <div className="row">
        <input
          ref={inputRef}
          className="grow"
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          placeholder={translation ? `${translation.name} 에서 찾을 낱말` : '낱말'}
          autoComplete="off"
          spellCheck={false}
          aria-label="찾을 낱말"
        />
        <span className="candidates">
          {SCOPES.map((option) => {
            const unavailable = option.value !== 'all' && !coverage.includes(option.value);
            return (
              <button
                key={option.value}
                type="button"
                className={scope === option.value ? 'primary' : undefined}
                disabled={unavailable}
                title={unavailable ? `${translation?.name} 에는 ${option.label}이 없습니다` : undefined}
                onClick={() => setScope(option.value)}
              >
                {option.label}
              </button>
            );
          })}
        </span>
      </div>

      {error && <p className="hintline error">{error}</p>}

      {!error && term.trim().length === 0 && (
        <p className="hintline muted">
          예: 사랑 · 은혜 · 여호와 · love your neighbor — 누르면 <b>위 참조 칸</b>에 들어갑니다.
        </p>
      )}

      {!error && result && result.hits.length === 0 && (
        <p className="hintline muted">
          <b>찾은 절이 없습니다.</b> {strategyHint(result.strategy)}.
        </p>
      )}

      {!error && result && result.hits.length > 0 && (
        <>
          <p className="hintline muted">
            {translation?.name} ·{' '}
            {result.truncated ? (
              <>
                <b>{result.total.toLocaleString()}절</b> 중 {result.hits.length}절 — 낱말을 늘리면 좁혀집니다
              </>
            ) : (
              <>
                <b>{result.total.toLocaleString()}절</b>
              </>
            )}
            {busy && ' · 찾는 중…'}
          </p>

          <div className="search-hits">
            {result.hits.map((hit) => (
              <button
                key={`${hit.book}-${hit.chapter}-${hit.verse}`}
                type="button"
                className={`search-hit${picked === hit.reference ? ' picked' : ''}`}
                onClick={() => {
                  setPicked(hit.reference);
                  onPick(hit.reference);
                }}
                title={`'${hit.reference}' 를 참조 칸에 넣습니다`}
              >
                <span className="ref">{hit.reference}</span>
                <span className="text">
                  {highlightParts(hit.text, result.term, result.strategy).map((part, index) =>
                    part.hit ? <mark key={index}>{part.text}</mark> : <span key={index}>{part.text}</span>,
                  )}
                </span>
              </button>
            ))}
          </div>
        </>
      )}

      {!error && !result && busy && <p className="hintline muted">찾는 중…</p>}
    </div>
  );
}
