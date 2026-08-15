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

import {
  buildPlanDeck, buildPlanRows, describeItem, isExpandable, itemsInGroup, moveItem, newItemId,
  removeItem, splitOrderText, type PlanRow,
} from '../../../lib/plan-deck.ts';
import { paginateByMeasure } from '../../../lib/paginator.ts';
import {
  AUTO_HOLD_MS_DEFAULT,
  type ClientMsg, type CueItem, type Deck, type PlanKind, type ServicePlan,
  type SlidePayload, type Template,
} from '../../../shared/types.ts';
import { api, ApiError } from '../api.ts';
import { isComposing } from '../ime.ts';
import { PRESENTER_SCALE_MAX, PRESENTER_SCALE_MIN, STROKE_MIN } from '../../../lib/order-rhythm.ts';
import { OrderCharTuner } from '../components/OrderCharTuner.tsx';
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

/** 슬라이드 줄에 보여 줄 한 줄 요약 — 목록이 조밀해야 진행이 보인다 */
function slideSummary(slide: SlidePayload): string {
  switch (slide.kind) {
    case 'song':
      return slide.lines.map((group) => group.map((line) => line.text).join(' / ')).join(' · ');
    case 'text':
      return slide.lines.join(' · ');
    case 'order':
      return slide.presenter ? `${slide.title} — ${slide.presenter}` : slide.title;
    case 'bible':
      return slide.blocks
        .flatMap((block) => block.verses.map((verse) => verse.text))
        .join(' ');
    default:
      return '(공백)';
  }
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
  /** 예배 유형(주일예배·수요예배 …) — 매주 고쳐 쓰는 원본 */
  const [templates, setTemplates] = useState<ServicePlan[]>([]);
  /** 저장해 둔 회차 — 지난주 순서를 다시 열 때 */
  const [saved, setSaved] = useState<ServicePlan[]>([]);
  /** 지금 편집 중인 것이 어디서 왔는지 */
  const [plan, setPlan] = useState<ServicePlan | null>(null);
  const [items, setItems] = useState<CueItem[]>([]);

  /** 이름을 받아야 하는 저장 동작 (유형 만들기 / 순서 저장하기) */
  const [nameBar, setNameBar] = useState<{ kind: PlanKind; value: string } | null>(null);
  const [loadOpen, setLoadOpen] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  /**
   * 선택(커서) — **줄** 번호다. 펼친 슬라이드도 한 줄로 센다.
   *
   * 항목 번호가 아니라 줄 번호인 이유는 3차 재설계에서 오른쪽 열을 없애고
   * 슬라이드를 목록 안으로 넣었기 때문이다(docs/plan-service-tab-3.md).
   */
  const [cursor, setCursor] = useState(0);

  /** 펼친 항목 — 한 번에 하나만. 여러 개가 열리면 목록이 길어져 진행이 안 보인다. */
  const [expandedId, setExpandedId] = useState<string | null>(null);

  /** 펼친 항목을 푼 결과 */
  const [preview, setPreview] = useState<{ slides: SlidePayload[]; labels: string[] } | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  /** 항목마다 지정할 수 있는 **표시 템플릿** 목록 (예배 유형 templates 와 다른 것) */
  const [styleTemplates, setStyleTemplates] = useState<Template[]>([]);

  /** 인용구를 띄우기 직전 화면 — '직전으로' 가 여기로 되돌린다 */
  const [before, setBefore] = useState<{ slide: SlidePayload; label: string } | null>(null);

  /**
   * 예배 전 안내 자동 진행 — 지금 돌고 있는 구분.
   *
   * 예배가 시작되면 반드시 멈춰야 하므로, 다른 항목을 송출하거나 순서표를 올리면
   * 곧바로 끈다. 돌고 있다는 것이 화면에 크게 보여야 한다.
   */
  const [auto, setAuto] = useState<{ dividerId: string; holdMs: number; loop: boolean } | null>(null);

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
  /** 종류 버튼을 눌러 입력창이 교체된 뒤에 포커스를 줘야 하는지 */
  const wantFocus = useRef(false);
  const measurer = useMeasure();

  const maxChars = template?.behavior.maxCharsPerLine;

  /** 화면에 그릴 줄 목록 — 펼친 항목의 슬라이드가 그 아래에 들어간다 */
  const rows = buildPlanRows(items, expandedId, preview?.slides.length ?? 0);
  const currentRow = rows[Math.min(cursor, rows.length - 1)];
  /** 커서가 가리키는 항목 (슬라이드 줄이면 그 슬라이드의 항목) */
  const current = currentRow ? items[currentRow.itemIndex] : undefined;

  // ── 순서표 읽기·저장 ────────────────────────────────────────

  const reload = useCallback(async () => {
    try {
      const [templateList, savedList] = await Promise.all([api.plans('template'), api.plans('plan')]);
      setTemplates(templateList);
      setSaved(savedList);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '예배 순서를 불러오지 못했습니다');
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  /**
   * 아무것도 열지 않았으면 첫 유형을 연다.
   *
   * 빈 화면에서 시작하면 매번 '무엇을 골라야 하는지' 부터 판단해야 한다.
   * 편집 중인 것이 있으면(=plan) 건드리지 않는다.
   */
  useEffect(() => {
    if (plan || templates.length === 0) return;
    const first = templates[0];
    if (first) {
      setPlan(first);
      setItems(first.items);
      setDirty(false);
      setCursor(0);
    }
  }, [templates, plan]);

  /** 편집 중인 변경을 잃는 자리에는 반드시 확인을 받는다 */
  function openPlan(target: ServicePlan): void {
    if (dirty && !window.confirm('저장하지 않은 변경이 있습니다. 그래도 여시겠습니까?')) return;
    setPlan(target);
    setItems(target.items);
    setDirty(false);
    setCursor(0);
    setNotice(null);
    setLoadOpen(false);
    setNameBar(null);
  }

  /** '템플릿 업데이트' — 지금 고친 내용을 이 유형의 원본으로 굳힌다 */
  async function updateTemplate(): Promise<void> {
    if (!plan || plan.kind !== 'template') return;
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
          ? `유형을 갱신했지만 ${result.rejected.length}개 항목을 버렸습니다: ${result.rejected.join(', ')}`
          : `'${result.plan.name}' 유형을 갱신했습니다`,
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '갱신하지 못했습니다');
    } finally {
      setBusy(false);
    }
  }

  /** 같은 이름이 이미 있는지 — 있으면 버튼이 '덮어쓰기' 로 바뀐다 */
  const nameBarTarget = nameBar
    ? (nameBar.kind === 'template' ? templates : saved).find((p) => p.name === nameBar.value.trim())
    : undefined;

  /** 이름 입력 바 확정 — 새로 만들거나, 같은 이름이 있으면 덮어쓴다 */
  async function commitNameBar(): Promise<void> {
    if (!nameBar) return;
    const name = nameBar.value.trim();
    if (name.length === 0) return;

    setBusy(true);
    setError(null);
    try {
      // 빈 상태에서 유형을 만들면 뼈대를 넣어 준다 — 빈 목록은 무엇을 할 수 있는지 알려주지 못한다
      const payload: CueItem[] =
        items.length === 0 && nameBar.kind === 'template'
          ? DEFAULT_GROUPS.map((label) => ({ id: newItemId(), type: 'divider', label }))
          : items;

      const result = nameBarTarget
        ? await api.updatePlan(nameBarTarget.id, { name, items: payload })
        : (await api.createPlan(name, nameBar.kind === 'plan' ? today() : '', payload, nameBar.kind));

      setPlan(result.plan);
      setItems(result.plan.items);
      setDirty(false);
      setNameBar(null);
      await reload();
      setNotice(
        `${nameBar.kind === 'template' ? '유형' : '순서'} '${name}' 을(를) ` +
          `${nameBarTarget ? '덮어썼습니다' : '저장했습니다'}`,
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '저장하지 못했습니다');
    } finally {
      setBusy(false);
    }
  }

  /** 저장된 순서 삭제 — 되돌릴 수 없으므로 확인을 받는다 */
  async function removeSaved(target: ServicePlan): Promise<void> {
    if (!window.confirm(`저장된 순서 '${target.name}' 을(를) 지웁니다. 되돌릴 수 없습니다.`)) return;
    try {
      await api.deletePlan(target.id);
      if (plan?.id === target.id) setPlan(null);
      await reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '지우지 못했습니다');
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
        // 순서 표시는 기본이 좌우 나누기 — 왼쪽 순서 이름, 오른쪽 담당자
        if (item.variant === 'order' && item.layout !== 'stack') {
          return {
            slides: [
              {
                kind: 'order',
                ...splitOrderText(item.content),
                ...(item.charStyles ? { charStyles: item.charStyles } : {}),
                ...(item.presenterScale !== undefined ? { presenterScale: item.presenterScale } : {}),
                ...(item.titleStroke !== undefined ? { titleStroke: item.titleStroke } : {}),
                ...(item.presenterStroke !== undefined ? { presenterStroke: item.presenterStroke } : {}),
              },
            ],
            labels: ['순서 표시'],
          };
        }
        const lines = item.content.split(/\r?\n/).filter((line) => line.trim().length > 0);
        return { slides: [{ kind: 'text', lines }], labels: [textVariantLabel(item.variant)] };
      }

      if (item.type === 'blank') return { slides: [{ kind: 'blank' }], labels: ['공백'] };

      // 구분은 슬라이드가 없다 (buildPlanDeck 도 건너뛴다)
      return { slides: [], labels: [] };
    },
    [measurer, template, maxChars],
  );

  // 펼친 항목을 풀어 슬라이드 줄로 보여 준다. **송출하지 않는다.**
  const expandedItem = items.find((item) => item.id === expandedId);
  useEffect(() => {
    if (!expandedItem) {
      setPreview(null);
      setPreviewError(null);
      return;
    }

    let cancelled = false;
    setPreviewError(null);
    void resolveItem(expandedItem)
      .then((result) => {
        if (cancelled) return;
        setPreview({ slides: result.slides, labels: result.labels });
        setPreviewError(result.error ?? null);
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
  }, [expandedItem?.id, resolveItem]);

  // 템플릿 목록 — 항목마다 지정할 수 있게 이름을 보여 준다
  useEffect(() => {
    void api
      .templates()
      .then(setStyleTemplates)
      .catch(() => setStyleTemplates([]));
  }, []);

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
      // 사람이 무언가를 송출하면 예배가 시작된 것이다 — 자동 진행을 끈다
      setAuto(null);

      // 인용구를 띄우기 전 화면을 기억한다
      if (item.type === 'text' && item.variant === 'quote' && liveSlide) {
        setBefore({ slide: liveSlide, label: liveLabel ?? '' });
      }

      // 항목에 지정된 템플릿이 있으면 **슬라이드보다 먼저** 올린다.
      // 순서가 반대면 옛 템플릿으로 한 번 그려졌다가 바뀌어 화면이 튄다.
      if ('templateId' in item && typeof item.templateId === 'number') {
        send({ t: 'template:set', id: item.templateId });
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

  /**
   * 예배 전 안내를 시작한다 — 이 구분이 거느린 항목만 덱으로 올리고 자동으로 넘긴다.
   *
   * 전체 순서표를 올리지 않는 이유는, 예배 전 안내가 **예배 순서의 일부가 아니라
   * 그 앞의 시간**이기 때문이다. 예배를 시작할 때는 '예배용으로 올리기' 를 새로 누른다.
   */
  async function startAuto(divider: Extract<CueItem, { type: 'divider' }>): Promise<void> {
    const group = itemsInGroup(items, divider.id);
    if (group.length === 0) {
      setError(`'${divider.label}' 아래에 항목이 없습니다`);
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const result = await buildPlanDeck(divider.label, group, resolveItem);
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
      setAuto({
        dividerId: divider.id,
        holdMs: divider.auto?.holdMs ?? AUTO_HOLD_MS_DEFAULT,
        loop: divider.auto?.loop !== false,
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '시작하지 못했습니다');
    } finally {
      setBusy(false);
    }
  }

  /**
   * 자동 진행 타이머.
   *
   * 슬라이드가 바뀔 때마다 **다음 한 번**만 예약한다. 반복 타이머를 쓰면
   * 사람이 중간에 손으로 넘겼을 때 남은 시간이 어긋나 두 장이 연달아 넘어간다.
   */
  useEffect(() => {
    if (!auto || !connected) return;
    const total = deck?.slides.length ?? 0;
    if (total === 0) return;

    const timer = setTimeout(() => {
      if (currentIndex >= total - 1) {
        // 예배 **전** 안내라 처음으로 돌아간다 (예배 중 덱은 순환하지 않는다)
        if (auto.loop) send({ t: 'goto', index: 0 });
        else setAuto(null);
      } else {
        send({ t: 'next' });
      }
    }, auto.holdMs);

    return () => clearTimeout(timer);
  }, [auto, connected, currentIndex, deck?.slides.length, send]);

  /** 순서표 전체를 하나의 덱으로 올린다 (순서대로 진행할 때) */
  async function loadForService(): Promise<void> {
    if (!plan || items.length === 0) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    // 예배가 시작된다 — 자동 진행을 끈다
    setAuto(null);

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

  /**
   * 추가 바의 종류를 고른다.
   *
   * 종류를 바꾸면 입력창 요소 자체가 바뀐다(한 줄 input ↔ 여러 줄 textarea).
   * 클릭 즉시 focus() 를 부르면 **교체되기 전의 옛 요소**를 잡아, 그 요소가
   * 사라지면서 포커스가 body 로 떨어진다. 그러면 이어서 친 글자가 입력창이 아니라
   * 전역 단축키로 들어가 커서가 움직이거나 Enter 로 송출이 나갈 수 있다.
   * 그래서 다시 그린 뒤(아래 effect)에 잡는다.
   */
  function pickKind(kind: AddKind): void {
    if (kind === addKind) {
      addRef.current?.focus(); // 요소가 그대로면 지금 잡아도 된다
      return;
    }
    wantFocus.current = true;
    setAddKind(kind);
  }

  useEffect(() => {
    if (!wantFocus.current) return;
    wantFocus.current = false;
    addRef.current?.focus();
  }, [addKind]);

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

  // ── 줄을 눌렀을 때 ──────────────────────────────────────────

  /**
   * **이 프로젝트의 핵심 규칙**: 화면에 나가는 것은 언제나 '슬라이드'다.
   *
   * - 슬라이드 줄 → 송출
   * - 여러 장짜리 항목(성경·찬양)의 머리 줄 → **펼치기만**. 화면은 그대로
   * - 한 장짜리 항목(광고·순서 표시·공백) → 그 줄이 곧 슬라이드이므로 송출
   * - 구분 → 아무것도 나가지 않는다
   *
   * 1차 재설계의 "항목을 눌러도 안 나간다"를 "슬라이드를 눌러야 나간다"로 다듬은 것이다
   * (docs/plan-service-tab-3.md). 한 장짜리는 항목과 슬라이드가 같은 것이라 헛걸음만 없앤다.
   */
  const activateRow = useCallback(
    (row: PlanRow | undefined) => {
      if (!row) return;
      const item = items[row.itemIndex];
      if (!item || item.type === 'divider') return;

      if (row.kind === 'slide') {
        void sendItem(item, row.slideIndex);
        return;
      }
      if (isExpandable(item)) {
        setExpandedId((prev) => (prev === item.id ? null : item.id));
        return;
      }
      void sendItem(item, 0);
    },
    [items, sendItem],
  );

  // ── 키보드 ──────────────────────────────────────────────────

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      // Tab 으로 펼치고 Shift+Tab 으로 접는다 (2026-08-15 사용자 결정).
      // ←→ 는 건드리지 않는다 — 송출 중인 덱을 움직이는 손에 익은 조작이다.
      if (event.key === 'Tab') {
        event.preventDefault();
        if (!currentRow) return;
        if (event.shiftKey) {
          setExpandedId(null);
          return;
        }
        const item = items[currentRow.itemIndex];
        if (item && isExpandable(item)) setExpandedId(item.id);
        return;
      }

      if (event.key === 'ArrowDown' || event.key === 'j') {
        event.preventDefault();
        setCursor((prev) => Math.min(prev + 1, rows.length - 1));
      } else if (event.key === 'ArrowUp' || event.key === 'k') {
        event.preventDefault();
        setCursor((prev) => Math.max(prev - 1, 0));
      } else if (event.key === 'Enter') {
        event.preventDefault();
        activateRow(currentRow);
      }
      // ←→ 는 가로채지 않는다 — 전역(송출 덱 이동)이 처리한다
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [rows.length, currentRow, items, activateRow]);

  // 커서가 화면 밖으로 나가지 않게
  useEffect(() => {
    listRef.current?.querySelector('.cue-row.current, .cue-divider.current')?.scrollIntoView({ block: 'nearest' });
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

  /**
   * 송출 중인 슬라이드가 그 항목의 몇 번째인지 — 펼친 목록에서 빨간 점을 찍을 자리.
   * 순서표 전체를 올린 경우에는 항목 시작 위치를 빼서 구한다.
   */
  const liveSlideIndexInItem = (() => {
    if (!deck) return -1;
    if (liveItemId) return currentIndex; // 항목 하나만 올린 경우 덱이 곧 그 항목이다
    if (!deck.groups || liveItemIndex < 0) return -1;
    const withoutDividers = items.filter((item) => item.type !== 'divider');
    const groupIndex = withoutDividers.findIndex((item) => item.id === items[liveItemIndex]?.id);
    const start = deck.groups[groupIndex]?.startIndex;
    return start === undefined ? -1 : currentIndex - start;
  })();

  /** 이 항목이 실제로 쓸 템플릿 — 지정이 없으면 지금 송출 중인 것 */
  function itemTemplateFor(item: CueItem): Template | null {
    const id = 'templateId' in item ? item.templateId : undefined;
    if (typeof id === 'number') return styleTemplates.find((t) => t.id === id) ?? template;
    return template;
  }

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

      {auto && (
        <div className="banner auto-bar">
          <button type="button" className="close" onClick={() => setAuto(null)}>■ 정지</button>
          ⏱ <b>예배 전 안내 자동 진행 중</b> —{' '}
          {items.find((i) => i.id === auto.dividerId)?.type === 'divider'
            ? describeItem(items.find((i) => i.id === auto.dividerId)!)
            : ''}{' '}
          · {Math.round(auto.holdMs / 1000)}초마다 {auto.loop ? '· 끝나면 처음으로' : '· 끝나면 정지'}
        </div>
      )}

      {/* 한 열 목록 — 3차 재설계에서 오른쪽 열을 없애고 슬라이드를 이 안으로 넣었다 */}
      <div className="plan-single">
        <div className="card plan-list">
          <div className="plan-head">
            <select
              className="grow"
              value={plan?.kind === 'template' ? plan.id : ''}
              onChange={(e) => {
                const found = templates.find((p) => p.id === Number(e.target.value));
                if (found) openPlan(found);
              }}
              title="예배 유형 — 골라서 고쳐 쓰는 원본입니다"
            >
              <option value="">— 예배 유형 —</option>
              {templates.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => { setLoadOpen(false); setNameBar({ kind: 'template', value: '' }); }}
              disabled={busy}
              title="지금 항목으로 새 예배 유형 만들기"
            >
              ＋
            </button>
          </div>

          {plan && (
            <>
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
              </div>

              <div className="plan-head">
                <button
                  type="button"
                  className="grow"
                  onClick={() => void updateTemplate()}
                  disabled={busy || plan.kind !== 'template'}
                  title={
                    plan.kind === 'template'
                      ? '지금 고친 내용을 이 유형의 원본으로 굳힙니다'
                      : '저장된 순서를 열었습니다 — 유형은 ＋ 로 새로 만드세요'
                  }
                >
                  템플릿 업데이트
                </button>
                <button
                  type="button"
                  className="grow"
                  onClick={() => {
                    setLoadOpen(false);
                    setNameBar({ kind: 'plan', value: `${today()} ${plan.name}` });
                  }}
                  disabled={busy}
                  title="이번 회차를 따로 남깁니다"
                >
                  순서 저장하기
                </button>
                <button
                  type="button"
                  className="grow"
                  onClick={() => { setNameBar(null); setLoadOpen((prev) => !prev); }}
                  disabled={busy}
                  title="저장해 둔 순서를 엽니다"
                >
                  순서 불러오기
                </button>
              </div>
            </>
          )}

          {nameBar && (
            <div className="plan-head">
              <input
                className="grow"
                autoFocus
                value={nameBar.value}
                onChange={(e) => setNameBar({ ...nameBar, value: e.target.value })}
                onKeyDown={(e) => {
                  if (isComposing(e)) return; // 한글 조합 확정용 Enter 는 넘긴다
                  if (e.key === 'Enter') { e.preventDefault(); void commitNameBar(); }
                  if (e.key === 'Escape') { e.preventDefault(); setNameBar(null); }
                }}
                placeholder={nameBar.kind === 'template' ? '새 예배 유형 이름' : '저장할 순서 이름'}
                spellCheck={false}
              />
              <button
                type="button"
                className="primary"
                onClick={() => void commitNameBar()}
                disabled={busy || nameBar.value.trim().length === 0}
              >
                {nameBarTarget ? '덮어쓰기' : '저장'}
              </button>
              <button type="button" onClick={() => setNameBar(null)}>취소</button>
            </div>
          )}

          {nameBar && nameBarTarget && (
            <p className="hintline warn">
              같은 이름이 이미 있습니다 — 누르면 그 {nameBar.kind === 'template' ? '유형' : '순서'}를 덮어씁니다.
            </p>
          )}

          {loadOpen && (
            <div className="candidates plan-saved">
              {saved.length === 0 && <span className="hintline muted">저장된 순서가 없습니다.</span>}
              {saved.map((p) => (
                <span key={p.id} className="saved-row">
                  <button type="button" onClick={() => openPlan(p)}>
                    {/* 이름에 이미 날짜가 들어 있으면 앞에 또 붙이지 않는다 */}
                    {p.serviceDate && !p.name.includes(p.serviceDate) ? `${p.serviceDate} · ` : ''}
                    {p.name}
                  </button>
                  <button type="button" className="del" onClick={() => void removeSaved(p)} title="삭제">✕</button>
                </span>
              ))}
            </div>
          )}

          {plan && (
            <p className="hintline muted">
              {plan.kind === 'template' ? '유형' : '저장된 순서'} · {plan.name}
              {dirty && <b> · 저장 안 됨</b>}
            </p>
          )}

          {!plan && <p className="hintline muted">예배 유형을 고르거나 ＋ 로 새로 만드세요.</p>}

          {plan && (
            <div className="cue-list" ref={listRef}>
              {items.length === 0 && <p className="hintline muted">아래에서 항목을 추가하세요.</p>}

              {rows.map((row, rowIndex) => {
                const item = items[row.itemIndex];
                if (!item) return null;
                const isCursor = rowIndex === cursor;

                // ── 구분(그룹 머리글) ──
                if (row.kind === 'divider' && item.type === 'divider') {
                  const running = auto?.dividerId === item.id;
                  return (
                    <div
                      key={item.id}
                      className={`cue-divider${isCursor ? ' current' : ''}${running ? ' auto' : ''}`}
                      onClick={() => setCursor(rowIndex)}
                    >
                      <span className="label">
                        {item.label}
                        {item.auto && <span className="auto-tag" title="예배 전 안내 — 자동으로 넘어갑니다">⏱</span>}
                      </span>
                      <span className="actions">
                        {item.auto && (
                          <button
                            type="button"
                            className="go"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (running) setAuto(null);
                              else void startAuto(item);
                            }}
                            disabled={!connected || busy}
                            title={running ? '자동 진행 정지' : '예배 전 안내 시작 (자동 진행)'}
                          >
                            {running ? '■' : '▶'}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); patchItems(moveItem(items, row.itemIndex, row.itemIndex - 1)); }}
                          disabled={row.itemIndex === 0}
                          title="위로"
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); patchItems(moveItem(items, row.itemIndex, row.itemIndex + 1)); }}
                          disabled={row.itemIndex === items.length - 1}
                          title="아래로"
                        >
                          ↓
                        </button>
                        <button type="button" onClick={(e) => { e.stopPropagation(); patchItems(removeItem(items, item.id)); }} title="삭제">✕</button>
                      </span>
                    </div>
                  );
                }

                // ── 펼친 항목의 슬라이드 줄 ──
                if (row.kind === 'slide') {
                  const slide = preview?.slides[row.slideIndex];
                  const isLiveSlide =
                    row.itemIndex === liveItemIndex && liveSlideIndexInItem === row.slideIndex;
                  return (
                    <div
                      key={`${item.id}-s${row.slideIndex}`}
                      className={`cue-slide-row${isCursor ? ' current' : ''}${isLiveSlide ? ' live' : ''}`}
                      onClick={() => { setCursor(rowIndex); void sendItem(item, row.slideIndex); }}
                      title="눌러서 송출"
                    >
                      <span className="live-dot" title={isLiveSlide ? '송출 중' : undefined} />
                      <span className="num">{preview?.labels[row.slideIndex] || row.slideIndex + 1}</span>
                      <span className="text">{slide ? slideSummary(slide) : ''}</span>
                    </div>
                  );
                }

                // ── 항목 줄 ──
                const isLive = row.itemIndex === liveItemIndex;
                const expandable = isExpandable(item);
                const expanded = expandedId === item.id;
                return (
                  <div
                    key={item.id}
                    className={`cue-row${isCursor ? ' current' : ''}${isLive ? ' live' : ''}${expanded ? ' expanded' : ''}`}
                    onClick={() => { setCursor(rowIndex); activateRow(row); }}
                    title={expandable ? '눌러서 펼치기 (Tab)' : '눌러서 송출'}
                  >
                    <span className="live-dot" title={isLive ? '송출 중' : undefined} />
                    <span className="twisty">{expandable ? (expanded ? '▾' : '▸') : ''}</span>
                    <span className="icon">{itemIcon(item)}</span>
                    <span className="body">
                      <span className="title">{describeItem(item)}</span>
                      <span className="meta">{itemMeta(item)}</span>
                    </span>

                    {/* 이 항목이 어느 템플릿으로 나가는지 — 여기서 바로 바꾼다 */}
                    <select
                      className="row-template"
                      value={'templateId' in item && item.templateId !== undefined ? item.templateId : ''}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => {
                        const value = e.target.value === '' ? undefined : Number(e.target.value);
                        patchItems(
                          items.map((i) => (i.id === item.id ? { ...i, templateId: value } : i)),
                        );
                      }}
                      title="이 항목을 송출할 때 쓸 템플릿"
                    >
                      <option value="">템플릿 그대로</option>
                      {styleTemplates.map((t) => (
                        <option key={t.id} value={t.id}>{t.name}</option>
                      ))}
                    </select>

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
                      <button type="button" onClick={(e) => { e.stopPropagation(); patchItems(moveItem(items, row.itemIndex, row.itemIndex - 1)); }} disabled={row.itemIndex === 0} title="위로">↑</button>
                      <button type="button" onClick={(e) => { e.stopPropagation(); patchItems(moveItem(items, row.itemIndex, row.itemIndex + 1)); }} disabled={row.itemIndex === items.length - 1} title="아래로">↓</button>
                      <button type="button" onClick={(e) => { e.stopPropagation(); patchItems(removeItem(items, item.id)); }} title="삭제">✕</button>
                    </span>
                  </div>
                );
              })}

              {previewError && <p className="hintline error">{previewError}</p>}
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
                    onClick={() => pickKind(option.kind)}
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
                    if (e.key !== 'Enter' || isComposing(e)) return;
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
                    // 한글은 마지막 글자가 조합 중이라 Enter 가 두 번 처리된다 (ime.ts 참고)
                    if (e.key !== 'Enter' || isComposing(e)) return;
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
      </div>

      {/*
        선택한 항목의 설정. 오른쪽 열을 없앴으므로 목록 **아래**에 한 덩어리로 둔다.
        목록 안에 끼워 넣으면 줄을 옮길 때마다 목록이 출렁여 진행이 보이지 않는다.
      */}
      {plan && current && (
        <div className="card plan-settings">
          <h2 className="plan-detail-title">
            <span className="icon">{itemIcon(current)}</span>
            {describeItem(current)}
            {liveItemIndex === (currentRow?.itemIndex ?? -1) && <span className="live-tag">송출 중</span>}
          </h2>

          {before && (
            <div className="row" style={{ marginBottom: 8 }}>
              <button type="button" onClick={restoreBefore} disabled={!connected}>
                ↩ 직전으로 ({before.label || '이전 화면'})
              </button>
            </div>
          )}

          {current.type === 'divider' && (
            <>
              <div className="row detail-controls">
                <label className="check">
                  <input
                    type="checkbox"
                    checked={Boolean(current.auto)}
                    onChange={(e) =>
                      patchItems(
                        items.map((i) =>
                          i.id === current.id
                            ? e.target.checked
                              ? { ...i, auto: { holdMs: AUTO_HOLD_MS_DEFAULT, loop: true } }
                              : { ...i, auto: undefined }
                            : i,
                        ),
                      )
                    }
                  />
                  예배 전 안내 (자동으로 넘김)
                </label>
              </div>

              {current.auto && (
                <div className="row detail-controls">
                  <label>한 장에 머무는 시간</label>
                  <input
                    type="number"
                    min={1}
                    max={600}
                    value={Math.round((current.auto.holdMs ?? AUTO_HOLD_MS_DEFAULT) / 1000)}
                    onChange={(e) => {
                      const seconds = Math.min(Math.max(Number(e.target.value) || 1, 1), 600);
                      patchItems(
                        items.map((i) =>
                          i.id === current.id && i.type === 'divider' && i.auto
                            ? { ...i, auto: { ...i.auto, holdMs: seconds * 1000 } }
                            : i,
                        ),
                      );
                    }}
                    style={{ width: 72 }}
                  />
                  <span className="muted">초</span>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={current.auto.loop !== false}
                      onChange={(e) =>
                        patchItems(
                          items.map((i) =>
                            i.id === current.id && i.type === 'divider' && i.auto
                              ? { ...i, auto: { ...i.auto, loop: e.target.checked } }
                              : i,
                          ),
                        )
                      }
                    />
                    마지막에서 처음으로
                  </label>
                  <span className="muted">아래 항목 {itemsInGroup(items, current.id).length}개</span>
                </div>
              )}
            </>
          )}

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

          {current.type === 'text' && current.variant === 'order' && (
            <div className="row detail-controls">
              <label>배치</label>
              <select
                value={current.layout ?? 'split'}
                onChange={(e) =>
                  patchItems(
                    items.map((i) =>
                      i.id === current.id ? { ...i, layout: e.target.value === 'stack' ? 'stack' : undefined } : i,
                    ),
                  )
                }
              >
                <option value="split">좌우 (순서 이름 · 담당자 + 밑줄)</option>
                <option value="stack">쌓기 (줄을 그대로)</option>
              </select>

              {/* 좌우 배치일 때만 — 쌓기에는 '오른쪽' 이 없다 */}
              {current.layout !== 'stack' && (
                <>
                  <label title="템플릿의 보조 텍스트 크기를 기준으로 한 배수입니다">담당자 크기</label>
                  <input
                    type="range"
                    min={PRESENTER_SCALE_MIN}
                    max={PRESENTER_SCALE_MAX}
                    step={0.05}
                    value={current.presenterScale ?? 1}
                    onChange={(e) => {
                      const scale = Number(e.target.value);
                      const next = items.map((i) =>
                        i.id === current.id ? { ...i, presenterScale: scale === 1 ? undefined : scale } : i,
                      );
                      patchItems(next);
                      // 단독 송출 중이면 바로 다시 보내 눈으로 보며 맞춘다 (글자 조정과 같은 규칙)
                      const updated = next.find((i) => i.id === current.id);
                      if (updated && liveItemId === current.id) void sendItem(updated);
                    }}
                  />
                  <span className="muted">{Math.round((current.presenterScale ?? 1) * 100)}%</span>
                </>
              )}
            </div>
          )}

          {current.type === 'text' && current.variant === 'order' && (
            <div className="row detail-controls">
              <label title="지정하지 않으면 템플릿의 외곽선 두께를 씁니다">테두리</label>
              {([
                ['순서', 'titleStroke', 'primary'],
                ['담당자', 'presenterStroke', 'secondary'],
              ] as const)
                .filter(([, key]) => key !== 'presenterStroke' || current.layout !== 'stack')
                .map(([label, key, role]) => {
                  // 지정이 없으면 템플릿 값에서 출발한다 — 0 에서 시작하면 조금만 건드려도 튄다
                  const fallback = itemTemplateFor(current)?.text[role].stroke?.width ?? 0;
                  const value = current[key] ?? fallback;
                  return (
                    <span className="knob" key={key}>
                      <span className="tag">{label}</span>
                      <input
                        type="range"
                        min={STROKE_MIN}
                        max={12}
                        step={0.5}
                        value={value}
                        onChange={(e) => {
                          const width = Number(e.target.value);
                          const next = items.map((i) => (i.id === current.id ? { ...i, [key]: width } : i));
                          patchItems(next);
                          const updated = next.find((i) => i.id === current.id);
                          if (updated && liveItemId === current.id) void sendItem(updated);
                        }}
                      />
                      <span className="num">{value}px</span>
                    </span>
                  );
                })}
              <button
                type="button"
                onClick={() => {
                  const next = items.map((i) =>
                    i.id === current.id ? { ...i, titleStroke: undefined, presenterStroke: undefined } : i,
                  );
                  patchItems(next);
                  const updated = next.find((i) => i.id === current.id);
                  if (updated && liveItemId === current.id) void sendItem(updated);
                }}
                disabled={current.titleStroke === undefined && current.presenterStroke === undefined}
                title="템플릿 두께로 되돌리기"
              >
                ↺
              </button>
            </div>
          )}

          {current.type === 'text' && current.variant === 'order' && current.layout !== 'stack' && (
            <OrderCharTuner
              title={splitOrderText(current.content).title}
              charStyles={current.charStyles}
              // 슬라이더의 출발점은 **이 항목이 쓸 템플릿**의 자동 리듬이다.
              // 송출 중인 템플릿을 기준으로 삼으면, 아직 올리지 않은 항목에서
              // 눈금과 실제 화면이 어긋난다.
              rhythm={itemTemplateFor(current)?.behavior.titleRhythm ?? 0}
              rhythmY={itemTemplateFor(current)?.behavior.titleRhythmY ?? 0}
              onChange={(charStyles) => {
                const next = items.map((i) => (i.id === current.id ? { ...i, charStyles } : i));
                patchItems(next);
                // 이 항목을 **단독으로 송출 중**이면 바로 다시 보내 눈으로 보며 맞출 수 있게 한다.
                // 순서표 전체가 올라가 있을 때는 건드리지 않는다 — 예배 중에 덱이
                // 통째로 바뀌면 진행 위치를 잃는다. 그때는 다시 올려야 반영된다.
                const updated = next.find((i) => i.id === current.id);
                if (updated && liveItemId === current.id) void sendItem(updated);
              }}
            />
          )}

          {current.type === 'text' && (
            <>
              {current.variant === 'order' && (
                <p className="hintline muted">첫 줄 = 순서 이름, 다음 줄 = 담당자</p>
              )}
              <textarea
                className="detail-text"
                rows={3}
                value={current.content}
                onChange={(e) =>
                  patchItems(items.map((i) => (i.id === current.id ? { ...i, content: e.target.value } : i)))
                }
                spellCheck={false}
              />
            </>
          )}
        </div>
      )}

      <p className="hintline muted plan-keys">
        <b>↑↓</b> 줄 이동 · <b>Tab</b> 펼치기 · <b>Shift+Tab</b> 접기 · <b>Enter</b> 송출 ·
        <b> ←→</b> 송출 중 이동 · <b>Space</b> 다음 · <b>B</b> 블랙 · <b>Esc</b> 복구
      </p>
    </div>
  );
}
