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
      return item.ref;
    case 'song':
      return item.songTitle;
    case 'text':
      return item.content.split(/\r?\n/)[0]?.slice(0, 24) ?? '텍스트';
    case 'liturgy':
      return findLiturgy(item.textId)?.title ?? '본문';
    case 'media':
      return item.src;
    case 'divider':
      return item.label;
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
 * 첫 줄이 순서 이름, **나머지 줄을 합친 것**이 담당자다. 담당자를 여러 줄로 적는
 * 경우(직분과 이름을 나눠 쓰는 등)를 한 줄로 합쳐야 오른쪽 자리에 들어간다.
 * 빈 줄은 버린다 — 마지막에 Enter 를 한 번 더 쳐서 생긴 빈 담당자가 밑줄만
 * 덩그러니 남기는 것을 막는다.
 */
export function splitOrderText(content: string): { title: string; presenter?: string } {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const [title = '', ...rest] = lines;
  const presenter = rest.join(' ');
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
  return item.type === 'bible' || item.type === 'song' || item.type === 'liturgy';
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

/**
 * 자동 진행(예배 전 안내)에서 이 슬라이드가 머무는 시간.
 *
 * 기본은 구분에 설정한 시간이지만, **그림·동영상 한 장은 따로 정할 수 있다** —
 * 40초짜리 안내 동영상이 8초에 잘리면 안 되기 때문이다.
 *
 * `0` 이나 음수는 '정하지 않음' 으로 본다. 그대로 쓰면 타이머가 즉시 터져
 * 화면이 미친 듯이 넘어간다.
 */
export function holdMsFor(slide: SlidePayload | undefined, dividerHoldMs: number): number {
  if (slide?.kind === 'media' && typeof slide.holdMs === 'number' && slide.holdMs > 0) {
    return slide.holdMs;
  }
  return dividerHoldMs;
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
