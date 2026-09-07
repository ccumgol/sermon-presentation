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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  buildPlanRows, describeItem, insertIndexFor, isExpandable,
  moveItem, newItemId, removeItem, type PlanRow,
} from '../../../lib/plan-deck.ts';
import { LANG_LABELS, ACTIVE_LANGS, toggleLang } from '../../../lib/lang-select.ts';
import {
  baseFontSizeFor,
  itemTemplateFor,
  templateIdFor as pickTemplateId,
} from '../../../lib/plan-item-template.ts';
import { verseQuotes } from '../../../lib/verse-quotes.ts';
import { PlanItemEditor } from '../components/PlanItemEditor.tsx';
import { BackgroundSelect } from '../components/BackgroundSelect.tsx';
import {
  ADD_KINDS, MAX_SECONDARY, ORDER_PRESETS,
  itemIcon, itemMeta, slideSummary, songLabelOf, today, type AddKind,
} from '../../../lib/plan-item-view.ts';
import {
  AUTO_HOLD_MS_DEFAULT,
  type ClientMsg, type CueItem, type Deck, type LangCode,
  type PlanDefaults,
  type Template, type Translation,
} from '../../../shared/types.ts';
import {
  api, ApiError, READING_BOOK_LABELS,
  type BackgroundFile, type ReadingBook, type ReadingSummary,
} from '../api.ts';
import { isComposing } from '../ime.ts';
import { DEFAULT_LITURGY_VERSION, LITURGY_TEXTS } from '../../../lib/liturgy-texts.ts';
import { usePlanDraft } from '../hooks/usePlanDraft.ts';
import { usePlanPreview } from '../hooks/usePlanPreview.ts';
import { usePlanSend } from '../hooks/usePlanSend.ts';
import { usePlanStorage } from '../hooks/usePlanStorage.ts';

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
  /**
   * 편집 중인 것 — 이 화면의 척추다 (usePlanDraft, 2026-09-07 R-4).
   * 읽기·저장과 항목 추가가 둘 다 이것을 붙잡으므로 먼저 떼어냈다.
   */
  const draft = usePlanDraft();
  const {
    plan, setPlan, items, setItems, dirty, setDirty,
    cursor, setCursor, expandedId, setExpandedId, patchItems,
  } = draft;

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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  /**
   * 단독으로 송출한 항목 — 빨간 점을 켜기 위해 기억한다.
   *
   * 전체 덱을 올린 경우는 `deck.groups` 로 판정할 수 있지만, 항목 하나만 올리면
   * groups 가 없어 무엇이 나가는지 알 수 없다. 지금 뭐가 나가는지 모르는 것이
   * 예배 중에는 가장 위험하다.
   */

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
  /** 고른 찬양 항목의 곡 정보 — 언어 버튼을 흐리게 하고, 악보가 있는지 알린다 */
  const [songInfo, setSongInfo] = useState<{ id: number; available: string[]; hasSheet: boolean } | null>(null);

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

  // 항목을 슬라이드로 푸는 것은 usePlanPreview 로 옮겼다 (2026-09-07 R-4).
  // 송출하지 않는다 — 선택과 송출은 갈라져 있다.
  const { resolveItem, preview, previewError, styleTemplates } = usePlanPreview({
    items, expandedId, template,
  });

  /** 화면에 그릴 줄 목록 — 펼친 항목의 슬라이드가 그 아래에 들어간다 */
  const rows = buildPlanRows(items, expandedId, preview?.slides.length ?? 0);
  const currentRow = rows[Math.min(cursor, rows.length - 1)];
  /** 커서가 가리키는 항목 (슬라이드 줄이면 그 슬라이드의 항목) */
  const current = currentRow ? items[currentRow.itemIndex] : undefined;

  // ── 순서표 읽기·저장 ────────────────────────────────────────
  // usePlanStorage 로 옮겼다 (2026-09-07 R-4).
  // 여기가 사용자 데이터를 쓰는 길이다 — 잘못 덮어쓰면 지난주 순서가 사라진다.
  const {
    templates, saved, reload, openPlan, saveCurrent, duplicateCurrent,
    removeTemplate, removeSaved,
    nameBar, setNameBar, nameBarTarget, commitNameBar, nameInputRef,
    loadOpen, setLoadOpen, planNoun, planNounObj, saveLabel,
  } = usePlanStorage({
    draft,
    feedback: { setBusy, setError, setNotice },
    // 추가 바의 역본을 이 예배의 기본값에서 시작한다 —
    // 순서표 열기와 추가 바 사이에 실제로 있는 유일한 결합이다
    onOpened: (target) => {
      setAddPrimary(target.defaults?.bible?.primary ?? defaultTranslation);
      setAddSecondary(target.defaults?.bible?.secondary ?? []);
    },
  });

  // ── 항목을 슬라이드로 푼다 (선택했을 때 미리보기용) ──────────


  /**
   * 항목이 쓸 템플릿을 고르는 데 필요한 것들 (lib/plan-item-template.ts).
   *
   * **useMemo 로 고정한다** — 송출 함수들이 이걸 의존성으로 쓴다. 매 렌더마다
   * 새 객체가 나오면 그 함수들이 매번 새로 만들어져 고정의 뜻이 없어진다.
   */
  const templateChoice = useMemo(
    () => ({ defaults: plan?.defaults, styleTemplates, template }),
    [plan?.defaults, styleTemplates, template],
  );
  const templateIdFor = useCallback(
    (item: CueItem) => pickTemplateId(item, templateChoice),
    [templateChoice],
  );

  // ── 송출 ────────────────────────────────────────────────────
  // 화면으로 내보내는 것 전부는 usePlanSend 로 옮겼다 (2026-09-07 R-4).
  const {
    liveSlide, liveLabel, slideCount,
    sendItem, sendTitle, refreshLive, restoreBefore, startAuto, loadForService,
    before, auto, setAuto, liveItemId,
  } = usePlanSend({
    deck, currentIndex, connected, send, items, plan, resolveItem, templateChoice,
    feedback: { setBusy, setError, setNotice },
  });


  // 고른 항목이 찬양이면 그 곡의 언어와 **악보 유무**를 읽어 둔다
  const currentSongId = (() => {
    const item = items.find((i) => i.id === expandedId) ?? items[cursor];
    return item && item.type === 'song' ? item.songId : null;
  })();

  useEffect(() => {
    if (currentSongId === null) return;
    if (songInfo?.id === currentSongId) return;
    let alive = true;
    void api
      .song(currentSongId)
      .then((loaded) => {
        // 읽는 사이에 다른 항목으로 옮겼으면 버린다 — 늦게 온 응답이 덮지 않게
        if (alive) {
          setSongInfo({
            id: currentSongId,
            available: loaded.availableLangs,
            hasSheet: loaded.sheet !== undefined,
          });
        }
      })
      // 못 읽어도 순서표 작업은 계속돼야 한다 — 버튼이 흐려지지 않을 뿐이다
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [currentSongId, songInfo?.id]);

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
            {/*
              **지금 열어 둔 것**을 보여 준다 — 유형이든 저장된 순서든.
              전에는 유형만 담아서, 저장된 순서를 불러오면 이 칸이 '— 예배 유형 —' 로
              비어 무엇을 고치고 있는지 화면 어디에도 없었다 (2026-09-03 사용자 보고).
            */}
            <select
              className="grow"
              value={plan?.id ?? ''}
              onChange={(e) => {
                const id = Number(e.target.value);
                const found = templates.find((p) => p.id === id) ?? saved.find((p) => p.id === id);
                if (found) openPlan(found);
              }}
              title="지금 고치는 중인 예배 유형 또는 저장된 순서"
            >
              <option value="">— 예배 유형 —</option>
              <optgroup label="예배 유형 (매주 고쳐 쓰는 원본)">
                {templates.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </optgroup>
              {saved.length > 0 && (
                <optgroup label="저장된 순서 (회차)">
                  {saved.map((p) => (
                    <option key={p.id} value={p.id}>
                      {/* 이름에 이미 날짜가 들어 있으면 앞에 또 붙이지 않는다 */}
                      {p.serviceDate && !p.name.includes(p.serviceDate) ? `${p.serviceDate} · ` : ''}
                      {p.name}
                    </option>
                  ))}
                </optgroup>
              )}
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
              지금 연 것을 관리한다 — 복제·이름 바꾸기·삭제.
              전에는 유형에만 걸려 있었다. 저장된 순서를 열면 셋이 모두 회색이라,
              이름을 고칠 길이 없었다 — 사용자가 '제목을 정확히 찾아 저장하기 어렵다'
              고 한 것이 이것이다 (2026-09-03). 유형·순서 모두 같은 세 버튼으로 다룬다.
            */}
            <button
              type="button"
              onClick={() => void duplicateCurrent()}
              disabled={busy || !plan}
              title={`이 ${planNounObj} 복제합니다 (주일 1부 → 2부)`}
            >
              ⧉
            </button>
            <button
              type="button"
              onClick={() => {
                if (!plan) return;
                setLoadOpen(false);
                setNameBar({ kind: plan.kind ?? 'plan', value: plan.name, renameId: plan.id });
              }}
              disabled={busy || !plan}
              title={`이 ${planNoun}의 이름을 바꿉니다`}
            >
              ✎
            </button>
            <button
              type="button"
              className="del"
              onClick={() => void removeTemplate()}
              disabled={busy || !plan}
              title={`이 ${planNounObj} 지웁니다`}
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
                {/*
                  **열어 둔 것에 그대로 저장한다.** 유형이면 '템플릿 업데이트',
                  저장된 순서면 '저장하기' — 이름을 다시 치지 않는다.
                  전에는 저장된 순서에 이 버튼이 회색이라, 불러와 고친 것을 남기려면
                  '순서 저장하기' 로 긴 이름을 똑같이 맞혀 쳐야 했다 (2026-09-03).
                */}
                <button
                  type="button"
                  className="grow"
                  onClick={() => void saveCurrent()}
                  disabled={busy}
                  title={
                    plan.kind === 'template'
                      ? '지금 고친 내용을 이 유형의 원본으로 굳힙니다'
                      : `지금 고친 내용을 '${plan.name}' 에 그대로 저장합니다`
                  }
                >
                  {saveLabel}
                </button>
                <button
                  type="button"
                  className="grow"
                  onClick={() => {
                    setLoadOpen(false);
                    // 유형에서는 '이번 회차' 를 새로 만드는 것이니 날짜를 붙여 준다.
                    // 순서에서는 이미 그 회차라, 지금 이름에서 고쳐 쓰게 둔다.
                    setNameBar({
                      kind: 'plan',
                      value: plan.kind === 'template' ? `${today()} ${plan.name}` : plan.name,
                    });
                  }}
                  disabled={busy}
                  title={
                    plan.kind === 'template'
                      ? '이번 회차를 따로 남깁니다'
                      : '이 순서를 건드리지 않고 새 이름으로 하나 더 만듭니다'
                  }
                >
                  {plan.kind === 'template' ? '순서 저장하기' : '다른 이름으로 저장'}
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

                  {/*
                    **기본 설정에도 저장 버튼을 둔다.**

                    이 값들은 따로 저장되는 것이 아니라 **순서표 안에** 함께 담긴다
                    (`service_plans.defaults`). 그래서 저장하는 곳은 위의 버튼 하나뿐이다.
                    그런데 '저장하기 를 눌러야 남습니다' 만 적어 두면 그 버튼이 순서를
                    저장하는 것으로 보여, '기본 설정 저장 버튼은 어디 있나' 를 찾게 된다
                    (2026-09-03 사용자 보고). 같은 동작을 같은 이름으로 여기에도 둔다 —
                    설정을 만진 자리에서 그대로 누를 수 있어야 한다.
                  */}
                  <div className="row defaults-save">
                    <span className="hintline muted grow">
                      이 값들은 <b>순서표에 함께 담깁니다</b> — 따로 저장하는 곳은 없습니다.
                      {dirty
                        ? ' 아직 저장되지 않았습니다.'
                        : ` 지금은 '${plan.name}' 에 저장된 상태입니다.`}
                    </span>
                    <button
                      type="button"
                      className={dirty ? 'primary' : undefined}
                      onClick={() => void saveCurrent()}
                      disabled={busy}
                      title={`기본 설정과 순서를 함께 '${plan.name}' ${planNoun}에 저장합니다 (위의 버튼과 같습니다)`}
                    >
                      {saveLabel}
                    </button>
                  </div>
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
                placeholder={
                  nameBar.renameId !== undefined
                    ? `새 ${nameBar.kind === 'template' ? '유형' : '순서'} 이름`
                    : nameBar.kind === 'template'
                      ? '새 예배 유형 이름'
                      : '저장할 순서 이름'
                }
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
                ? `같은 이름의 ${nameBar.kind === 'template' ? '유형' : '순서'}가 이미 있습니다 — 다른 이름을 쓰세요.`
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
              {/*
                어디를 눌러야 하는지 여기서 말해 준다 — 버튼 이름이 열어 둔 것에 따라
                달라지기 때문이다. '저장 안 됨' 만 있으면 어느 버튼인지 매번 헷갈린다.
              */}
              <b>저장 안 됨</b> — <b>{saveLabel}</b> 를 누르면
              {' '}'{plan.name}' {planNoun}에 남습니다
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
          songInfo={songInfo}
          liveItemId={liveItemId}
          liveItemIndex={liveItemIndex}
          liveViaPlanDeck={liveViaPlanDeck}
          patchItems={patchItems}
          itemTemplateFor={(item) => itemTemplateFor(item, templateChoice)}
          baseFontSizeFor={(item, fallback) => baseFontSizeFor(item, fallback, templateChoice)}
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
