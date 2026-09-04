import { useCallback, useEffect, useRef, useState } from 'react';

import { BibleSearch } from '../components/BibleSearch.tsx';
import { OutputStyleBar, type OutputStyle } from '../components/OutputStyleBar.tsx';
import { paginateByMeasure } from '../../../lib/paginator.ts';
import type { ClientMsg, Deck, ParseResult, Template, Translation } from '../../../shared/types.ts';
import { api, ApiError, type PassageResponse } from '../api.ts';
import { SlideList } from '../components/SlideList.tsx';
import { useMeasure } from '../hooks/useMeasure.ts';

const PAGING_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'verse', label: '1절씩' },
  // '자동'은 실제 출력 페이지를 1920×1080 으로 재서 넘치기 직전까지 담는다
  { value: 'auto', label: '자동 (화면에 맞춰)' },
  { value: 'pair', label: '2절씩' },
  { value: 'all', label: '구간 전체' },
];

const MAX_SECONDARY = 2;

/** 슬라이드 라벨 — lib/slide-builder 의 describeSlide 와 같은 규칙 */
function describeSlideLabel(slide: { kind: string; blocks?: Array<{ verses: Array<{ chapter: number; verse: number }> }> }): string {
  if (slide.kind !== 'bible' || !slide.blocks) return '';
  const primary = slide.blocks.find((b) => b.verses.length > 0);
  if (!primary || primary.verses.length === 0) return '';
  const first = primary.verses[0]!;
  const last = primary.verses[primary.verses.length - 1]!;
  if (first.chapter === last.chapter) {
    return first.verse === last.verse ? `${first.chapter}:${first.verse}` : `${first.chapter}:${first.verse}-${last.verse}`;
  }
  return `${first.chapter}:${first.verse}-${last.chapter}:${last.verse}`;
}

interface Props {
  translations: Translation[];
  defaultTranslation: string;
  deck: Deck | null;
  currentIndex: number;
  connected: boolean;
  /** 자동 분할이 현재 템플릿 기준으로 재도록 넘긴다 */
  template: Template | null;
  send: (msg: ClientMsg) => boolean;
}

/** 파싱 결과를 한 줄 안내로 바꾼다 */
function parseHint(parse: ParseResult | null, pending: boolean): { text: string; tone: string } {
  if (pending) return { text: '확인 중…', tone: 'muted' };
  if (!parse) return { text: '예: 요 3:16 · 시 23 · 롬 8:28-30 · 마 5:3-12; 6:9-13', tone: 'muted' };
  if (parse.ok) return { text: parse.reference, tone: 'ok' };
  return { text: parse.message, tone: 'error' };
}

export function BiblePanel({
  translations,
  defaultTranslation,
  deck,
  currentIndex,
  connected,
  template,
  send,
}: Props): React.JSX.Element {
  const [input, setInput] = useState('');
  const [parse, setParse] = useState<ParseResult | null>(null);
  const [parsePending, setParsePending] = useState(false);
  const [primary, setPrimary] = useState(defaultTranslation);
  const [secondary, setSecondary] = useState<string[]>([]);
  // 기본은 '1절씩'. 자동은 화면을 채우려고 여러 절을 묶는데, 설교 본문은 한 절씩
  // 짚어 가며 읽는 경우가 많아 절 단위가 예측 가능하다.
  const [paging, setPaging] = useState('verse');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  /** 이 탭에서 띄울 때 쓸 프리셋·폰트 — 고르지 않으면 지금 템플릿 그대로 */
  const [outputStyle, setOutputStyle] = useState<OutputStyle>({});
  /**
   * 낱말 찾기를 펼쳤는가.
   *
   * 기본은 접힘 — 예배 진행 중에는 참조를 바로 치는 것이 거의 전부다. 대신 버튼을
   * **늘 보이게** 둔다. 이 기능이 없던 것이 아니라 들어갈 문이 없었다 (§4.6 U-1).
   */
  const [searchOpen, setSearchOpen] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const measurer = useMeasure();

  // 입력할 때마다 파싱만 미리 확인한다 (본문 조회는 하지 않는다 — 가볍게 유지)
  useEffect(() => {
    const trimmed = input.trim();
    if (trimmed.length === 0) {
      setParse(null);
      setParsePending(false);
      return;
    }

    setParsePending(true);
    const timer = setTimeout(() => {
      api
        .parse(trimmed)
        .then((result) => setParse(result))
        .catch(() => setParse(null))
        .finally(() => setParsePending(false));
    }, 180);

    return () => clearTimeout(timer);
  }, [input]);

  const translationIds = [primary, ...secondary];

  const load = useCallback(
    async (ref: string) => {
      const trimmed = ref.trim();
      if (trimmed.length === 0) return;

      setLoading(true);
      setError(null);
      setNotice(null);

      try {
        const result: PassageResponse = await api.passage(trimmed, translationIds, paging);

        if (!result.parse.ok) {
          setParse(result.parse);
          setError(result.parse.message);
          return;
        }

        if (!result.deck || result.deck.slides.length === 0) {
          setError(`${result.parse.reference} 의 본문을 찾지 못했습니다`);
          return;
        }

        let deckToSend = result.deck;

        // 자동 모드: 서버가 만든 고정 분할을 버리고 실측으로 다시 나눈다
        if (paging === 'auto' && result.passage) {
          const paginated = await paginateByMeasure(result.passage, (slide) =>
            measurer.measure(slide, template ?? undefined),
          );
          if (paginated.slides.length > 0) {
            deckToSend = {
              reference: result.passage.referenceAbbr,
              slides: paginated.slides,
              labels: paginated.slides.map(describeSlideLabel),
              index: 0,
            };
          }
          if (paginated.overflowing > 0) {
            setNotice(
              `${paginated.overflowing}개 화면은 한 절만으로도 넘쳐 자동 축소로 표시됩니다. ` +
                `글자 크기를 줄이거나 여백을 늘려 보세요.`,
            );
          }
        }

        // 해당 역본에 없는 본문(헬라어로 구약 조회 등)을 조용히 넘기지 않고 알린다
        const unavailable = result.unavailableTranslations ?? [];
        if (unavailable.length > 0) {
          const names = unavailable
            .map((id) => translations.find((t) => t.id === id)?.name ?? id)
            .join(', ');
          setNotice(`${names} 에는 이 본문이 없어 표시되지 않습니다`);
        }

        /*
         * 템플릿을 **슬라이드보다 먼저** 올린다 — 순서가 반대면 옛 템플릿으로 한 번
         * 그려졌다가 바뀌어 화면이 튄다 (예배 순서 탭의 sendItem 과 같은 규칙).
         */
        if (outputStyle.templateId !== undefined) {
          send({ t: 'template:set', id: outputStyle.templateId });
        }

        const styled =
          outputStyle.style === undefined
            ? deckToSend
            : {
                ...deckToSend,
                slides: deckToSend.slides.map((slide) =>
                  slide.kind === 'bible' ? { ...slide, style: outputStyle.style } : slide,
                ),
              };

        send({ t: 'deck:load', payload: styled });
      } catch (err) {
        setError(err instanceof ApiError ? err.message : '본문을 불러오지 못했습니다');
      } finally {
        setLoading(false);
      }
    },
    [paging, send, translations, template, measurer, outputStyle, translationIds.join(',')],
  );

  const hint = parseHint(parse, parsePending);
  const candidates = parse && !parse.ok ? parse.candidates : [];

  function toggleSecondary(id: string): void {
    setSecondary((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= MAX_SECONDARY) return prev;
      return [...prev, id];
    });
  }

  return (
    <>
      {error && (
        <div className="banner error">
          <button type="button" className="close" onClick={() => setError(null)}>
            닫기
          </button>
          {error}
        </div>
      )}
      {notice && (
        <div className="banner warn">
          <button type="button" className="close" onClick={() => setNotice(null)}>
            닫기
          </button>
          {notice}
        </div>
      )}

      <div className="card">
        <h2>본문 조회</h2>
        <form
          className="row"
          onSubmit={(event) => {
            event.preventDefault();
            void load(input);
          }}
        >
          <input
            ref={inputRef}
            className="grow"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="요 3:16"
            autoComplete="off"
            spellCheck={false}
            aria-label="성경 참조"
          />
          <button type="submit" className="primary" disabled={!connected || loading || input.trim().length === 0}>
            {loading ? '불러오는 중…' : '송출'}
          </button>
        </form>

        <div className={`hintline ${hint.tone}`}>{hint.text}</div>

        {candidates.length > 0 && (
          <div className="candidates">
            {candidates.map((candidate) => (
              <button
                key={candidate.code}
                type="button"
                onClick={() => {
                  // 후보를 고르면 책 이름만 정식 명칭으로 바꿔 넣는다
                  const rest = input.trim().replace(/^\S+\s*/, '');
                  const nextInput = `${candidate.nameKo} ${rest}`.trim();
                  setInput(nextInput);
                  inputRef.current?.focus();
                }}
              >
                {candidate.nameKo}
              </button>
            ))}
          </div>
        )}

        {/*
          참조를 모를 때 들어가는 문. 같은 카드 안에 두는 이유는 둘 다 '본문을 찾는
          일' 이고, 찾은 절이 **바로 위 참조 칸**으로 들어가기 때문이다 — 결과와
          목적지가 떨어져 있으면 무엇이 일어났는지 눈으로 잇지 못한다.
        */}
        <div className="row search-toggle">
          <button
            type="button"
            className={searchOpen ? 'primary' : undefined}
            onClick={() => setSearchOpen((prev) => !prev)}
            title="참조를 모를 때 — 낱말이 들어간 절을 찾습니다"
          >
            🔍 낱말로 찾기
          </button>
          {!searchOpen && <span className="hintline muted">참조를 모를 때 — 예: 사랑 · 은혜 · love</span>}
        </div>

        {searchOpen && (
          <BibleSearch
            translation={translations.find((t) => t.id === primary)}
            onPick={(reference) => {
              setInput(reference);
              inputRef.current?.focus();
            }}
          />
        )}
      </div>

      <div className="card">
        <h2>역본</h2>
        <div className="row">
          <div className="field grow">
            <label htmlFor="primary-translation">주 역본</label>
            <select
              id="primary-translation"
              value={primary}
              onChange={(event) => {
                const next = event.target.value;
                setPrimary(next);
                setSecondary((prev) => prev.filter((id) => id !== next));
              }}
            >
              {translations.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label htmlFor="paging-mode">화면 넘김</label>
            <select id="paging-mode" value={paging} onChange={(event) => setPaging(event.target.value)}>
              {PAGING_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/*
          이 탭은 순서를 벗어나 급히 띄우는 자리다 — 설교 중 다른 본문을 찾을 때 쓴다.
          그때 화면 모양을 정할 길이 없었다(지금 활성 템플릿이 무엇이든 그대로 나갔다).
        */}
        <OutputStyleBar value={outputStyle} onChange={setOutputStyle} />

        <div className="field" style={{ marginTop: 12 }}>
          <label>보조 역본 (최대 {MAX_SECONDARY}개)</label>
          <div className="candidates">
            {translations
              .filter((t) => t.id !== primary)
              .map((t) => {
                const active = secondary.includes(t.id);
                return (
                  <button
                    key={t.id}
                    type="button"
                    className={active ? 'primary' : undefined}
                    onClick={() => toggleSecondary(t.id)}
                    disabled={!active && secondary.length >= MAX_SECONDARY}
                  >
                    {t.shortName}
                  </button>
                );
              })}
          </div>
        </div>
      </div>

      <div className="card">
        <h2>슬라이드 {deck ? `— ${deck.reference}` : ''}</h2>
        <SlideList
          deck={deck}
          currentIndex={currentIndex}
          disabled={!connected}
          onSelect={(index) => send({ t: 'goto', index })}
        />
      </div>
    </>
  );
}
