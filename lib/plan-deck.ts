/**
 * 예배 순서(CueItem[]) → 하나의 평평한 덱.
 *
 * 항목별로 따로 덱을 두지 않고 전부 이어붙이는 이유:
 *  - 기존 next/prev 가 그대로 동작한다 (항목 경계를 넘어가는 이동이 공짜로 된다)
 *  - 항목 경계를 groups 로 담아 두면 PgDn/PgUp 으로 항목 단위 점프가 된다
 *  - 예배 중 항목을 다시 해석하지 않으므로 조회 실패나 지연이 발생하지 않는다
 *
 * 항목을 덱으로 푸는 일(성경 조회·찬양 조회·실측 분할)은 호출하는 쪽이 넘긴다.
 * 그래서 이 모듈은 순수하고 테스트로 고정할 수 있다.
 */

import { findLiturgy } from './liturgy-texts.ts';
import type { CueItem, Deck, DeckGroup, SlidePayload } from '../shared/types.ts';

/** 항목 하나를 푼 결과 */
export interface ResolvedItem {
  slides: SlidePayload[];
  labels: string[];
  /** 풀지 못한 이유 (본문을 못 찾음, 곡이 삭제됨 등) */
  error?: string;
}

export type ItemResolver = (item: CueItem) => Promise<ResolvedItem>;

export interface PlanDeckResult {
  deck: Deck;
  /** 풀지 못한 항목 — 조용히 넘기지 않고 컨트롤 패널이 알린다 */
  failed: Array<{ item: CueItem; error: string }>;
}

/** 항목의 사람이 읽는 라벨 */
export function describeItem(item: CueItem): string {
  switch (item.type) {
    case 'bible':
      /*
       * 인용구는 참조 뒤에 본문을 붙인다 — `창 1:1 태초에 하나님이 천지를 창조하시니라`.
       * 절이 낱개로 흩어져 있으면 참조만 보고는 무슨 절인지 알 수 없다 (사용자 요청).
       * `preview` 는 항목이 담고 있는 짧은 라벨이다 (lib/verse-quotes.ts 참고).
       */
      return item.quote && item.preview ? `${item.ref} ${item.preview}` : item.ref;
    case 'song':
      return item.songTitle;
    case 'text':
      return item.content.split(/\r?\n/)[0]?.slice(0, 24) ?? '텍스트';
    case 'liturgy':
      return findLiturgy(item.textId)?.title ?? '본문';
    case 'reading': {
      // 새찬송가용만 밝힌다 — 통일이 기본이라 늘 적으면 줄이 길어진다
      const book = item.readingBook === 'hymn_new' ? '새 ' : '';
      return item.readingTitle
        ? `${book}교독문 ${item.readingNumber}. ${item.readingTitle}`
        : `${book}교독문 ${item.readingNumber}번`;
    }
    case 'divider':
      return item.label;
    case 'slideshow':
      /*
       * **아이콘을 붙이지 않는다.** 목록이 `ITEM_ICONS` 로 이미 붙인다 —
       * 여기서 또 넣으면 `🖼🖼 그림 폴더` 가 된다 (2026-08-30 화면에서 걸렸다).
       */
      return (
        item.label ??
        (item.folder.length > 0
          ? item.folder
          : item.source === 'data'
            ? '앱 폴더 전체'
            : '모아 둔 폴더 전체')
      );
    case 'blank':
      return '(공백)';
    default:
      return '항목';
  }
}

/**
 * 예배 순서를 덱으로 만든다.
 *
 * 풀지 못한 항목은 **건너뛰되 반드시 알린다.** 예배 중 순서가 조용히 하나 사라지는 것이
 * 가장 위험하므로, 실패 목록을 함께 돌려주고 컨트롤 패널이 배너로 띄운다.
 */
export async function buildPlanDeck(
  planName: string,
  items: readonly CueItem[],
  resolve: ItemResolver,
): Promise<PlanDeckResult> {
  const slides: SlidePayload[] = [];
  const labels: string[] = [];
  const groups: DeckGroup[] = [];
  const failed: Array<{ item: CueItem; error: string }> = [];

  for (const item of items) {
    // 구분(그룹 머리글)은 슬라이드를 만들지 않는다.
    //
    // resolve 에 넘기면 알 수 없는 종류로 떨어져 공백 슬라이드가 생기고,
    // 항목 경계(groups)에도 잡혀 PgDn 이 빈 화면으로 점프하게 된다.
    if (item.type === 'divider') continue;

    let resolved: ResolvedItem;
    try {
      resolved = await resolve(item);
    } catch (err) {
      failed.push({ item, error: err instanceof Error ? err.message : '항목을 불러오지 못했습니다' });
      continue;
    }

    if (resolved.error) {
      failed.push({ item, error: resolved.error });
      continue;
    }
    if (resolved.slides.length === 0) {
      failed.push({ item, error: '표시할 내용이 없습니다' });
      continue;
    }

    // 경계는 슬라이드를 담기 **전에** 기록해야 시작 위치가 맞는다.
    // 항목에 지정된 템플릿을 함께 실어, 진행 중 경계를 넘을 때 서버가 바꿔 준다.
    const templateId = 'templateId' in item ? item.templateId : undefined;
    groups.push({
      label: describeItem(item),
      startIndex: slides.length,
      ...(typeof templateId === 'number' ? { templateId } : {}),
    });

    for (const [index, slide] of resolved.slides.entries()) {
      slides.push(slide);
      labels.push(resolved.labels[index] ?? '');
    }
  }

  return {
    deck: { reference: planName, slides, labels, index: 0, groups },
    failed,
  };
}

/**
 * 순서 표시 내용을 '순서 이름'과 '담당자'로 나눈다.
 *
 * 첫 줄이 순서 이름, **나머지 줄이 담당자**다.
 *
 * ## 친 대로 줄이 나간다 (2026-09-12 사용자 요청)
 *
 * 전에는 나머지 줄을 **한 줄로 합쳤다**. 그래서 이름과 직분을 나눠 쳐도 화면에는
 * 한 줄로 붙어 나갔고, 길면 자리가 넘쳤다 —
 * '김애리 전도사 / MD연합여선교회 증경회장' 처럼.
 *
 * 이제 줄바꿈을 그대로 싣는다. 두 줄로 치면 두 줄로 나가고, 한 줄로 쳤는데 자리가
 * 모자라면 **글자를 줄여** 맞춘다 (`public/output/output.js` 의 `fitPresenterWidth`).
 * 어느 쪽이든 사람이 친 모습이 화면에 그대로 간다.
 *
 * 빈 줄은 버린다 — 마지막에 Enter 를 한 번 더 쳐서 생긴 빈 담당자가 밑줄만
 * 덩그러니 남기는 것을 막는다.
 */
export function splitOrderText(content: string): { title: string; presenter?: string } {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const [title = '', ...rest] = lines;
  const presenter = rest.join('\n');
  return presenter.length > 0 ? { title, presenter } : { title };
}

/**
 * 구분 하나가 거느리는 항목들 — 그 구분 **다음**부터 **다음 구분 전**까지.
 *
 * 예배 전 안내(자동 진행)가 이 범위를 덱으로 만든다. 구분을 경계로 삼으면
 * 순서표에 이미 보이는 구조를 그대로 쓰므로, 사용자가 따로 범위를 지정할 필요가 없다.
 */
export function itemsInGroup(items: readonly CueItem[], dividerId: string): CueItem[] {
  const start = items.findIndex((item) => item.id === dividerId);
  if (start < 0 || items[start]?.type !== 'divider') return [];

  const group: CueItem[] = [];
  for (const item of items.slice(start + 1)) {
    if (item.type === 'divider') break;
    group.push(item);
  }
  return group;
}

// ─────────────────────────────────────────────────────────────
// 한 열 목록 (예배 순서 화면)
// ─────────────────────────────────────────────────────────────

/**
 * 펼칠 수 있는 항목인가 — **여러 장이 나올 수 있는** 항목이다.
 *
 * 성경·찬양·주기도문/사도신경은 장수가 내용에 따라 달라지므로 펼쳐서 골라야 한다.
 * 광고·순서 표시·공백은 언제나 한 장이라, 그 줄이 곧 슬라이드다
 * (그래서 한 번 클릭으로 바로 송출한다).
 */
export function isExpandable(item: CueItem): boolean {
  /*
   * **인용구는 빼놓는다.** 절 하나 = 화면 하나이므로 펼칠 것이 없다.
   *
   * 펼칠 수 있게 두면 한 번 눌러 펼치고 그 안의 한 장을 또 눌러야 화면에 나간다.
   * '타이틀 없이 바로 나오면 좋겠다' 는 요청과 반대다 (2026-08-20).
   * 펼치기에서 빠지면 그 줄이 곧 슬라이드가 되어 **한 번 클릭으로 송출**된다 —
   * 광고·순서 표시와 같은 취급이고, 설교 중 인용에 맞는 동작이다.
   */
  if (item.type === 'bible' && item.quote) return false;

  /*
   * 슬라이드쇼는 펼칠 수 있다 — 폴더에 그림이 여럿이면 한 장씩 골라 띄울 일이 있다.
   * (한 장뿐이면 펼쳐도 한 줄이라 해가 없다.)
   */
  return (
    item.type === 'bible' ||
    item.type === 'song' ||
    item.type === 'liturgy' ||
    item.type === 'reading' ||
    item.type === 'slideshow'
  );
}

/** 목록의 한 줄 */
export type PlanRow =
  | { kind: 'divider'; itemIndex: number; itemId: string }
  | { kind: 'item'; itemIndex: number; itemId: string; expandable: boolean; expanded: boolean }
  | { kind: 'slide'; itemIndex: number; itemId: string; slideIndex: number };

/**
 * 항목 배열을 화면에 그릴 줄 목록으로 편다.
 *
 * 펼친 항목의 슬라이드가 그 항목 **바로 아래** 줄로 들어간다. 오른쪽 열을 없애고
 * 한 열로 합친 것이 이 구조다(3차 재설계). 커서는 이 줄 단위로 움직인다.
 */
export function buildPlanRows(
  items: readonly CueItem[],
  expandedId: string | null,
  expandedSlideCount: number,
): PlanRow[] {
  const rows: PlanRow[] = [];

  for (const [itemIndex, item] of items.entries()) {
    if (item.type === 'divider') {
      rows.push({ kind: 'divider', itemIndex, itemId: item.id });
      continue;
    }

    const expandable = isExpandable(item);
    const expanded = expandable && item.id === expandedId;
    rows.push({ kind: 'item', itemIndex, itemId: item.id, expandable, expanded });

    if (!expanded) continue;
    for (let slideIndex = 0; slideIndex < expandedSlideCount; slideIndex += 1) {
      rows.push({ kind: 'slide', itemIndex, itemId: item.id, slideIndex });
    }
  }

  return rows;
}

/**
 * 새 항목을 넣을 자리 — **고른 줄이 속한 항목 바로 다음.**
 *
 * `cursor` 는 **화면 줄** 번호다. 항목 번호가 아니다. 펼친 항목의 슬라이드가 줄로
 * 끼어들기 때문에 둘은 어긋난다:
 *
 * ```
 * 줄0  📖 요 3:16      ← 항목0 (펼침)
 * 줄1    슬라이드 1
 * 줄2    슬라이드 2
 * 줄3  🎵 찬송가       ← 항목1
 * ```
 *
 * 줄3(찬송가)에서 새 항목을 넣을 때 `cursor + 1 = 4` 를 항목 번호로 쓰면 항목이 2개뿐이라
 * **맨 끝**에 붙는다. 슬라이드 줄(줄1·줄2)에 커서가 있을 때도 마찬가지다.
 * 그래서 줄이 가리키는 `itemIndex` 를 봐야 한다 (2026-08-18 사용자 신고).
 *
 * 항목이 없으면 0. 커서가 어디를 가리키는지 알 수 없으면 맨 끝에 붙인다.
 */
export function insertIndexFor(
  rows: readonly PlanRow[],
  cursor: number,
  itemCount: number,
): number {
  if (itemCount === 0) return 0;
  const row = rows[Math.min(Math.max(cursor, 0), rows.length - 1)];
  if (!row) return itemCount;
  return Math.min(row.itemIndex + 1, itemCount);
}

/** 항목 배열에서 한 항목을 옮긴다 (불변 — 새 배열을 만든다) */
export function moveItem(items: readonly CueItem[], from: number, to: number): CueItem[] {
  if (from === to || from < 0 || from >= items.length) return [...items];
  const target = Math.min(Math.max(to, 0), items.length - 1);

  const next = [...items];
  const [moved] = next.splice(from, 1);
  if (moved) next.splice(target, 0, moved);
  return next;
}

export function removeItem(items: readonly CueItem[], id: string): CueItem[] {
  return items.filter((item) => item.id !== id);
}

/** 브라우저·서버 어디서든 쓸 수 있는 항목 id 발급 */
export function newItemId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `item-${crypto.randomUUID().slice(0, 8)}`;
  }
  // 구형 환경 대비 — 순서만 보장되면 충분하다
  fallbackCounter += 1;
  return `item-${fallbackCounter.toString(36)}`;
}

let fallbackCounter = 0;
