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
  buildPlanDeck, buildPlanRows, describeItem, insertIndexFor, isExpandable, itemsInGroup,
  moveItem, newItemId,
  removeItem, splitOrderText, type PlanRow,
} from '../../../lib/plan-deck.ts';
import { LANG_LABELS, MAX_LANGS, ACTIVE_LANGS, toggleLang } from '../../../lib/lang-select.ts';
import { itemTitle } from '../../../lib/item-title.ts';
import { quoteSlides, verseQuotes } from '../../../lib/verse-quotes.ts';
import { DisplayToggles } from '../components/DisplayToggles.tsx';
import { PlanItemEditor } from '../components/PlanItemEditor.tsx';
import { BackgroundSelect } from '../components/BackgroundSelect.tsx';
import { ItemTextStyleControls } from '../components/ItemTextStyleControls.tsx';
import { paginateByMeasure } from '../../../lib/paginator.ts';
import {
  ADD_KINDS, DEFAULT_GROUPS, ITEM_ICONS, MAX_SECONDARY, ORDER_PRESETS,
  itemIcon, itemMeta, slideSummary, songLabelOf, textVariantLabel, today, type AddKind,
} from '../../../lib/plan-item-view.ts';
import {
  AUTO_HOLD_MS_DEFAULT,
  AUTO_HOLD_MS_MAX,
  AUTO_HOLD_MS_MIN,
  type ClientMsg, type CueItem, type Deck, type ItemBackground, type LangCode, type ItemTextStyle, type PlanDefaults, type PlanKind, type ServicePlan,
  type SongEntry,
  type SlidePayload, type Template, type Translation,
} from '../../../shared/types.ts';
import {
  api, ApiError, READING_BOOK_LABELS,
  type BackgroundFile, type ReadingBook, type ReadingSummary,
} from '../api.ts';
import { isComposing } from '../ime.ts';
import { clearPlanDraft, readPlanDraft, writePlanDraft } from './plan-draft.ts';
import {
  DEFAULT_LITURGY_PER_SLIDE,
  DEFAULT_LITURGY_VERSION,
  LITURGY_TEXTS,
  findLiturgy,
  liturgyLines,
  liturgySlides,
  type LiturgyPerSlide,
  type LiturgyVersion,
} from '../../../lib/liturgy-texts.ts';
import { PRESENTER_SCALE_MAX, PRESENTER_SCALE_MIN, STROKE_MIN } from '../../../lib/order-rhythm.ts';
import { OrderCharTuner } from '../components/OrderCharTuner.tsx';
import { useMeasure } from '../hooks/useMeasure.ts';

/**
 * 찬양 검색에서 한 번에 보여 줄 곡 수. '찬양' 탭(60)보다 적은 이유는
 * 추가 바 아래 한 줄짜리 후보 띠라서 30개 남짓이 두세 줄로 들어가는 한계다.
 */
const SONG_HIT_LIMIT = 30;

interface Props {
  deck: Deck | null;
  currentIndex: number;
  connected: boolean;
  template: Template | null;
  /** 역본 목록 — 성경 항목의 주·보조 역본을 고르는 데 쓴다 */
  translations: Translation[];
  defaultTranslation: string;
  send: (msg: ClientMsg) => boolean;
}





export function PlanPanel({
  deck, currentIndex, connected, template, translations, defaultTranslation, send,
}: Props): React.JSX.Element {
  /** 예배 유형(주일예배·수요예배 …) — 매주 고쳐 쓰는 원본 */
  const [templates, setTemplates] = useState<ServicePlan[]>([]);
  /** 저장해 둔 회차 — 지난주 순서를 다시 열 때 */
  const [saved, setSaved] = useState<ServicePlan[]>([]);
  /**
   * 탭을 옮겼다 돌아온 것이면 편집 중이던 초안을 되살린다.
   *
   * `useState(() => …)` 로 **첫 렌더에** 넣는 것이 중요하다. effect 로 나중에 넣으면
   * 그 사이에 '아무것도 열지 않았으면 첫 유형을 연다' 규칙이 먼저 돌아 기본 유형이
   * 들어차고, 초안이 그것을 덮어써 화면이 한 번 튄다.
   */
  const [restored] = useState(readPlanDraft);

  /** 지금 편집 중인 것이 어디서 왔는지 */
  const [plan, setPlan] = useState<ServicePlan | null>(restored?.plan ?? null);
  const [items, setItems] = useState<CueItem[]>(restored?.items ?? []);

  /** 이름을 받아야 하는 저장 동작 (유형 만들기 / 순서 저장하기) */
  const [nameBar, setNameBar] = useState<{ kind: PlanKind; value: string; renameId?: number } | null>(
    null,
  );
  const nameInputRef = useRef<HTMLInputElement>(null);
  const [loadOpen, setLoadOpen] = useState(false);
  /** 기본 설정 패널을 펼쳤는지 */
  const [defaultsOpen, setDefaultsOpen] = useState(false);
  /**
   * 항목 편집 칸을 펼쳤는지.
   *
   * 기본은 펼침 — 항목을 고르는 것은 대개 고치려는 것이다. 그런데 '순서 표시' 처럼
   * 슬라이더가 많은 항목은 칸이 길어져 **순서 목록을 화면 밖으로 밀어낸다**
   * (2026-08-18 실측). 접을 수 있게 하고 높이도 제한한다.
   */
  const [detailOpen, setDetailOpen] = useState(true);
  const [dirty, setDirty] = useState(restored?.dirty ?? false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  /**
   * 선택(커서) — **줄** 번호다. 펼친 슬라이드도 한 줄로 센다.
   *
   * 항목 번호가 아니라 줄 번호인 이유는 3차 재설계에서 오른쪽 열을 없애고
   * 슬라이드를 목록 안으로 넣었기 때문이다(docs/plan-service-tab-3.md).
   */
  const [cursor, setCursor] = useState(restored?.cursor ?? 0);

  /** 펼친 항목 — 한 번에 하나만. 여러 개가 열리면 목록이 길어져 진행이 안 보인다. */
  const [expandedId, setExpandedId] = useState<string | null>(restored?.expandedId ?? null);

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
  /**
   * 전례문 본문을 고치는 동안의 **날것 그대로의 입력**.
   *
   * 항목에는 빈 줄을 걸러낸 결과만 담긴다. 그 값을 그대로 textarea 에 되돌리면
   * Enter 를 눌러도 빈 줄이 즉시 지워져 줄을 늘릴 수 없다. 그래서 고치는 동안은
   * 입력한 글자를 그대로 보여 주고, 항목에는 걸러낸 결과를 함께 반영한다
   * (미리보기는 타이핑하는 대로 따라온다).
   */
  const [liturgyDraft, setLiturgyDraft] = useState<{ id: string; text: string } | null>(null);
  /**
   * 고른 찬양 항목이 **실제로 가진** 언어.
   *
   * 없는 언어를 켜 놓고 '왜 영어가 안 나오지' 가 되지 않게 흐리게 표시한다
   * (찬양 탭과 같은 규칙). 항목을 고를 때 한 번만 읽는다.
   */
  const [songLangs, setSongLangs] = useState<{ id: number; available: string[] } | null>(null);

  /** 교독문 검색 결과 — 입력에 따라 좁혀진다 */
  const [readingHits, setReadingHits] = useState<ReadingSummary[]>([]);
  /**
   * 어느 찬송가의 교독문을 고르는지.
   *
   * 두 찬송가의 교독문은 번호가 같아도 다른 글이다 (통일 76편 · 새 137편).
   * 기본은 통일 — 지금까지 들어 있던 것이 그것이라 손이 기억하는 번호가 통일 것이다.
   */
  const [readingBook, setReadingBook] = useState<ReadingBook>('hymn_old');
  /** 두 찬송가에 각각 몇 편이 있는지 — 빈 쪽을 흐리게 한다 */
  const [readingCounts, setReadingCounts] = useState<Record<ReadingBook, number> | null>(null);
  const [readingTotal, setReadingTotal] = useState<number | null>(null);

  /** `data/backgrounds/` 파일 목록 — 그림·동영상 항목이 여기서 고른다 */
  const [bgFiles, setBgFiles] = useState<BackgroundFile[]>([]);
  /** 슬라이드쇼가 가리킬 수 있는 폴더 */
  const [bgFolders, setBgFolders] = useState<{
    library: Array<{ name: string; count: number }>;
    data: Array<{ name: string; count: number }>;
  }>({ library: [], data: [] });
  /** 그림 폴더 항목을 만들 때 고른 폴더 (`source/folder`) */
  const [pickedFolder, setPickedFolder] = useState('');
  /** 고를 폴더가 없을 때 '어디에 넣어야 하는지' 를 알려 주려고 들고 있는다 */
  const [bgDirs, setBgDirs] = useState<{ library: string; data: string }>({ library: '', data: '' });
  /** `~/Desktop/Data/Background` 의 그림들 — 전례문·교독문 배경을 여기서 고른다 */
  const [bgLibrary, setBgLibrary] = useState<BackgroundFile[]>([]);

  const [addKind, setAddKind] = useState<AddKind>('bible');
  const [addInput, setAddInput] = useState('');
  const [songHits, setSongHits] = useState<
    Array<{ id: number; title: string; label?: string; songLabel?: string }>
  >([]);
  /** 일치한 곡이 몇 개였는지 — 잘렸으면 안내를 띄운다 */
  const [songTotal, setSongTotal] = useState(0);
  const [parseOk, setParseOk] = useState<{ ok: boolean; text: string } | null>(null);
  /** 성경 항목을 추가할 때 쓸 역본 — 마지막에 고른 값을 다음 추가에도 이어 쓴다 */
  const [addPrimary, setAddPrimary] = useState(defaultTranslation);
  const [addSecondary, setAddSecondary] = useState<string[]>([]);

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

  /**
   * 편집 상태를 초안에 담는다 — 탭을 옮기면 이 패널은 언마운트된다.
   *
   * 커서까지 담는 이유: 20개짜리 순서에서 돌아왔을 때 커서가 맨 위로 튀면
   * 어디까지 짜던 중이었는지 다시 찾아야 한다.
   */
  useEffect(() => {
    if (!plan) return;
    writePlanDraft({ plan, items, dirty, cursor, expandedId });
  }, [plan, items, dirty, cursor, expandedId]);

  /** 편집 중인 변경을 잃는 자리에는 반드시 확인을 받는다 */
  function openPlan(target: ServicePlan): void {
    if (dirty && !window.confirm('저장하지 않은 변경이 있습니다. 그래도 여시겠습니까?')) return;
    setPlan(target);
    setItems(target.items);
    // 추가 바의 역본도 이 예배의 기본값에서 시작한다
    setAddPrimary(target.defaults?.bible?.primary ?? defaultTranslation);
    setAddSecondary(target.defaults?.bible?.secondary ?? []);
    setDirty(false);
    setCursor(0);
    setNotice(null);
    setLoadOpen(false);
    setNameBar(null);
  }

  /**
   * '이름 바꾸기' 를 열 때 기존 이름을 전체 선택한다.
   *
   * 칸이 이미 차 있는데 선택돼 있지 않으면 커서가 끝에 붙어, 새 이름을 치는 순간
   * 옛 이름 뒤에 이어 붙는다('주일예배' + '주일 1부 예배').
   *
   * **'순서 저장하기' 에는 걸지 않는다** — 거기는 '2026-08-17 주일 1부 예배' 처럼
   * 날짜가 채워져 있어 대개 그대로 쓰거나 뒤에 덧붙인다. 전체 선택하면 날짜까지
   * 다시 쳐야 한다.
   *
   * 의존성에 `value` 를 넣으면 안 된다 — 한 글자 칠 때마다 전체가 선택돼
   * 다음 글자가 앞의 것을 지운다.
   */
  const renamingId = nameBar?.renameId;
  useEffect(() => {
    if (renamingId !== undefined) nameInputRef.current?.select();
  }, [renamingId]);

  /** '템플릿 업데이트' — 지금 고친 내용을 이 유형의 원본으로 굳힌다 */
  async function updateTemplate(): Promise<void> {
    if (!plan || plan.kind !== 'template') return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.updatePlan(plan.id, {
        name: plan.name,
        items,
        defaults: plan.defaults ?? null,
      });
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

  /**
   * 같은 이름이 이미 있는지 — 있으면 버튼이 '덮어쓰기' 로 바뀐다.
   * 이름을 바꾸는 중이면 **자기 자신은 빼고** 본다 (자기 이름과 겹친다고 막으면 안 된다).
   */
  const nameBarTarget = nameBar
    ? (nameBar.kind === 'template' ? templates : saved).find(
        (p) => p.name === nameBar.value.trim() && p.id !== nameBar.renameId,
      )
    : undefined;

  /** 이름 입력 바 확정 — 새로 만들거나, 같은 이름이 있으면 덮어쓴다 */
  async function commitNameBar(): Promise<void> {
    if (!nameBar) return;
    const name = nameBar.value.trim();
    if (name.length === 0) return;

    setBusy(true);
    setError(null);
    try {
      // 이름만 바꾼다 — 항목은 건드리지 않는다.
      // 지금 화면의 items 를 함께 보내면, 아직 저장하지 않은 편집까지 조용히 굳는다.
      if (nameBar.renameId !== undefined) {
        const renamed = await api.updatePlan(nameBar.renameId, { name });
        if (plan?.id === nameBar.renameId) setPlan(renamed.plan);
        setNameBar(null);
        await reload();
        setNotice(`이름을 '${name}' 으로 바꿨습니다`);
        return;
      }

      // 빈 상태에서 유형을 만들면 뼈대를 넣어 준다 — 빈 목록은 무엇을 할 수 있는지 알려주지 못한다
      const payload: CueItem[] =
        items.length === 0 && nameBar.kind === 'template'
          ? DEFAULT_GROUPS.map((label) => ({ id: newItemId(), type: 'divider', label }))
          : items;

      const result = nameBarTarget
        ? await api.updatePlan(nameBarTarget.id, { name, items: payload, defaults: plan?.defaults ?? null })
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

  /**
   * 유형 복제 — '주일 1부' 를 놔둔 채 '주일 2부' 를 만드는 길.
   * 비슷한 유형을 여럿 두는 것이 실제 운영이라, 처음부터 짜는 것보다 이게 기본이다.
   */
  async function duplicateTemplate(): Promise<void> {
    if (!plan || plan.kind !== 'template') return;
    setBusy(true);
    setError(null);
    try {
      const copy = await api.duplicatePlan(plan.id);
      await reload();
      openPlan(copy);
      setNotice(`'${copy.name}' 을(를) 만들었습니다 — 이름을 바꿔 쓰세요`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '복제하지 못했습니다');
    } finally {
      setBusy(false);
    }
  }

  /**
   * 유형 삭제.
   *
   * 유형을 **전부** 지우면 다음 서버 시작 때 기본 넷이 되살아난다
   * (`seedDefaultTemplates` 는 '하나도 없을 때'만 넣는다). 지우고 나서 되살아나면
   * 고장으로 보이므로 미리 알린다.
   */
  async function removeTemplate(): Promise<void> {
    if (!plan || plan.kind !== 'template') return;
    const last = templates.length <= 1;
    const warning = last
      ? '\n\n마지막 유형입니다. 모두 지우면 다음 서버 시작 때 기본 유형이 되살아납니다.'
      : '';
    if (!window.confirm(`예배 유형 '${plan.name}' 을(를) 지웁니다. 되돌릴 수 없습니다.${warning}`)) return;

    setBusy(true);
    setError(null);
    try {
      await api.deletePlan(plan.id);
      setPlan(null);
      setItems([]);
      setDirty(false);
      // 초안도 함께 버린다 — 남겨 두면 다음에 이 탭을 열 때 지운 유형이 되살아난다
      clearPlanDraft();
      await reload();
      setNotice(`유형 '${plan.name}' 을(를) 지웠습니다`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '지우지 못했습니다');
    } finally {
      setBusy(false);
    }
  }

  /** 저장된 순서 삭제 — 되돌릴 수 없으므로 확인을 받는다 */
  async function removeSaved(target: ServicePlan): Promise<void> {
    if (!window.confirm(`저장된 순서 '${target.name}' 을(를) 지웁니다. 되돌릴 수 없습니다.`)) return;
    try {
      await api.deletePlan(target.id);
      if (plan?.id === target.id) {
        setPlan(null);
        clearPlanDraft();
      }
      await reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '지우지 못했습니다');
    }
  }

  /**
   * 항목 목록을 바꾼다.
   *
   * 함수도 받는다. **비동기 작업이 끝난 뒤**에 고칠 때는 반드시 함수를 넘겨야 한다 —
   * 배열을 넘기면 그 배열이 만들어진 시점(옛 렌더)의 값이라, 그 사이에 사람이 한
   * 다른 편집을 조용히 덮어쓴다. 실제로 역본을 바꾼 직후 미리보기를 다시 읽는
   * 경로에서 역본 변경이 되돌아갔다.
   */
  function patchItems(next: CueItem[] | ((prev: CueItem[]) => CueItem[])): void {
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

        /*
         * 항목이 정한 표시 여부를 슬라이드마다 실어 보낸다.
         *
         * **결정은 출력 페이지가 한다** — 여기서 풀어 담으면 나중에 템플릿만 바꿨을 때
         * 그 값이 따라오지 않는다. 여기서는 항목의 뜻을 전달만 한다.
         */
        const withDisplay = (slides: SlidePayload[]): SlidePayload[] =>
          item.display === undefined && item.style === undefined
            ? slides
            : slides.map((slide) =>
                slide.kind === 'bible'
                  ? {
                      ...slide,
                      ...(item.display ? { display: item.display } : {}),
                      ...(item.style ? { style: item.style } : {}),
                    }
                  : slide,
              );

        /*
         * 인용구는 **참조를 본문 앞에 붙인다** — `고전 1:3 하나님 우리 아버지와…`.
         *
         * 네 화면(관리자 목록·OBS·강사 모니터·프로젝터)이 서로 다른 렌더러를 쓰는데,
         * 참조를 별개 요소로 두면 규칙이 넷이 되어 다시 어긋난다 (사용자 지적
         * 2026-08-20). 글자로 넣으면 네 화면이 그것을 '본문' 으로 받아 저절로 같아진다.
         *
         * 접두사는 **항목의 `ref`** 다 — 목록 줄(`describeItem`)과 글자까지 같아진다.
         * 본문 낭독(성경 항목)은 `item.quote` 가 없어 이 길로 오지 않는다.
         */
        const finish = (slides: SlidePayload[]): SlidePayload[] =>
          item.quote ? quoteSlides(withDisplay(slides), item.ref, item.display?.reference !== false) : withDisplay(slides);

        if ((item.paging ?? 'verse') === 'auto') {
          const paginated = await paginateByMeasure(passage.passage, (slide) =>
            measurer.measure(slide, template ?? undefined),
          );
          if (paginated.slides.length > 0) {
            return {
              slides: finish(paginated.slides),
              labels: paginated.slides.map((_, i) => `${i + 1}`),
            };
          }
        }
        return { slides: finish(passage.deck.slides), labels: passage.deck.labels };
      }

      if (item.type === 'song') {
        const songDeck = await api.songDeck(item.songId, item.langs, item.lines ?? '2', undefined, maxChars);
        const slides =
          item.display === undefined && item.style === undefined
            ? songDeck.deck.slides
            : songDeck.deck.slides.map((slide) =>
                slide.kind === 'song'
                  ? {
                      ...slide,
                      ...(item.display ? { display: item.display } : {}),
                      ...(item.style ? { style: item.style } : {}),
                    }
                  : slide,
              );
        return { slides, labels: songDeck.deck.labels };
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

      /*
       * 슬라이드쇼 — 폴더를 **띄울 때** 읽는다.
       *
       * 순서표에는 폴더만 담겨 있다. 그림 이름을 담아 두면 나중에 파일을 더 넣어도
       * 순서표를 고쳐야 하는데, '폴더에 넣기만 하면 되는 것' 이 이 기능의 요점이다.
       */
      if (item.type === 'slideshow') {
        const { files } = await api.slideshow(item.source, item.folder);
        if (files.length === 0) {
          return { slides: [], labels: [], error: `폴더에 그림이 없습니다 (${item.folder || '기본 폴더'})` };
        }
        return {
          slides: files.map((file) => ({
            kind: 'image' as const,
            src: file.url,
            alt: file.name,
            ...(item.fit === 'cover' ? { fit: 'cover' as const } : {}),
          })),
          labels: files.map((file) => file.name.replace(/\.[^.]+$/, '')),
        };
      }

      if (item.type === 'liturgy') {
        const lines = liturgyLines(item.textId, item.version, item.overrideLines);
        if (!lines) return { slides: [], labels: [], error: '본문을 찾지 못했습니다' };

        const pages = liturgySlides(lines, item.perSlide ?? DEFAULT_LITURGY_PER_SLIDE);
        return {
          slides: pages.map((page) => ({
            kind: 'text' as const,
            lines: [...page],
            ...(item.background ? { background: item.background } : {}),
            ...(item.style ? { style: item.style } : {}),
          })),
          labels: pages.map((_, index) => `${index + 1}`),
        };
      }

      if (item.type === 'reading') {
        try {
          const reading = await api.reading(item.readingNumber, item.readingBook);
          if (reading.slides.length === 0) {
            return { slides: [], labels: [], error: '본문이 비어 있습니다' };
          }
          return {
            slides: reading.slides.map((slide) => ({
              kind: 'reading' as const,
              leader: slide.leader,
              ...(slide.people !== undefined ? { people: slide.people } : {}),
              reference: reading.title,
              ...(item.background ? { background: item.background } : {}),
              ...(item.style ? { style: item.style } : {}),
            })),
            labels: reading.slides.map((_, index) => `${index + 1}`),
          };
        } catch (err) {
          // 가져오기를 안 한 PC 면 여기로 온다 — 조용히 빈 화면을 내보내지 않는다
          return {
            slides: [],
            labels: [],
            error: err instanceof ApiError ? err.message : '교독문을 불러오지 못했습니다',
          };
        }
      }

      if (item.type === 'blank') return { slides: [{ kind: 'blank' }], labels: ['공백'] };

      // 구분은 슬라이드가 없다 (buildPlanDeck 도 건너뛴다)
      return { slides: [], labels: [] };
    },
    [measurer, template, maxChars],
  );

  // 펼친 항목을 풀어 슬라이드 줄로 보여 준다. **송출하지 않는다.**
  const expandedItem = items.find((item) => item.id === expandedId);
  /**
   * 항목 **내용**이 바뀌어도 다시 풀어야 한다.
   *
   * 전에는 `id` 만 봤다. 그래서 판본이나 화면 넘김을 바꿔도 미리보기가 그대로라
   * 방금 만진 설정이 먹히지 않은 것처럼 보였다. 항목 하나를 직렬화하는 비용은
   * 무시할 만하고, 이 값이 같으면 결과도 같다.
   */
  const expandedSignature = expandedItem ? JSON.stringify(expandedItem) : null;
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
  }, [expandedSignature, resolveItem]);

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

      /*
       * 인용구를 띄우기 전 화면을 기억한다 — `↩ 직전으로` 가 여기로 돌아온다.
       *
       * 두 가지를 다 본다: 새 인용구(성경 절)와, 옛 순서표에 남아 있는 자유 글자
       * 인용구. 광고와 인용구의 **유일한 실제 차이**가 이 동작이므로, 기능이 바뀌어도
       * 잃지 않는다 ('설교 중 잠깐 띄울 내용' 이라는 뜻 그대로다).
       */
      const isQuote =
        (item.type === 'bible' && item.quote === true) ||
        (item.type === 'text' && item.variant === 'quote');
      if (isQuote && liveSlide) {
        setBefore({ slide: liveSlide, label: liveLabel ?? '' });
      }

      // 쓸 템플릿을 **슬라이드보다 먼저** 올린다 (항목 지정 → 예배 기본 설정 순).
      // 순서가 반대면 옛 템플릿으로 한 번 그려졌다가 바뀌어 화면이 튄다.
      const useTemplate = templateIdFor(item);
      if (typeof useTemplate === 'number') send({ t: 'template:set', id: useTemplate });

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

  /**
   * 화면에 나가 있는 항목을 고쳤으면 **다시 보낸다.**
   *
   * 없으면 폰트·글자 크기를 돌려도 화면이 그대로다 — 다시 ▶ 를 눌러야 반영된다.
   * 이 값들은 '돌려 보면서 맞추는' 성격이라, 눈이 따라오지 않으면 옵션이 없는 것과 같다
   * (실사용에서 '변경되지 않는다'로 보고된 증상이 이것이다).
   *
   * **단독 송출 중일 때만** 한다. 순서표 전체가 올라가 있으면 덱을 통째로 바꾸는 셈이라
   * 예배 중에 진행 위치를 잃는다 — 담당자 크기·글자 조정이 쓰는 규칙과 같다.
   *
   * 짧게 모아 한 번만 보낸다. 슬라이더를 끌면 값이 연달아 바뀌는데, 교독문은 본문을
   * 서버에서 다시 읽어 오므로(비동기) 늦게 온 옛 응답이 새 화면을 덮을 수 있다.
   */
  const liveRefresh = useRef<number | null>(null);
  const refreshLive = useCallback(
    (item: CueItem): void => {
      if (liveItemId !== item.id) return;
      if (liveRefresh.current !== null) clearTimeout(liveRefresh.current);
      liveRefresh.current = window.setTimeout(() => {
        liveRefresh.current = null;
        // 보고 있던 장에 그대로 머문다 — 크기를 만질 때마다 첫 장으로 돌아가면 못 쓴다.
        // 장 수가 줄어드는 경우(4줄씩 → 전체 한 장)는 sendItem 이 잘라 준다.
        void sendItem(item, currentIndex);
      }, 120);
    },
    [liveItemId, sendItem, currentIndex],
  );

  // 남은 타이머가 사라진 화면을 향해 쏘지 않게 한다
  useEffect(
    () => () => {
      if (liveRefresh.current !== null) clearTimeout(liveRefresh.current);
    },
    [],
  );

  // 고른 항목이 찬양이면 그 곡이 가진 언어를 읽어 둔다 (버튼을 흐리게 하는 데 쓴다)
  const currentSongId = (() => {
    const item = items.find((i) => i.id === expandedId) ?? items[cursor];
    return item && item.type === 'song' ? item.songId : null;
  })();

  useEffect(() => {
    if (currentSongId === null) return;
    if (songLangs?.id === currentSongId) return;
    let alive = true;
    void api
      .song(currentSongId)
      .then((loaded) => {
        // 읽는 사이에 다른 항목으로 옮겼으면 버린다 — 늦게 온 응답이 덮지 않게
        if (alive) setSongLangs({ id: currentSongId, available: loaded.availableLangs });
      })
      // 못 읽어도 순서표 작업은 계속돼야 한다 — 버튼이 흐려지지 않을 뿐이다
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [currentSongId, songLangs?.id]);

  /**
   * 항목 제목 한 줄을 띄운다 — 회중이 다음을 준비하도록.
   *
   * **그 항목이 쓸 템플릿을 함께 올린다.** 그러면 제목이 곧이어 나올 본문과 **같은
   * 자리·같은 모양**으로 뜬다. 활성 템플릿을 그대로 쓰면 앞 순서(순서 표시 등)의
   * 큰 명조가 남아 성경 참조가 엉뚱하게 커진다.
   *
   * 슬라이드 한 장짜리 덱으로 보낸다 — `show` 로 보내면 진행 위치(덱)를 잃는다.
   */
  const sendTitle = useCallback(
    (item: CueItem) => {
      if (!connected) return;
      const title = itemTitle(item);
      if (!title) return;

      const useTemplate = templateIdFor(item);
      if (typeof useTemplate === 'number') send({ t: 'template:set', id: useTemplate });

      send({
        t: 'deck:load',
        payload: {
          reference: `${describeItem(item)} (제목)`,
          slides: [{ kind: 'text', lines: [title] }],
          labels: ['제목'],
          index: 0,
        },
      });
      setLiveItemId(null);
    },
    [connected, send, items, plan?.defaults?.templates],
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

  const slideCount = deck?.slides.length ?? 0;
  const hold = auto?.holdMs ?? AUTO_HOLD_MS_DEFAULT;

  /**
   * 자동 진행 타이머.
   *
   * 슬라이드가 바뀔 때마다 **다음 한 번**만 예약한다. 반복 타이머를 쓰면
   * 사람이 중간에 손으로 넘겼을 때 남은 시간이 어긋나 두 장이 연달아 넘어간다.
   */
  useEffect(() => {
    if (!auto || !connected) return;
    const total = slideCount;
    if (total === 0) return;

    const timer = setTimeout(() => {
      if (currentIndex >= total - 1) {
        // 예배 **전** 안내라 처음으로 돌아간다 (예배 중 덱은 순환하지 않는다)
        if (auto.loop) send({ t: 'goto', index: 0 });
        else setAuto(null);
      } else {
        send({ t: 'next' });
      }
    }, hold);

    return () => clearTimeout(timer);
    // 의존성은 **원시값만** 둔다. 전에 `deck?.slides` 를 넣었는데 상태가 올 때마다
    // 새 배열이라 타이머가 계속 처음부터 다시 걸렸다.
  }, [auto, connected, currentIndex, slideCount, hold, send]);

  /**
   * 교독문 검색. 번호('23')와 제목('시편 98')과 본문 낱말 모두로 찾는다.
   *
   * 가져오기를 안 했으면 `total` 이 0 이다 — 그때는 '무엇을 해야 하는지' 를
   * 알려야 한다(빈 목록만 보여 주면 고장으로 보인다).
   */
  useEffect(() => {
    if (addKind !== 'reading') return;
    let cancelled = false;
    void api
      .readings(addInput.trim() || undefined, readingBook)
      .then((result) => {
        if (cancelled) return;
        setReadingHits(result.items.slice(0, 40));
        setReadingTotal(result.total);
        setReadingCounts(result.counts);
      })
      .catch(() => {
        if (cancelled) return;
        setReadingHits([]);
        setReadingTotal(0);
      });
    return () => {
      cancelled = true;
    };
  }, [addKind, addInput, readingBook]);

  /**
   * 배경 폴더 파일 목록. 템플릿 탭에서 올린 것을 여기서도 골라야 하므로
   * 그림·동영상 칸을 열 때마다 다시 읽는다.
   */
  const reloadBgFiles = useCallback(async () => {
    try {
      const result = await api.backgrounds();
      setBgFiles(result.files);
      setBgLibrary(result.library ?? []);
      setBgFolders(result.folders ?? { library: [], data: [] });
      setBgDirs({ library: result.libraryDir ?? '', data: result.dataDir ?? '' });
    } catch {
      // 목록을 못 읽어도 순서표 작업은 계속돼야 한다 — 고를 파일이 없을 뿐이다
      setBgFiles([]);
      setBgLibrary([]);
      setBgFolders({ library: [], data: [] });
    }
  }, []);

  useEffect(() => {
    // 기본 설정 칸에도 배경 드롭다운이 있다. 이걸 빼먹으면 설정을 열었을 때
    // 목록이 비어 '배경이 없다'고 오해한다.
    const needsFiles =
      defaultsOpen ||
      addKind === 'liturgy' ||
      addKind === 'reading' ||
      addKind === 'slideshow' ||
      items.some((i) => i.type === 'liturgy' || i.type === 'reading');
    if (needsFiles) void reloadBgFiles();
  }, [defaultsOpen, addKind, items, reloadBgFiles]);

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
      // 항목이 템플릿을 지정하지 않았으면 예배 기본 설정을 경계에 실어 보낸다.
      // 이게 없으면 순서표를 올려 진행할 때만 기본 설정이 빠진다.
      const withDefaults = {
        ...result.deck,
        groups: result.deck.groups?.map((group, index) => {
          if (group.templateId !== undefined) return group;
          const item = items.filter((i) => i.type !== 'divider')[index];
          const id = item ? templateIdFor(item) : undefined;
          return id === undefined ? group : { ...group, templateId: id };
        }),
      };
      if (result.failed.length > 0) {
        setNotice(
          `${result.failed.length}개 항목을 건너뛰었습니다: ` +
            result.failed.map((f) => `${describeItem(f.item)} (${f.error})`).join(', '),
        );
      }
      send({ t: 'deck:load', payload: withDefaults });
      setLiveItemId(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '순서표를 올리지 못했습니다');
    } finally {
      setBusy(false);
    }
  }

  // ── 항목 추가 ───────────────────────────────────────────────

  /**
   * 찬양 검색 (디바운스).
   *
   * 몇 개를 받아 오는가: 전에는 8개였다. '은혜' 처럼 흔한 말은 제목만 34곡이 걸려
   * 제목이 정확히 「은혜」인 곡이 8개 밖으로 밀려 **아예 보이지 않았다**
   * (2026-09-03 사용자 보고). 서버가 일치 등급 순으로 돌려주도록 고쳤지만,
   * 찾는 곡이 목록 안에 들어 있기만 하면 되는 것이 아니라 **눈에 보여야** 한다.
   * 30개로 올리고, 그래도 잘렸으면 몇 곡 중 몇 곡인지 알려 준다.
   */
  useEffect(() => {
    if (addKind !== 'song' || addInput.trim().length === 0) {
      setSongHits([]);
      setSongTotal(0);
      return;
    }
    const timer = setTimeout(() => {
      void api
        .songs(addInput, SONG_HIT_LIMIT)
        .then((res) => {
          setSongTotal(res.total);
          setSongHits(
            res.hits.map((hit) => ({
              id: hit.id,
              title: hit.title,
              label: hit.entries
                .filter((e) => e.number !== undefined)
                .map((e) => `${e.songbookShortLabel}${e.number}`)[0],
              // 제목 슬라이드용 — 짧은 라벨('새305')과 달리 회중이 읽는 형태다
              songLabel: songLabelOf(hit.entries),
            })),
          );
        })
        .catch(() => {
          setSongHits([]);
          setSongTotal(0);
        });
    }, 200);
    return () => clearTimeout(timer);
  }, [addKind, addInput]);

  /** 참조를 입력받는 종류 — 성경(본문 낭독)과 인용구(절 낱개) */
  const wantsRef = addKind === 'bible' || addKind === 'quote';

  // 성경 참조 확인 (디바운스) — 맞는 본문인지 추가하기 전에 보여 준다
  useEffect(() => {
    if (!wantsRef || addInput.trim().length === 0) {
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
  }, [wantsRef, addInput]);

  /** 새 항목을 커서 **다음**에 넣는다 — 순서를 짜는 자연스러운 방향 */
  /**
   * 새 항목을 **고른 항목 바로 다음**에 넣는다.
   *
   * 자리 계산은 `insertIndexFor` 가 한다 — `cursor` 는 화면 줄 번호라 그대로 쓰면
   * 펼친 항목의 슬라이드 줄 때문에 어긋나 맨 끝에 붙는다.
   */
  function insertItem(item: CueItem): void {
    const at = insertIndexFor(rows, cursor, items.length);
    const next = [...items.slice(0, at), item, ...items.slice(at)];
    patchItems(next);

    // 커서도 **줄** 번호로 옮긴다. 항목 번호를 그대로 넣으면 같은 이유로 어긋난다.
    const nextRows = buildPlanRows(next, expandedId, preview?.slides.length ?? 0);
    const rowIndex = nextRows.findIndex((row) => row.kind !== 'slide' && row.itemId === item.id);
    setCursor(rowIndex >= 0 ? rowIndex : Math.max(nextRows.length - 1, 0));

    setAddInput('');
    setSongHits([]);
    setSongTotal(0);
    setParseOk(null);
  }

  /**
   * 여러 항목을 **한 번에** 넣는다 (인용구가 절마다 하나씩 만든다).
   *
   * `insertItem` 을 여러 번 부르면 안 된다 — `items` 는 이 렌더의 값이라, 두 번째
   * 호출이 첫 번째를 덮어써 마지막 하나만 남는다. 한 번의 patchItems 로 넣는다.
   */
  function insertItems(list: readonly CueItem[]): void {
    if (list.length === 0) return;

    // 넣을 자리는 **사람이 보고 있는 자리** 기준이다
    const at = insertIndexFor(rows, cursor, items.length);

    /*
     * 넣는 것은 함수형으로 한다. 이 함수는 본문을 가져온 **뒤**에 불리므로, 그 사이에
     * 사람이 한 편집(줄 삭제 등)을 배열째로 덮어쓸 수 있다. 자리는 어긋나도 되지만
     * 항목이 사라지면 안 된다.
     */
    patchItems((prev) => {
      const safeAt = Math.min(at, prev.length);
      return [...prev.slice(0, safeAt), ...list, ...prev.slice(safeAt)];
    });

    // 커서는 **마지막으로 넣은 것**에 둔다 — 이어서 다음 순서를 넣는 자연스러운 자리.
    // 위 갱신을 아직 못 봤으므로 지금 값으로 어림한다 (어긋나도 커서 자리일 뿐이다)
    const last = list[list.length - 1]!;
    const guess = [...items.slice(0, at), ...list, ...items.slice(at)];
    const nextRows = buildPlanRows(guess, expandedId, preview?.slides.length ?? 0);
    const rowIndex = nextRows.findIndex((row) => row.kind !== 'slide' && row.itemId === last.id);
    setCursor(rowIndex >= 0 ? rowIndex : Math.max(nextRows.length - 1, 0));

    setAddInput('');
    setSongHits([]);
    setSongTotal(0);
    setParseOk(null);
  }

  /**
   * 인용구 — 참조를 **절 단위 낱개 항목**으로 넣는다.
   *
   * `창 1:1-6` → `창 1:1` … `창 1:6` 여섯 항목. 묶는 머리 줄을 만들지 않는다
   * (사용자 요청 2026-08-20: '카테고리가 아닌 개별 슬라이드로').
   *
   * 본문을 한 번만 조회한다. 그 응답에서 절 목록을 얻어 참조와 목록용 미리보기를
   * 함께 만든다 — 절마다 조회하면 여섯 번 왕복한다.
   */
  async function addQuote(ref: string): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      // 주 역본 하나만 넘긴다 — 여러 역본을 넘기면 같은 절이 역본 수만큼 온다
      const result = await api.passage(ref, [addPrimary], 'verse');
      const verses = result.passage?.blocks[0]?.verses ?? [];
      const quotes = verseQuotes(verses);
      if (quotes.length === 0) {
        setError(result.parse.ok ? '그 참조에 해당하는 본문이 없습니다' : result.parse.message);
        return;
      }
      insertItems(
        quotes.map((quote) => ({
          id: newItemId(),
          type: 'bible' as const,
          ref: quote.ref,
          primary: addPrimary,
          secondary: addSecondary,
          // 한 절이므로 나눌 것이 없다. 그래도 명시해 둔다 (기본값이 바뀌어도 한 장이다)
          paging: 'verse',
          quote: true as const,
          ...(quote.preview.length > 0 ? { preview: quote.preview } : {}),
        })),
      );
      setNotice(`인용구 ${quotes.length}개를 넣었습니다 — ${ref}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '본문을 가져오지 못했습니다');
    } finally {
      setBusy(false);
    }
  }

  /**
   * 인용구의 목록 미리보기를 새 역본으로 다시 읽는다.
   *
   * 실패하면 **아무것도 하지 않는다** — 미리보기는 라벨일 뿐이고, 없으면 참조만
   * 보인다. 화면에 나가는 본문은 언제나 DB 에서 다시 읽으므로 영향이 없다.
   */
  async function refreshQuotePreview(itemId: string, ref: string, translationId: string): Promise<void> {
    try {
      const result = await api.passage(ref, [translationId], 'verse');
      const quote = verseQuotes(result.passage?.blocks[0]?.verses ?? [])[0];
      if (!quote || quote.preview.length === 0) return;
      // 함수형으로 고친다 — 이 사이에 사람이 한 편집(방금 바꾼 역본!)을 덮어쓰지 않게
      patchItems((prev) =>
        prev.map((i) => (i.id === itemId && i.type === 'bible' ? { ...i, preview: quote.preview } : i)),
      );
    } catch {
      /* 라벨을 못 채운 것뿐이다. 참조만 보인다 */
    }
  }

  function addFromInput(): void {
    const text = addInput.trim();

    if (addKind === 'blank') {
      insertItem({ id: newItemId(), type: 'blank' });
      return;
    }
    if (addKind === 'slideshow') {
      if (pickedFolder.length === 0) return;
      const [source, ...rest] = pickedFolder.split('/');
      insertItem({
        id: newItemId(),
        type: 'slideshow',
        source: source === 'data' ? 'data' : 'library',
        folder: rest.join('/'),
      });
      setPickedFolder('');
      return;
    }
    if (text.length === 0) return;

    if (addKind === 'bible') {
      if (parseOk && !parseOk.ok) return; // 참조가 틀리면 넣지 않는다
      insertItem({
        id: newItemId(),
        type: 'bible',
        ref: text,
        primary: addPrimary,
        secondary: addSecondary,
        paging: plan?.defaults?.bible?.paging ?? 'verse',
      });
      return;
    }
    if (addKind === 'quote') {
      if (parseOk && !parseOk.ok) return; // 참조가 틀리면 넣지 않는다
      void addQuote(text);
      return;
    }
    if (addKind === 'divider') {
      insertItem({ id: newItemId(), type: 'divider', label: text });
      return;
    }
    if (addKind === 'notice' || addKind === 'order') {
      // 앞뒤 공백만 떼고 가운데 줄바꿈은 그대로 둔다 (여러 줄 광고를 한 항목으로)
      addText(text, addKind);
      return;
    }
    // 찬양은 검색 결과에서 고른다
    if (addKind === 'song' && songHits[0]) addSong(songHits[0].id, songHits[0].title, songHits[0].songLabel);
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

  /**
   * 광고·순서 표시는 저장 구조가 같고 variant 만 다르다.
   *
   * 인용구는 여기서 빠졌다 — 2026-08-20 에 자유 글자에서 **성경 절**로 바뀌었다
   * (광고와 기능이 겹쳤다). `addQuote` 를 쓴다. 옛 순서표에 남아 있는 자유 글자
   * 인용구는 광고처럼 그대로 나가므로 손대지 않는다.
   */
  function addText(content: string, kind: 'notice' | 'order'): void {
    if (content.trim().length === 0) return;
    insertItem({
      id: newItemId(),
      type: 'text',
      content,
      ...(kind === 'notice' ? {} : { variant: kind }),
    });
  }

  /**
   * 주기도문·사도신경 추가. 판본은 기본(새번역)으로 넣고 오른쪽에서 토글로 바꾼다 —
   * 넣을 때마다 판본을 묻게 하면 매주 같은 답을 하게 된다.
   */
  function addLiturgy(textId: string): void {
    insertItem({
      id: newItemId(),
      type: 'liturgy',
      textId,
      version: plan?.defaults?.liturgy?.version ?? DEFAULT_LITURGY_VERSION,
      ...(plan?.defaults?.liturgy?.perSlide !== undefined
        ? { perSlide: plan.defaults.liturgy.perSlide }
        : {}),
      // 기본 배경을 넣어 준다 — 항목마다 고르게 하면 잊어버린 한 장이 맨 화면으로 나간다
      ...(plan?.defaults?.readingBackground ? { background: plan.defaults.readingBackground } : {}),
    });
  }

  /** 교독문 추가 — 제목을 함께 담는다 (다른 PC 에서도 무엇이었는지 남는다) */
  function addReading(hit: ReadingSummary): void {
    insertItem({
      id: newItemId(),
      type: 'reading',
      // 통일찬송가용은 담지 않는다 — 없는 것이 곧 통일이다 (옛 순서표와 같은 뜻)
      ...(readingBook === 'hymn_new' ? { readingBook: 'hymn_new' as const } : {}),
      readingNumber: hit.number,
      readingTitle: hit.title,
      ...(plan?.defaults?.readingBackground ? { background: plan.defaults.readingBackground } : {}),
    });
    setAddInput('');
  }

  function addSong(songId: number, songTitle: string, songLabel?: string): void {
    // 찬양의 언어·줄 수도 예배 기본 설정을 따른다 — 매번 같은 값을 다시 고르지 않게
    insertItem({
      id: newItemId(),
      type: 'song',
      songId,
      songTitle,
      ...(songLabel ? { songLabel } : {}),
      langs: plan?.defaults?.song?.langs ?? ['ko'],
      lines: plan?.defaults?.song?.lines ?? '2',
    });
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
        const nowOpen = expandedId !== item.id;
        setExpandedId(nowOpen ? item.id : null);

        /*
         * 펼치면서 **제목을 띄운다** (사용자 요청, 2026-08-19).
         *
         * 여러 장짜리 항목은 누른 뒤 그 안의 장을 골라야 화면에 나가므로, 누르는 그
         * 순간이 '다음은 이것' 이라고 알릴 자리다. 접을 때는 띄우지 않는다 —
         * 접는 것은 '이제 안 볼래' 이지 '이걸 알려라' 가 아니다.
         *
         * 예배 기본 설정에서 끌 수 있다. 클릭이 송출을 일으키는 것은 큰 변화라,
         * 항목을 살펴보려고 눌렀을 때 화면이 바뀌는 것이 부담스러울 수 있다.
         */
        if (nowOpen && plan?.defaults?.titleOnSelect !== false) void sendTitle(item);
        return;
      }
      void sendItem(item, 0);
    },
    [items, sendItem, sendTitle, expandedId, plan?.defaults?.titleOnSelect],
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

  /**
   * 순서표 **전체**가 올라간 채로 이 항목이 화면에 나가 있는가.
   *
   * 이때는 항목을 고쳐도 화면이 따라오지 않는다 — 덱을 통째로 다시 만들면 예배 중에
   * 진행 위치를 잃기 때문이다(의도된 제약). ▶ 도 소용없다: 올라간 덱 안에서 goto 로
   * 자리만 옮기므로 옛 슬라이드가 그대로 나온다(실측 확인). 되살리는 길은 다시 올리기뿐이다.
   * 그렇다면 최소한 **왜 안 바뀌는지와 무엇을 눌러야 하는지**는 보여야 한다.
   * 말없이 안 바뀌면 옵션이 고장난 것으로 읽힌다.
   */
  const liveViaPlanDeck = liveItemId === null && liveItemIndex >= 0;

  /** 기본 설정에서 이 항목이 어느 칸에 해당하는지 */
  function defaultsKeyFor(item: CueItem): 'bible' | 'song' | 'order' | 'text' | null {
    if (item.type === 'bible') return 'bible';
    if (item.type === 'song') return 'song';
    if (item.type === 'text') return item.variant === 'order' ? 'order' : 'text';
    return null;
  }

  /**
   * 이 항목이 실제로 쓸 템플릿 id.
   *
   * 항목이 지정한 것 → 예배 기본 설정 → (없으면) 지금 템플릿 유지.
   * 기본 설정을 두는 이유는, 한 예배 안에서 성경·찬양 템플릿이 대개 그대로 가기
   * 때문이다. 항목마다 고르게 하면 하나 빠뜨렸을 때 그 항목만 다르게 나간다.
   */
  function templateIdFor(item: CueItem): number | undefined {
    const own = 'templateId' in item ? item.templateId : undefined;
    if (typeof own === 'number') return own;
    const key = defaultsKeyFor(item);
    return key ? plan?.defaults?.templates?.[key] : undefined;
  }

  /** 이 항목이 실제로 쓸 템플릿 — 지정이 없으면 기본 설정, 그것도 없으면 지금 것 */
  function itemTemplateFor(item: CueItem): Template | null {
    const id = templateIdFor(item);
    if (typeof id === 'number') return styleTemplates.find((t) => t.id === id) ?? template;
    return template;
  }

  /**
   * 이 항목이 실제로 쓸 템플릿의 기본 글자 크기.
   *
   * 지금 활성 템플릿을 쓰면 안 된다 — 항목이 다른 템플릿을 지정했으면 크기가 달라
   * 줄 감김 어림이 틀린다 (실측에서 140% 인데도 경고가 안 떴다).
   */
  function baseFontSizeFor(item: CueItem, fallback: number): number {
    const id = templateIdFor(item);
    if (typeof id === 'number') {
      const found = styleTemplates.find((t) => t.id === id);
      if (found) return found.text.primary.fontSize;
    }
    return template?.text.primary.fontSize ?? fallback;
  }

  /** 기본 설정을 고친다 — 순서표에 저장되므로 dirty 로 표시된다 */
  function patchDefaults(mutate: (current: PlanDefaults) => PlanDefaults): void {
    if (!plan) return;
    const next = mutate(plan.defaults ?? {});
    setPlan({ ...plan, defaults: next });
    setDirty(true);
  }

  const kindHint = ADD_KINDS.find((option) => option.kind === addKind)?.hint ?? '';
  // 순서 표시도 여러 줄이다 — '설교 제목' 아래 줄에 설교자를 넣는다
  const isMultiline = addKind === 'notice' || addKind === 'order';

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

            {/*
              유형 관리 — 지금 연 유형에만 쓴다.
              전에는 만들기와 갱신뿐이라 '주일예배' 를 '주일 1부' 로 고칠 수도,
              안 쓰는 기본 유형을 치울 수도 없었다.
            */}
            <button
              type="button"
              onClick={() => void duplicateTemplate()}
              disabled={busy || plan?.kind !== 'template'}
              title="이 유형을 복제합니다 (주일 1부 → 2부)"
            >
              ⧉
            </button>
            <button
              type="button"
              onClick={() => {
                if (!plan) return;
                setLoadOpen(false);
                setNameBar({ kind: 'template', value: plan.name, renameId: plan.id });
              }}
              disabled={busy || plan?.kind !== 'template'}
              title="이 유형의 이름을 바꿉니다"
            >
              ✎
            </button>
            <button
              type="button"
              className="del"
              onClick={() => void removeTemplate()}
              disabled={busy || plan?.kind !== 'template'}
              title="이 유형을 지웁니다"
            >
              ✕
            </button>
          </div>

          {plan && (
            <>
              {/*
                한 줄로 합쳤다 (2026-08-18). 전에는 '예배용으로 올리기' 가 한 줄을 통째로
                쓰고 보조 버튼이 또 한 줄을 써서, 순서 목록이 그만큼(53px) 좁아졌다.
                랩탑(높이 900px)에서 목록이 285px 밖에 안 됐다.
              */}
              <div className="plan-head plan-actions">
                {/*
                  '예배용으로 올리기' — 순서표 전체를 하나의 덱으로 올리는 **주 동작**이다.
                  110eac5 의 한 줄 합치기에서 이 버튼만 빠져(회귀), 순서표 전체를 올릴 길이
                  없어졌다. 항목마다 ▶ 를 누르는 것으로는 화살표로 끝까지 진행할 수 없다.
                  .plan-actions > button.primary 의 `flex: 2` 는 원래 이 버튼 자리다.
                */}
                <button
                  type="button"
                  className="primary grow"
                  onClick={() => void loadForService()}
                  disabled={!connected || busy || items.length === 0}
                  title="순서표 전체를 하나로 올립니다. 이후 화살표로 끝까지 진행합니다."
                >
                  예배용으로 올리기
                </button>
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
                <button
                  type="button"
                  className={defaultsOpen ? 'primary' : undefined}
                  onClick={() => setDefaultsOpen((prev) => !prev)}
                  title="이 예배에서 기본으로 쓸 템플릿·역본"
                >
                  기본 설정
                </button>
              </div>

              {defaultsOpen && (
                <div className="card plan-defaults">
                  <p className="hintline muted">
                    이 예배 전체의 기본값입니다. <b>항목에서 따로 지정한 것만</b> 예외가 됩니다.
                    템플릿은 이미 만든 항목에도 곧바로 적용되고, 역본·언어는 <b>앞으로 넣는</b> 항목에 채워집니다.
                  </p>

                  {/*
                    교독문·주기도문·사도신경 배경은 한 곳에서 정한다.
                    사용자 요구: 이 셋은 '무조건' 배경을 깐다 (2026-08-18).
                    여기서 고르면 앞으로 넣는 항목이 자동으로 이 배경을 받는다.
                  */}
                  <div className="row detail-controls">
                    <label title="교독문·주기도문·사도신경에 함께 쓰입니다">교독문·전례문 배경</label>
                    <BackgroundSelect
                      value={plan.defaults?.readingBackground}
                      library={bgLibrary}
                      uploaded={bgFiles}
                      onChange={(readingBackground) => patchDefaults((c) => ({ ...c, readingBackground }))}
                    />
                  </div>

                  {([
                    ['bible', '성경'],
                    ['song', '찬양'],
                    ['order', '순서 표시'],
                    ['text', '광고·인용구'],
                  ] as const).map(([key, label]) => (
                    <div className="row detail-controls" key={key}>
                      <label>{label} 템플릿</label>
                      <select
                        value={plan.defaults?.templates?.[key] ?? ''}
                        onChange={(e) => {
                          const value = e.target.value === '' ? undefined : Number(e.target.value);
                          patchDefaults((c) => ({
                            ...c,
                            templates: { ...c.templates, [key]: value },
                          }));
                        }}
                      >
                        <option value="">지정 안 함 (지금 템플릿 유지)</option>
                        {styleTemplates.map((t) => (
                          <option key={t.id} value={t.id}>{t.name}</option>
                        ))}
                      </select>
                    </div>
                  ))}

                  <div className="row detail-controls translation-pick">
                    <label>성경 역본</label>
                    <select
                      value={plan.defaults?.bible?.primary ?? defaultTranslation}
                      onChange={(e) => {
                        const next = e.target.value;
                        patchDefaults((c) => ({
                          ...c,
                          bible: {
                            ...c.bible,
                            primary: next,
                            secondary: (c.bible?.secondary ?? []).filter((id) => id !== next),
                          },
                        }));
                        setAddPrimary(next);
                        setAddSecondary((prev) => prev.filter((id) => id !== next));
                      }}
                    >
                      {translations.map((t) => (
                        <option key={t.id} value={t.id}>{t.name}</option>
                      ))}
                    </select>
                    <span className="candidates">
                      {translations
                        .filter((t) => t.id !== (plan.defaults?.bible?.primary ?? defaultTranslation))
                        .map((t) => {
                          const current2 = plan.defaults?.bible?.secondary ?? [];
                          const active = current2.includes(t.id);
                          return (
                            <button
                              key={t.id}
                              type="button"
                              className={active ? 'primary' : undefined}
                              onClick={() => {
                                const next = active
                                  ? current2.filter((id) => id !== t.id)
                                  : current2.length >= MAX_SECONDARY
                                    ? current2
                                    : [...current2, t.id];
                                patchDefaults((c) => ({ ...c, bible: { ...c.bible, secondary: next } }));
                                setAddSecondary(next);
                              }}
                              disabled={!active && (plan.defaults?.bible?.secondary?.length ?? 0) >= MAX_SECONDARY}
                            >
                              {t.shortName}
                            </button>
                          );
                        })}
                    </span>
                  </div>

                  <div className="row detail-controls">
                    <label>성경 화면 넘김</label>
                    <select
                      value={plan.defaults?.bible?.paging ?? 'verse'}
                      onChange={(e) =>
                        patchDefaults((c) => ({ ...c, bible: { ...c.bible, paging: e.target.value } }))
                      }
                    >
                      <option value="verse">1절씩</option>
                      <option value="auto">자동 (화면에 맞춰)</option>
                      <option value="pair">2절씩</option>
                      <option value="all">구간 전체</option>
                    </select>

                    {/*
                      찬양 표시 언어 기본값 — 이 칸도 없었다. 항목마다 고르는 것은
                      가능해졌지만, 한/영으로 예배하는 교회는 매주 곡마다 누르게 된다.
                      '앞으로 넣는 항목'에 채워지는 값이다 (이미 있는 항목은 그대로).
                    */}
                    <label title="앞으로 넣는 찬양 항목에 채워집니다">찬양 표시 언어</label>
                    <span className="candidates">
                      {ACTIVE_LANGS.map((lang) => {
                        const currentLangs = (plan.defaults?.song?.langs ?? ['ko']) as LangCode[];
                        const active = currentLangs.includes(lang);
                        return (
                          <button
                            key={lang}
                            type="button"
                            className={active ? 'primary' : undefined}
                            onClick={() =>
                              patchDefaults((c) => ({
                                ...c,
                                song: { ...c.song, langs: toggleLang(currentLangs, lang) },
                              }))
                            }
                          >
                            {LANG_LABELS[lang] ?? lang}
                          </button>
                        );
                      })}
                    </span>

                    <label>찬양 화면 넘김</label>
                    <select
                      value={plan.defaults?.song?.lines ?? '2'}
                      onChange={(e) =>
                        patchDefaults((c) => ({ ...c, song: { ...c.song, lines: e.target.value } }))
                      }
                    >
                      <option value="1">1줄씩</option>
                      <option value="2">2줄씩</option>
                      <option value="4">4줄씩</option>
                      <option value="section">섹션 전체</option>
                    </select>
                  </div>

                  {/*
                    클릭이 송출을 일으키는 것은 큰 변화라 끌 수 있게 둔다. 없으면 켠
                    것으로 보므로(요청받은 기능이 기본으로 동작해야 한다) false 만 저장된다.
                  */}
                  <div className="row detail-controls">
                    <label title="성경·찬양·교독문·주기도문·사도신경에 해당합니다">
                      항목을 누르면 제목 띄우기
                    </label>
                    <span className="candidates">
                      {(
                        [
                          [true, '켬'],
                          [false, '끔'],
                        ] as const
                      ).map(([on, label]) => (
                        <button
                          key={label}
                          type="button"
                          className={(plan.defaults?.titleOnSelect !== false) === on ? 'primary' : undefined}
                          onClick={() => patchDefaults((c) => ({ ...c, titleOnSelect: on }))}
                        >
                          {label}
                        </button>
                      ))}
                    </span>
                    <span className="muted output-style-hint">
                      여러 장짜리 항목을 펼칠 때 '창 1:1-6' 처럼 제목 한 줄이 나갑니다
                    </span>
                  </div>

                  <p className="hintline muted">
                    바꾼 뒤 <b>템플릿 업데이트</b>(유형) 또는 <b>순서 저장하기</b> 를 눌러야 남습니다.
                  </p>
                </div>
              )}
            </>
          )}

          {nameBar && (
            <div className="plan-head">
              <input
                className="grow"
                autoFocus
                ref={nameInputRef}
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
                // 이름을 바꿀 때 다른 유형과 겹치면 막는다 — 이름이 곧 '덮어쓰기' 의 기준이라
                // 같은 이름이 둘이면 어느 쪽을 덮어쓸지 알 수 없게 된다
                disabled={
                  busy ||
                  nameBar.value.trim().length === 0 ||
                  (nameBar.renameId !== undefined && nameBarTarget !== undefined)
                }
              >
                {nameBar.renameId !== undefined ? '이름 바꾸기' : nameBarTarget ? '덮어쓰기' : '저장'}
              </button>
              <button type="button" onClick={() => setNameBar(null)}>취소</button>
            </div>
          )}

          {nameBar && nameBarTarget && (
            <p className="hintline warn">
              {nameBar.renameId !== undefined
                ? '같은 이름의 유형이 이미 있습니다 — 다른 이름을 쓰세요.'
                : `같은 이름이 이미 있습니다 — 누르면 그 ${
                    nameBar.kind === 'template' ? '유형' : '순서'
                  }를 덮어씁니다.`}
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

          {plan && dirty && (
            <p className="hintline muted plan-dirty">
              <b>저장 안 됨</b>
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
                        {/*
                          **꺼져 있을 때도 자리를 보여 준다.**
                          전에는 자동 넘김을 켜기 전까지 구분 행에 아무 표시가 없어서
                          이 기능이 있는 줄도 몰랐다 ('▶ 를 눌러도 안 된다' 신고,
                          2026-09-01). 흐린 ⏱ 을 누르면 켜지고 그 자리에 ▶ 가 생긴다 —
                          켜는 곳과 시작하는 곳이 같아야 헤매지 않는다.
                        */}
                        {item.auto ? (
                          <button
                            type="button"
                            className="go"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (running) setAuto(null);
                              else void startAuto(item);
                            }}
                            disabled={!connected || busy}
                            title={running ? '자동 진행 정지' : '예배 전 안내 시작 (자동으로 넘어갑니다)'}
                          >
                            {running ? '■' : '▶'}
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="ghost"
                            onClick={(e) => {
                              e.stopPropagation();
                              patchItems(
                                items.map((i) =>
                                  i.id === item.id
                                    ? { ...i, auto: { holdMs: AUTO_HOLD_MS_DEFAULT, loop: true } }
                                    : i,
                                ),
                              );
                            }}
                            title="예배 전 안내로 쓰기 — 켜면 ▶ 가 생겨 자동으로 넘어갑니다"
                          >
                            ⏱
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
                      <span className="text">
                        {slide ? slideSummary(slide, preview?.slides[row.slideIndex - 1]) : ''}
                      </span>
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
              ) : addKind === 'slideshow' ? (
                /*
                  폴더를 고른다 — **그림을 하나씩 고르지 않는다.**
                  폴더에 넣기만 하면 되는 것이 이 기능의 요점이라, 항목에는 폴더만 담고
                  그림은 띄울 때 읽는다. 몇 장인지 함께 보여 준다 —
                  1장이면 걸어 두는 썸네일, 여럿이면 구분 행의 자동 넘김이 순환한다.
                */
                (() => {
                  const all = [
                    ...bgFolders.library.map((f) => ({ ...f, source: 'library' as const })),
                    ...bgFolders.data.map((f) => ({ ...f, source: 'data' as const })),
                  ];
                  /*
                    고를 폴더가 하나도 없을 때 빈 드롭다운만 주면 '고장났다' 로 보인다.
                    **어디에 넣어야 하는지**를 그 자리에서 알려 준다 (실제 경로로).
                  */
                  if (all.length === 0) {
                    return (
                      <span className="hintline muted grow">
                        쓸 수 있는 그림이 없습니다. 아래 폴더에 그림을 넣거나 그 안에 폴더를 만드세요 —{' '}
                        <code>{bgDirs.library || '~/Desktop/Data/Background'}</code>
                      </span>
                    );
                  }
                  return (
                    <>
                      <select
                        className="grow"
                        value={pickedFolder}
                        onChange={(e) => setPickedFolder(e.target.value)}
                        aria-label="그림 폴더"
                      >
                        <option value="">폴더 고르기…</option>
                        {all.map((f) => (
                          <option key={`${f.source}/${f.name}`} value={`${f.source}/${f.name}`}>
                            {f.name === '' ? '(폴더 바로 밑)' : f.name} — {f.count}장{' '}
                            {f.source === 'library' ? '(모아 둔 폴더)' : '(앱 폴더)'}
                          </option>
                        ))}
                      </select>
                      <button type="button" disabled={pickedFolder.length === 0} onClick={() => addFromInput()}>
                        추가
                      </button>
                    </>
                  );
                })()
              ) : addKind === 'liturgy' ? (
                <div className="candidates liturgy-add">
                  {LITURGY_TEXTS.map((text) => (
                    <button key={text.id} type="button" onClick={() => addLiturgy(text.id)}>
                      {text.title}
                    </button>
                  ))}
                </div>
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

              {wantsRef && (
                <div className="row detail-controls translation-pick">
                  <label>역본</label>
                  <select
                    value={addPrimary}
                    onChange={(e) => {
                      const next = e.target.value;
                      setAddPrimary(next);
                      // 주 역본으로 올라온 것은 보조에서 뺀다 — 같은 본문이 두 번 나간다
                      setAddSecondary((prev) => prev.filter((id) => id !== next));
                    }}
                    title="주 역본"
                  >
                    {translations.map((t) => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                  <span className="candidates">
                    {translations
                      .filter((t) => t.id !== addPrimary)
                      .map((t) => {
                        const active = addSecondary.includes(t.id);
                        return (
                          <button
                            key={t.id}
                            type="button"
                            className={active ? 'primary' : undefined}
                            onClick={() =>
                              setAddSecondary((prev) =>
                                prev.includes(t.id)
                                  ? prev.filter((id) => id !== t.id)
                                  : prev.length >= MAX_SECONDARY
                                    ? prev
                                    : [...prev, t.id],
                              )
                            }
                            disabled={!active && addSecondary.length >= MAX_SECONDARY}
                            title={`보조 역본 (최대 ${MAX_SECONDARY}개)`}
                          >
                            {t.shortName}
                          </button>
                        );
                      })}
                  </span>
                </div>
              )}

              {wantsRef && parseOk && (
                <p className={`hintline ${parseOk.ok ? 'ok' : 'error'}`}>
                  {parseOk.text}
                  {addKind === 'quote' && parseOk.ok && ' — 절마다 낱개 항목이 됩니다'}
                </p>
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

              {addKind === 'reading' && (
                <>
                  {/*
                    두 찬송가의 교독문은 **번호가 같아도 다른 글**이다 (통일 76편 · 새 137편).
                    그래서 번호를 치기 전에 어느 쪽인지 먼저 골라야 한다.
                  */}
                  <div className="row detail-controls">
                    <label>교독문</label>
                    <span className="candidates">
                      {(['hymn_old', 'hymn_new'] as const).map((book) => {
                        const count = readingCounts?.[book];
                        return (
                          <button
                            key={book}
                            type="button"
                            className={readingBook === book ? 'primary' : undefined}
                            onClick={() => setReadingBook(book)}
                            title={count === 0 ? '아직 가져오지 않았습니다' : undefined}
                          >
                            {READING_BOOK_LABELS[book]}
                            {count !== undefined && ` ${count}편`}
                          </button>
                        );
                      })}
                    </span>
                  </div>

                  {readingTotal === 0 && (
                    <p className="hintline error">
                      {READING_BOOK_LABELS[readingBook]} 교독문이 없습니다. 터미널에서{' '}
                      <code>
                        {readingBook === 'hymn_new'
                          ? 'node scripts/import-kyodoc.ts --apply'
                          : 'node scripts/import-responsive.ts --apply'}
                      </code>{' '}
                      를 실행해 가져오세요.
                    </p>
                  )}
                  {readingHits.length > 0 && (
                    <div className="candidates">
                      {readingHits.map((hit) => (
                        <button
                          key={hit.number}
                          type="button"
                          onClick={() => addReading(hit)}
                          title={`줄 ${hit.lineCount}개 · 화면 ${hit.slideCount}장`}
                        >
                          {hit.number}. {hit.title}
                        </button>
                      ))}
                    </div>
                  )}
                  {readingTotal !== null && readingTotal > 0 && readingHits.length === 0 && (
                    <p className="hintline muted">
                      찾는 교독문이 없습니다 (전체 {readingTotal}편). 번호나 제목으로 찾아 보세요.
                    </p>
                  )}
                </>
              )}

              {addKind === 'song' && songHits.length > 0 && (
                <>
                  <div className="candidates">
                    {songHits.map((hit) => (
                      <button key={hit.id} type="button" onClick={() => addSong(hit.id, hit.title, hit.songLabel)}>
                        {hit.label ? `${hit.label} ` : ''}{hit.title}
                      </button>
                    ))}
                  </div>
                  {songTotal > songHits.length && (
                    <p className="hintline muted">
                      {songTotal}곡 중 {songHits.length}곡만 보입니다 — 검색어를 좁히거나 '찬양' 탭에서 찾아 보세요.
                    </p>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/*
        선택한 항목의 설정. 오른쪽 열을 없앴으므로 목록 **아래**에 한 덩어리로 둔다.
        목록 안에 끼워 넣으면 줄을 옮길 때마다 목록이 출렁여 진행이 보이지 않는다.
      */}
      {plan && current && currentRow && (
        <PlanItemEditor
          plan={plan}
          current={current}
          currentRow={currentRow}
          items={items}
          rows={rows}
          translations={translations}
          connected={connected}
          detailOpen={detailOpen}
          setDetailOpen={setDetailOpen}
          auto={auto}
          bgFiles={bgFiles}
          bgLibrary={bgLibrary}
          readingBook={readingBook}
          liturgyDraft={liturgyDraft}
          setLiturgyDraft={setLiturgyDraft}
          songLangs={songLangs}
          liveItemId={liveItemId}
          liveItemIndex={liveItemIndex}
          liveViaPlanDeck={liveViaPlanDeck}
          patchItems={patchItems}
          itemTemplateFor={itemTemplateFor}
          baseFontSizeFor={baseFontSizeFor}
          sendItem={sendItem}
          refreshLive={refreshLive}
          refreshQuotePreview={refreshQuotePreview}
          restoreBefore={restoreBefore}
          before={before}
        />
      )}

      {/*
        이 목록에서만 쓰는 키만 적는다. 송출 키(←→·Space·B·Esc)는 오른쪽 송출 제어에
        같은 내용이 있어, 두 곳에 적으면 자리를 두 번 쓰고 어느 것이 최신인지 흐려진다.
      */}
      <p className="hintline muted plan-keys">
        <b>↑↓</b> 줄 이동 · <b>Tab</b> 펼치기 · <b>Shift+Tab</b> 접기 · <b>Enter</b> 송출
      </p>
    </div>
  );
}
