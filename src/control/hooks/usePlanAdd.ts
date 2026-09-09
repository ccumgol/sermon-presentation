/**
 * **순서표에 항목을 넣는 것** — 예배 순서 탭의 추가 바.
 *
 * `PlanPanel` 에서 떼어냈다(2026-09-07 R-4). 열두 종류(성경·찬양·전례문·교독문·
 * 순서 표시·광고·인용구·그림 폴더·공백·구분)를 한 화면에서 넣는다 — 성경/찬양 탭을
 * 오가며 준비하는 것이 예배 중에 너무 느리기 때문이다(설계 근거는 `PLAN.md`).
 *
 * ## 지키는 것
 *
 * | | 왜 |
 * |---|---|
 * | 새 항목은 **고른 항목 바로 다음**에 | 순서를 짜는 자연스러운 방향이다 |
 * | 자리 계산은 `insertIndexFor` 가 | `cursor` 는 **줄** 번호라 그대로 쓰면 펼친 슬라이드 때문에 어긋나 맨 끝에 붙는다 |
 * | 여럿은 **한 번에** 넣는다 | `insertItem` 을 여러 번 부르면 두 번째가 첫 번째를 못 본다 |
 * | 검색은 디바운스한다 | 한 글자마다 서버를 부르면 예배 준비 중에 느려진다 |
 * | 참조는 넣기 **전에** 확인해 보여 준다 | 틀린 참조가 순서표에 들어가면 예배 중에 발견한다 |
 * | 종류를 바꾸면 입력칸에 **포커스를 돌려준다** | 입력 요소가 교체되므로 그 뒤에 줘야 한다 |
 */

import { useEffect, useRef, useState } from 'react';

import {
  buildPlanRows, insertIndexFor, newItemId, type PlanRow,
} from '../../../lib/plan-deck.ts';
import { songLabelOf, type AddKind } from '../../../lib/plan-item-view.ts';
import { DEFAULT_LITURGY_VERSION } from '../../../lib/liturgy-texts.ts';
import { verseQuotes } from '../../../lib/verse-quotes.ts';
import type { CueItem } from '../../../shared/types.ts';
import { api, ApiError, type ReadingBook, type ReadingSummary } from '../api.ts';
import type { PlanDraft } from './usePlanDraft.ts';

/**
 * 찬양 검색에서 한 번에 보여 줄 곡 수. '찬양' 탭(60)보다 적은 이유는
 * 추가 바 아래 한 줄짜리 후보 띠라서 30개 남짓이 두세 줄로 들어가는 한계다.
 */
const SONG_HIT_LIMIT = 30;

/** 화면에 알릴 것들 — 이 훅은 그 상태를 갖지 않고 부르는 쪽의 것을 쓴다 */
export interface AddFeedback {
  setBusy: (value: boolean) => void;
  setError: (value: string | null) => void;
  setNotice: (value: string | null) => void;
}

export interface PlanAddOptions {
  /** 편집 중인 것 (usePlanDraft) */
  draft: PlanDraft;
  /**
   * 화면에 그려진 줄 목록 — **넣을 자리를 여기서 센다.**
   * 항목 배열이 아니라 줄 목록이어야 한다 (펼친 슬라이드가 줄을 차지한다).
   */
  rows: readonly PlanRow[];
  /** 펼친 항목이 몇 장으로 풀렸는지 — 넣은 뒤 커서를 다시 셀 때 필요하다 */
  previewSlideCount: number;
  feedback: AddFeedback;
  /** 성경 항목의 기본 역본 (설정 탭에서 정한 것) */
  defaultTranslation: string;
}

/** `usePlanAdd` 가 내놓는 것. 화면 컴포넌트가 **이 객체째로** 받는다 —
 * 여기 담긴 것이 25개라, 낱개로 넘기면 프롭이 스물다섯이 된다 */
export type PlanAdd = ReturnType<typeof usePlanAdd>;

export function usePlanAdd(options: PlanAddOptions) {
  const {
    draft: { plan, items, cursor, setCursor, expandedId, patchItems },
    rows, previewSlideCount,
    feedback: { setBusy, setError, setNotice },
    defaultTranslation,
  } = options;

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
  /** 그림 폴더 항목을 만들 때 고른 폴더 (`source/folder`) */
  const [pickedFolder, setPickedFolder] = useState('');

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

  /** 입력칸 — 종류를 바꾸면 요소가 교체되므로 그 뒤에 포커스를 돌려준다 */
  const addRef = useRef<HTMLTextAreaElement & HTMLInputElement>(null);
  /** 종류 버튼을 눌러 입력창이 교체된 뒤에 포커스를 줘야 하는지 */
  const wantFocus = useRef(false);


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
    const nextRows = buildPlanRows(next, expandedId, previewSlideCount);
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
    const nextRows = buildPlanRows(guess, expandedId, previewSlideCount);
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
  return {
    /** 지금 고른 추가 종류 */
    addKind,
    /** 종류를 바꾼다 (입력을 비우고 포커스를 돌려준다) */
    pickKind,
    addInput, setAddInput,
    /** 참조를 입력받는 종류인지 — 성경(본문 낭독)과 인용구(절 낱개) */
    wantsRef,
    /** 참조 확인 결과 — 넣기 전에 보여 준다 */
    parseOk,
    /** 찬양 검색 결과와 전체 일치 수 */
    songHits, songTotal,
    /** 성경 항목에 쓸 역본 */
    addPrimary, setAddPrimary,
    addSecondary, setAddSecondary,
    /** 교독문 검색 */
    readingHits, readingBook, setReadingBook, readingCounts, readingTotal,
    /** 그림 폴더 고르기 */
    pickedFolder, setPickedFolder,
    /** 입력칸에 걸 ref */
    addRef,
    // ── 넣는 길들 ──
    /** 입력칸의 내용으로 넣는다 (종류에 따라 갈린다) */
    addFromInput,
    /** 항목 하나를 커서 다음에 넣는다 */
    insertItem,
    addText,
    addLiturgy,
    addReading,
    addSong,
    /** 나가 있는 인용구의 미리보기를 다시 읽는다 */
    refreshQuotePreview,
  };
}
