/**
 * 예배 순서 — 실제 예배를 진행하는 화면.
 *
 * 설계 근거는 docs/plan-service-tab.md 에 있다. 요약하면:
 *
 *  - **한 화면에서 전부**. 성경·찬양 검색과 광고 입력을 이 탭 안에서 한다.
 *    성경/찬양 탭을 오가며 준비하는 것은 예배 중에 너무 느리다.
 *  - **선택과 송출을 분리**한다. 항목을 눌러도 화면에 나가지 않는다.
 *    파란 테두리 = 보고 있는 것, 빨간 점 = 실제로 나가고 있는 것.
 *    눌렀다고 바로 나가면 예배 중 사고가 난다.
 *  - **조밀한 목록**. 성경·찬양 탭의 큰 카드가 아니라 한 줄짜리 행이다.
 *    10항목이 한 화면에 들어와야 진행이 보인다.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { buildPlanDeck, describeItem, moveItem, newItemId, removeItem } from '../../../lib/plan-deck.ts';
import { paginateByMeasure } from '../../../lib/paginator.ts';
import type { ClientMsg, CueItem, Deck, ServicePlan, SlidePayload, Template } from '../../../shared/types.ts';
import { api, ApiError } from '../api.ts';
import { useMeasure } from '../hooks/useMeasure.ts';

interface Props {
  deck: Deck | null;
  currentIndex: number;
  connected: boolean;
  template: Template | null;
  send: (msg: ClientMsg) => boolean;
}

/** 추가 바에서 고를 수 있는 항목 종류 */
type AddKind = 'bible' | 'song' | 'order' | 'notice' | 'quote' | 'blank' | 'divider';

const ADD_KINDS: ReadonlyArray<{ kind: AddKind; icon: string; label: string; hint: string }> = [
  { kind: 'bible', icon: '📖', label: '성경', hint: '요 3:16 · 시 23 · 롬 8:28-30' },
  { kind: 'song', icon: '🎵', label: '찬양', hint: '새 305 · 나 같은 죄인 · 은혜' },
  { kind: 'order', icon: '📋', label: '순서 표시', hint: '대표기도 · 설교 제목(둘째 줄에 설교자)' },
  { kind: 'notice', icon: '📝', label: '광고', hint: '여러 줄로 쓰면 그대로 나갑니다' },
  { kind: 'quote', icon: '💬', label: '인용구', hint: '설교 중 잠깐 띄울 내용' },
  { kind: 'blank', icon: '⬛', label: '공백', hint: '화면을 비웁니다' },
  { kind: 'divider', icon: '▾', label: '구분', hint: '예배 부름 · 찬양 · 말씀 …' },
];

/**
 * 순서 표시의 빠른 선택 — 매주 같은 이름을 다시 타이핑하지 않게 한다.
 *
 * 예배 순서 이름은 교회마다 다르므로 **고정 목록이 아니라 시작점**이다.
 * 여기 없는 순서는 입력창에 직접 쓴다.
 */
const ORDER_PRESETS = [
  '예배 부름',
  '대표기도',
  '주기도문',
  '사도신경',
  '성경 봉독',
  '봉헌',
  '성찬',
  '설교 제목',
  '광고',
  '축도',
] as const;

const ITEM_ICONS: Record<CueItem['type'], string> = {
  bible: '📖',
  song: '🎵',
  text: '📝',
  blank: '⬛',
  divider: '▾',
};

/** 새 순서표의 기본 구조 — 빈 화면은 무엇을 할 수 있는지 알려 주지 못한다 */
const DEFAULT_GROUPS = ['예배 부름', '찬양', '말씀', '광고'];

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function itemIcon(item: CueItem): string {
  if (item.type === 'text') {
    if (item.variant === 'quote') return '💬';
    if (item.variant === 'order') return '📋';
    return '📝';
  }
  return ITEM_ICONS[item.type];
}

function textVariantLabel(variant: 'notice' | 'quote' | 'order' | undefined): string {
  if (variant === 'quote') return '인용구';
  if (variant === 'order') return '순서 표시';
  return '광고';
}

/** 항목의 부가 설명 — 한 줄에 들어가야 하므로 짧게 */
function itemMeta(item: CueItem): string {
  switch (item.type) {
    case 'bible':
      return item.secondary.length > 0 ? `${item.primary} +${item.secondary.length}` : item.primary;
    case 'song':
      return `${item.langs.join('/')} · ${item.lines ?? 2}줄씩`;
    case 'text': {
      const label = textVariantLabel(item.variant);
      // 순서 표시는 둘째 줄(설교자 등)이 있으면 함께 보여 준다
      const rest = item.content.split(/\r?\n/).slice(1).join(' ').trim();
      return rest ? `${label} · ${rest}` : label;
    }
    default:
      return '';
  }
}

export function PlanPanel({ deck, currentIndex, connected, template, send }: Props): React.JSX.Element {
  const [plans, setPlans] = useState<ServicePlan[]>([]);
  const [plan, setPlan] = useState<ServicePlan | null>(null);
  const [items, setItems] = useState<CueItem[]>([]);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  /** 선택(커서) — 화면에 나가지 않는다 */
  const [cursor, setCursor] = useState(0);
  const [focus, setFocus] = useState<'list' | 'slides'>('list');

  /** 선택한 항목을 미리 푼 결과 (우측에 보여 준다) */
  const [preview, setPreview] = useState<{ slides: SlidePayload[]; labels: string[] } | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [slideCursor, setSlideCursor] = useState(0);

  /** 인용구를 띄우기 직전 화면 — '직전으로' 가 여기로 되돌린다 */
  const [before, setBefore] = useState<{ slide: SlidePayload; label: string } | null>(null);

  /**
   * 단독으로 송출한 항목 — 빨간 점을 켜기 위해 기억한다.
   *
   * 전체 덱을 올린 경우는 `deck.groups` 로 판정할 수 있지만, 항목 하나만 올리면
   * groups 가 없어 무엇이 나가는지 알 수 없다. 지금 뭐가 나가는지 모르는 것이
   * 예배 중에는 가장 위험하다.
   */
  const [liveItemId, setLiveItemId] = useState<string | null>(null);

  // 추가 바
  const [addKind, setAddKind] = useState<AddKind>('bible');
  const [addInput, setAddInput] = useState('');
  const [songHits, setSongHits] = useState<Array<{ id: number; title: string; label?: string }>>([]);
  const [parseOk, setParseOk] = useState<{ ok: boolean; text: string } | null>(null);

  const listRef = useRef<HTMLDivElement>(null);
  const addRef = useRef<HTMLTextAreaElement & HTMLInputElement>(null);
  const measurer = useMeasure();

  const current = items[cursor];
  const maxChars = template?.behavior.maxCharsPerLine;

  // ── 순서표 읽기·저장 ────────────────────────────────────────

  const reload = useCallback(async () => {
    try {
      setPlans(await api.plans());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '예배 순서를 불러오지 못했습니다');
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  function openPlan(target: ServicePlan): void {
    setPlan(target);
    setItems(target.items);
    setDirty(false);
    setCursor(0);
    setNotice(null);
  }

  async function createPlan(): Promise<void> {
    setBusy(true);
    try {
      // 기본 그룹을 넣어 둔다 — 필요 없으면 한 줄씩 지우면 된다
      const starter: CueItem[] = DEFAULT_GROUPS.map((label) => ({ id: newItemId(), type: 'divider', label }));
      const created = await api.createPlan(`${today()} 예배`, today(), starter);
      await reload();
      openPlan(created.plan);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '만들지 못했습니다');
    } finally {
      setBusy(false);
    }
  }

  async function savePlan(): Promise<void> {
    if (!plan) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.updatePlan(plan.id, { name: plan.name, items });
      setPlan(result.plan);
      setItems(result.plan.items);
      setDirty(false);
      await reload();
      setNotice(
        result.rejected && result.rejected.length > 0
          ? `저장했지만 ${result.rejected.length}개 항목을 버렸습니다: ${result.rejected.join(', ')}`
          : '저장했습니다',
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '저장하지 못했습니다');
    } finally {
      setBusy(false);
    }
  }

  function patchItems(next: CueItem[]): void {
    setItems(next);
    setDirty(true);
  }

  // ── 항목을 슬라이드로 푼다 (선택했을 때 미리보기용) ──────────

  const resolveItem = useCallback(
    async (item: CueItem): Promise<{ slides: SlidePayload[]; labels: string[]; error?: string }> => {
      if (item.type === 'bible') {
        const passage = await api.passage(item.ref, [item.primary, ...item.secondary], item.paging ?? 'verse');
        if (!passage.parse.ok) return { slides: [], labels: [], error: passage.parse.message };
        if (!passage.passage || !passage.deck) return { slides: [], labels: [], error: '본문을 찾지 못했습니다' };

        if ((item.paging ?? 'verse') === 'auto') {
          const paginated = await paginateByMeasure(passage.passage, (slide) =>
            measurer.measure(slide, template ?? undefined),
          );
          if (paginated.slides.length > 0) {
            return { slides: paginated.slides, labels: paginated.slides.map((_, i) => `${i + 1}`) };
          }
        }
        return { slides: passage.deck.slides, labels: passage.deck.labels };
      }

      if (item.type === 'song') {
        const songDeck = await api.songDeck(item.songId, item.langs, item.lines ?? '2', undefined, maxChars);
        return { slides: songDeck.deck.slides, labels: songDeck.deck.labels };
      }

      if (item.type === 'text') {
        const lines = item.content.split(/\r?\n/).filter((line) => line.trim().length > 0);
        return { slides: [{ kind: 'text', lines }], labels: [textVariantLabel(item.variant)] };
      }

      if (item.type === 'blank') return { slides: [{ kind: 'blank' }], labels: ['공백'] };

      // 구분은 슬라이드가 없다 (buildPlanDeck 도 건너뛴다)
      return { slides: [], labels: [] };
    },
    [measurer, template, maxChars],
  );

  // 커서가 바뀌면 그 항목을 풀어 우측에 보여 준다. **송출하지 않는다.**
  useEffect(() => {
    if (!current || current.type === 'divider') {
      setPreview(null);
      setPreviewError(null);
      return;
    }

    let cancelled = false;
    setPreviewError(null);
    void resolveItem(current)
      .then((result) => {
        if (cancelled) return;
        setPreview({ slides: result.slides, labels: result.labels });
        setPreviewError(result.error ?? null);
        setSlideCursor(0);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        // 이전 항목의 슬라이드를 남겨 두면 오퍼레이터가 엉뚱한 것을 송출한다
        setPreview(null);
        setPreviewError(err instanceof ApiError ? err.message : '불러오지 못했습니다');
      });

    return () => {
      cancelled = true;
    };
  }, [current?.id, resolveItem]);

  // ── 송출 ────────────────────────────────────────────────────

  /** 지금 화면에 나가고 있는 슬라이드 (직전으로 되돌리기용) */
  const liveSlide = deck?.slides[currentIndex];
  const liveLabel = deck?.labels[currentIndex];

  /**
   * 항목을 송출한다.
   *
   * 전체 덱이 올라가 있고 이 항목의 경계를 찾을 수 있으면 **그 위치로 점프**한다.
   * 그러면 이후 화살표 진행이 순서표 전체를 따라간다.
   * 올라가 있지 않으면 **그 항목만 단독으로** 올린다 — 순서를 벗어나 급히 띄울 때.
   */
  const sendItem = useCallback(
    async (item: CueItem, slideIndex = 0) => {
      if (!connected || item.type === 'divider') return;

      // 인용구를 띄우기 전 화면을 기억한다
      if (item.type === 'text' && item.variant === 'quote' && liveSlide) {
        setBefore({ slide: liveSlide, label: liveLabel ?? '' });
      }

      const groupIndex = items.filter((i) => i.type !== 'divider').findIndex((i) => i.id === item.id);
      const group = deck?.groups?.[groupIndex];

      if (group && deck) {
        send({ t: 'goto', index: group.startIndex + slideIndex });
        setLiveItemId(null); // groups 로 판정한다
        return;
      }

      try {
        const resolved = await resolveItem(item);
        if (resolved.slides.length === 0) {
          setError(resolved.error ?? '표시할 내용이 없습니다');
          return;
        }
        send({
          t: 'deck:load',
          payload: {
            reference: describeItem(item),
            slides: resolved.slides,
            labels: resolved.labels,
            index: Math.min(slideIndex, resolved.slides.length - 1),
          },
        });
        setLiveItemId(item.id);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : '송출하지 못했습니다');
      }
    },
    [connected, items, deck, send, resolveItem, liveSlide, liveLabel],
  );

  /** 인용구를 띄우기 직전 화면으로 되돌린다 */
  const restoreBefore = useCallback(() => {
    if (!before || !connected) return;
    send({
      t: 'deck:load',
      payload: { reference: before.label || '직전', slides: [before.slide], labels: [before.label], index: 0 },
    });
    setBefore(null);
    setLiveItemId(null);
  }, [before, connected, send]);

  /** 순서표 전체를 하나의 덱으로 올린다 (순서대로 진행할 때) */
  async function loadForService(): Promise<void> {
    if (!plan || items.length === 0) return;
    setBusy(true);
    setError(null);
    setNotice(null);

    try {
      const result = await buildPlanDeck(plan.name, items, resolveItem);
      if (result.deck.slides.length === 0) {
        setError('올릴 수 있는 항목이 없습니다');
        return;
      }
      if (result.failed.length > 0) {
        setNotice(
          `${result.failed.length}개 항목을 건너뛰었습니다: ` +
            result.failed.map((f) => `${describeItem(f.item)} (${f.error})`).join(', '),
        );
      }
      send({ t: 'deck:load', payload: result.deck });
      setLiveItemId(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '순서표를 올리지 못했습니다');
    } finally {
      setBusy(false);
    }
  }

  // ── 항목 추가 ───────────────────────────────────────────────

  // 찬양 검색 (디바운스)
  useEffect(() => {
    if (addKind !== 'song' || addInput.trim().length === 0) {
      setSongHits([]);
      return;
    }
    const timer = setTimeout(() => {
      void api
        .songs(addInput, 8)
        .then((res) =>
          setSongHits(
            res.hits.map((hit) => ({
              id: hit.id,
              title: hit.title,
              label: hit.entries
                .filter((e) => e.number !== undefined)
                .map((e) => `${e.songbookShortLabel}${e.number}`)[0],
            })),
          ),
        )
        .catch(() => setSongHits([]));
    }, 200);
    return () => clearTimeout(timer);
  }, [addKind, addInput]);

  // 성경 참조 확인 (디바운스) — 맞는 본문인지 추가하기 전에 보여 준다
  useEffect(() => {
    if (addKind !== 'bible' || addInput.trim().length === 0) {
      setParseOk(null);
      return;
    }
    const timer = setTimeout(() => {
      void api
        .parse(addInput.trim())
        .then((result) => setParseOk({ ok: result.ok, text: result.ok ? result.reference : result.message }))
        .catch(() => setParseOk(null));
    }, 200);
    return () => clearTimeout(timer);
  }, [addKind, addInput]);

  /** 새 항목을 커서 **다음**에 넣는다 — 순서를 짜는 자연스러운 방향 */
  function insertItem(item: CueItem): void {
    const at = items.length === 0 ? 0 : cursor + 1;
    patchItems([...items.slice(0, at), item, ...items.slice(at)]);
    setCursor(at);
    setAddInput('');
    setSongHits([]);
    setParseOk(null);
  }

  function addFromInput(): void {
    const text = addInput.trim();

    if (addKind === 'blank') {
      insertItem({ id: newItemId(), type: 'blank' });
      return;
    }
    if (text.length === 0) return;

    if (addKind === 'bible') {
      if (parseOk && !parseOk.ok) return; // 참조가 틀리면 넣지 않는다
      insertItem({ id: newItemId(), type: 'bible', ref: text, primary: 'nkrv', secondary: [], paging: 'verse' });
      return;
    }
    if (addKind === 'divider') {
      insertItem({ id: newItemId(), type: 'divider', label: text });
      return;
    }
    if (addKind === 'notice' || addKind === 'quote' || addKind === 'order') {
      // 앞뒤 공백만 떼고 가운데 줄바꿈은 그대로 둔다 (여러 줄 광고를 한 항목으로)
      addText(text, addKind);
      return;
    }
    // 찬양은 검색 결과에서 고른다
    if (addKind === 'song' && songHits[0]) addSong(songHits[0].id, songHits[0].title);
  }

  /** 광고·인용구·순서 표시는 저장 구조가 같고 variant 만 다르다 */
  function addText(content: string, kind: 'notice' | 'quote' | 'order'): void {
    if (content.trim().length === 0) return;
    insertItem({
      id: newItemId(),
      type: 'text',
      content,
      ...(kind === 'notice' ? {} : { variant: kind }),
    });
  }

  function addSong(songId: number, songTitle: string): void {
    insertItem({ id: newItemId(), type: 'song', songId, songTitle, langs: ['ko'], lines: '2' });
  }

  // ── 키보드 ──────────────────────────────────────────────────

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;

      if (event.key === 'Tab') {
        event.preventDefault();
        setFocus((prev) => (prev === 'list' ? 'slides' : 'list'));
        return;
      }

      if (focus === 'list') {
        if (event.key === 'ArrowDown' || event.key === 'j') {
          event.preventDefault();
          setCursor((prev) => Math.min(prev + 1, items.length - 1));
        } else if (event.key === 'ArrowUp' || event.key === 'k') {
          event.preventDefault();
          setCursor((prev) => Math.max(prev - 1, 0));
        } else if (event.key === 'Enter' && current) {
          event.preventDefault();
          void sendItem(current);
        }
        // ←→ 는 가로채지 않는다 — 전역(슬라이드 이동)이 처리한다
        return;
      }

      // 슬라이드 영역 포커스
      const total = preview?.slides.length ?? 0;
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        setSlideCursor((prev) => Math.min(prev + 1, Math.max(0, total - 1)));
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        setSlideCursor((prev) => Math.max(prev - 1, 0));
      } else if (event.key === 'Enter' && current) {
        event.preventDefault();
        void sendItem(current, slideCursor);
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [focus, items.length, current, preview, slideCursor, sendItem]);

  // 커서가 화면 밖으로 나가지 않게
  useEffect(() => {
    listRef.current?.querySelector('.cue-row.current')?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  // ── 렌더 ────────────────────────────────────────────────────

  /** 이 항목이 지금 송출 중인지 */
  const liveItemIndex = (() => {
    // 항목 하나만 올린 경우 — groups 가 없어 기억해 둔 id 로 판정한다
    if (liveItemId) {
      const index = items.findIndex((item) => item.id === liveItemId);
      if (index >= 0) return index;
    }
    if (!deck?.groups || currentIndex < 0) return -1;
    let found = -1;
    deck.groups.forEach((group, index) => {
      if (group.startIndex <= currentIndex) found = index;
    });
    if (found === -1) return -1;
    // groups 는 divider 를 뺀 순서라 원래 배열 위치로 되돌린다
    const withoutDividers = items.filter((item) => item.type !== 'divider');
    const target = withoutDividers[found];
    return target ? items.findIndex((item) => item.id === target.id) : -1;
  })();

  const kindHint = ADD_KINDS.find((option) => option.kind === addKind)?.hint ?? '';
  // 순서 표시도 여러 줄이다 — '설교 제목' 아래 줄에 설교자를 넣는다
  const isMultiline = addKind === 'notice' || addKind === 'quote' || addKind === 'order';

  return (
    <div className="plan-panel">
      {error && (
        <div className="banner error">
          <button type="button" className="close" onClick={() => setError(null)}>닫기</button>
          {error}
        </div>
      )}
      {notice && (
        <div className="banner warn">
          <button type="button" className="close" onClick={() => setNotice(null)}>닫기</button>
          {notice}
        </div>
      )}

      <div className="plan-split">
        {/* ── 좌: 순서 목록 ── */}
        <div
          className={`card plan-list${focus === 'list' ? ' focused' : ''}`}
          onMouseDown={() => setFocus('list')}
        >
          <div className="plan-head">
            <select
              className="grow"
              value={plan?.id ?? ''}
              onChange={(e) => {
                const found = plans.find((p) => p.id === Number(e.target.value));
                if (found) openPlan(found);
              }}
            >
              <option value="">— 순서 선택 —</option>
              {plans.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.serviceDate ? `${p.serviceDate} · ` : ''}{p.name}
                </option>
              ))}
            </select>
            <button type="button" onClick={() => void createPlan()} disabled={busy} title="새 순서표">＋</button>
          </div>

          {plan && (
            <div className="plan-head">
              <button
                type="button"
                className="primary grow"
                onClick={() => void loadForService()}
                disabled={!connected || busy || items.length === 0}
                title="순서표 전체를 하나로 올립니다. 이후 화살표로 끝까지 진행합니다."
              >
                예배용으로 올리기
              </button>
              <button type="button" onClick={() => void savePlan()} disabled={busy || !dirty}>
                {dirty ? '저장' : '저장됨'}
              </button>
            </div>
          )}

          {!plan && <p className="hintline muted">순서를 고르거나 ＋ 로 새로 만드세요.</p>}

          {plan && (
            <div className="cue-list" ref={listRef}>
              {items.length === 0 && <p className="hintline muted">아래에서 항목을 추가하세요.</p>}

              {items.map((item, index) => {
                if (item.type === 'divider') {
                  return (
                    <div
                      key={item.id}
                      className={`cue-divider${index === cursor ? ' current' : ''}`}
                      onClick={() => setCursor(index)}
                    >
                      <span className="label">{item.label}</span>
                      <span className="actions">
                        <button type="button" onClick={() => patchItems(removeItem(items, item.id))} title="삭제">✕</button>
                      </span>
                    </div>
                  );
                }

                const isLive = index === liveItemIndex;
                return (
                  <div
                    key={item.id}
                    className={`cue-row${index === cursor ? ' current' : ''}${isLive ? ' live' : ''}`}
                    onClick={() => setCursor(index)}
                  >
                    <span className="live-dot" title={isLive ? '송출 중' : undefined} />
                    <span className="icon">{itemIcon(item)}</span>
                    <span className="body">
                      <span className="title">{describeItem(item)}</span>
                      <span className="meta">{itemMeta(item)}</span>
                    </span>
                    <span className="actions">
                      <button
                        type="button"
                        className="go"
                        onClick={(e) => { e.stopPropagation(); void sendItem(item); }}
                        disabled={!connected}
                        title="바로 송출"
                      >
                        ▶
                      </button>
                      <button type="button" onClick={(e) => { e.stopPropagation(); patchItems(moveItem(items, index, index - 1)); }} disabled={index === 0} title="위로">↑</button>
                      <button type="button" onClick={(e) => { e.stopPropagation(); patchItems(moveItem(items, index, index + 1)); }} disabled={index === items.length - 1} title="아래로">↓</button>
                      <button type="button" onClick={(e) => { e.stopPropagation(); patchItems(removeItem(items, item.id)); }} title="삭제">✕</button>
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          {plan && (
            <div className="add-bar">
              <div className="kind-row">
                {ADD_KINDS.map((option) => (
                  <button
                    key={option.kind}
                    type="button"
                    className={`kind${addKind === option.kind ? ' active' : ''}`}
                    onClick={() => { setAddKind(option.kind); addRef.current?.focus(); }}
                    title={option.label}
                  >
                    {option.icon}
                  </button>
                ))}
              </div>

              {addKind === 'blank' ? (
                <button type="button" className="grow" onClick={() => addFromInput()}>공백 추가</button>
              ) : isMultiline ? (
                <textarea
                  ref={addRef}
                  rows={2}
                  value={addInput}
                  onChange={(e) => setAddInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key !== 'Enter') return;
                    // Enter = 항목 추가(성경·찬양과 같은 동작). 줄바꿈은 Shift+Enter.
                    //
                    // 이전에는 ⌘Enter 만 추가라서, 광고를 입력하고 Enter 를 눌러도
                    // 줄만 바뀌고 아무것도 추가되지 않았다. 광고는 한 줄짜리 항목을
                    // 여러 개 넣는 경우가 대부분이라 Enter 를 추가로 둔다.
                    if (e.shiftKey) return;
                    e.preventDefault();
                    addFromInput();
                  }}
                  placeholder={kindHint}
                  spellCheck={false}
                />
              ) : (
                <input
                  ref={addRef}
                  value={addInput}
                  onChange={(e) => setAddInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key !== 'Enter') return;
                    e.preventDefault();
                    addFromInput();
                  }}
                  placeholder={kindHint}
                  autoComplete="off"
                  spellCheck={false}
                />
              )}

              {addKind === 'bible' && parseOk && (
                <p className={`hintline ${parseOk.ok ? 'ok' : 'error'}`}>{parseOk.text}</p>
              )}
              {isMultiline && <p className="hintline muted">Enter 로 추가 · Shift+Enter 줄바꿈</p>}

              {addKind === 'order' && (
                <div className="candidates">
                  {ORDER_PRESETS.map((preset) => (
                    <button key={preset} type="button" onClick={() => addText(preset, 'order')}>
                      {preset}
                    </button>
                  ))}
                </div>
              )}

              {addKind === 'song' && songHits.length > 0 && (
                <div className="candidates">
                  {songHits.map((hit) => (
                    <button key={hit.id} type="button" onClick={() => addSong(hit.id, hit.title)}>
                      {hit.label ? `${hit.label} ` : ''}{hit.title}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── 우: 선택한 항목의 슬라이드 ── */}
        <div
          className={`card plan-detail${focus === 'slides' ? ' focused' : ''}`}
          onMouseDown={() => setFocus('slides')}
        >
          {!current && <p className="hintline muted">왼쪽에서 항목을 고르세요.</p>}

          {current && current.type === 'divider' && (
            <p className="hintline muted">구분선입니다 — 화면에 나가지 않습니다.</p>
          )}

          {current && current.type !== 'divider' && (
            <>
              <h2 className="plan-detail-title">
                <span className="icon">{itemIcon(current)}</span>
                {describeItem(current)}
                {liveItemIndex === cursor && <span className="live-tag">송출 중</span>}
              </h2>

              {previewError && <p className="hintline error">{previewError}</p>}

              {before && (
                <div className="row" style={{ marginBottom: 8 }}>
                  <button type="button" onClick={restoreBefore} disabled={!connected}>
                    ↩ 직전으로 ({before.label || '이전 화면'})
                  </button>
                </div>
              )}

              <div className="cue-slides">
                {preview?.slides.map((slide, index) => (
                  <button
                    key={index}
                    type="button"
                    className={`cue-slide${index === slideCursor ? ' current' : ''}`}
                    onClick={() => { setSlideCursor(index); void sendItem(current, index); }}
                    title="눌러서 송출"
                  >
                    <span className="num">{preview.labels[index] || index + 1}</span>
                    <span className="text">
                      {slide.kind === 'song'
                        ? slide.lines.map((group, gi) => (
                            <span key={gi} className="line">{group.map((line) => line.text).join(' / ')}</span>
                          ))
                        : slide.kind === 'text'
                          ? slide.lines.map((line, li) => <span key={li} className="line">{line}</span>)
                          : slide.kind === 'bible'
                            ? slide.blocks.map((block, bi) => (
                                <span key={bi} className="line">
                                  {block.verses.map((verse) => verse.text).join(' ')}
                                </span>
                              ))
                            : <span className="line muted">(공백)</span>}
                    </span>
                  </button>
                ))}
              </div>

              {/* 항목별 설정 — 여기서 바로 고친다 */}
              {current.type === 'song' && (
                <div className="row detail-controls">
                  <label>화면 넘김</label>
                  <select
                    value={current.lines ?? '2'}
                    onChange={(e) =>
                      patchItems(items.map((i) => (i.id === current.id ? { ...i, lines: e.target.value } : i)))
                    }
                  >
                    <option value="1">1줄씩</option>
                    <option value="2">2줄씩</option>
                    <option value="4">4줄씩</option>
                    <option value="section">섹션 전체</option>
                  </select>
                </div>
              )}

              {current.type === 'bible' && (
                <div className="row detail-controls">
                  <label>화면 넘김</label>
                  <select
                    value={current.paging ?? 'verse'}
                    onChange={(e) =>
                      patchItems(items.map((i) => (i.id === current.id ? { ...i, paging: e.target.value } : i)))
                    }
                  >
                    <option value="verse">1절씩</option>
                    <option value="auto">자동 (화면에 맞춰)</option>
                    <option value="pair">2절씩</option>
                    <option value="all">구간 전체</option>
                  </select>
                </div>
              )}

              {current.type === 'text' && (
                <textarea
                  className="detail-text"
                  rows={4}
                  value={current.content}
                  onChange={(e) =>
                    patchItems(items.map((i) => (i.id === current.id ? { ...i, content: e.target.value } : i)))
                  }
                  spellCheck={false}
                />
              )}
            </>
          )}
        </div>
      </div>

      <p className="hintline muted plan-keys">
        <b>Tab</b> 영역 이동 · <b>↑↓</b> 항목 · <b>←→</b> 슬라이드 · <b>Enter</b> 송출 ·
        <b> Space</b> 다음 · <b>B</b> 블랙 · <b>Esc</b> 복구
      </p>
    </div>
  );
}
