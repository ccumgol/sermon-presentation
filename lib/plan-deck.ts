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

    // 경계는 슬라이드를 담기 **전에** 기록해야 시작 위치가 맞는다
    groups.push({ label: describeItem(item), startIndex: slides.length });

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
