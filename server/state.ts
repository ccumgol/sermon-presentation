/**
 * 송출 상태의 단일 진실 공급원 (Live State Store).
 *
 * 이 모듈이 지켜야 하는 두 가지가 예배 안정성의 핵심이다:
 *
 *  1. **revision 은 단조 증가한다.** 다음/이전을 빠르게 연타해 메시지 순서가
 *     뒤바뀌어도 출력 페이지가 옛 메시지를 버릴 수 있다.
 *  2. **모든 변경을 즉시 디스크에 남긴다.** 예배 중 서버가 죽어도 재시작하면
 *     마지막 화면으로 복구된다.
 */

import { DEFAULT_TEMPLATE_ID } from '../lib/template-presets.ts';
import type { Deck, LiveState, SlidePayload } from '../shared/types.ts';
import { getJsonSetting, setJsonSetting } from './db/app.ts';

const STATE_KEY = 'live_state';

/** 디스크에 남기는 형태 — 복구에 필요한 전부 */
interface PersistedState {
  state: LiveState;
  deck: Deck | null;
  /** 블랙 해제 시 되돌릴 슬라이드 */
  lastSlide: SlidePayload | null;
}

const INITIAL: PersistedState = {
  state: { slide: null, blank: false, templateId: DEFAULT_TEMPLATE_ID, revision: 0, cursor: null },
  deck: null,
  lastSlide: null,
};

type Listener = (state: LiveState, deck: Deck | null) => void;

let current: PersistedState = INITIAL;
const listeners = new Set<Listener>();

/** 기동 시 디스크에서 복구. 실패해도 초기 상태로 계속 진행한다. */
export function initState(): { restored: boolean; corrupt: boolean } {
  const { value, corrupt } = getJsonSetting<PersistedState | null>(STATE_KEY, null);

  if (value && value.state && typeof value.state.revision === 'number') {
    current = {
      state: { ...value.state },
      deck: value.deck ?? null,
      lastSlide: value.lastSlide ?? null,
    };
    return { restored: true, corrupt };
  }

  current = { ...INITIAL, state: { ...INITIAL.state } };
  return { restored: false, corrupt };
}

export function getState(): LiveState {
  return current.state;
}

export function getDeck(): Deck | null {
  return current.deck;
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** commit 에 넘기는 변경분. state 는 부분 갱신이 가능하다. */
interface CommitInput {
  state?: Partial<LiveState>;
  deck?: Deck | null;
  lastSlide?: SlidePayload | null;
}

/**
 * 상태를 갱신한다. 불변 패턴으로 새 객체를 만들고 revision 을 올린다.
 * 저장 실패가 송출을 막아서는 안 되므로 예외를 삼키고 계속 진행한다.
 */
function commit(next: CommitInput): void {
  const state: LiveState = {
    ...current.state,
    ...(next.state ?? {}),
    revision: current.state.revision + 1,
  };

  current = {
    state,
    deck: next.deck !== undefined ? next.deck : current.deck,
    lastSlide: next.lastSlide !== undefined ? next.lastSlide : current.lastSlide,
  };

  try {
    setJsonSetting(STATE_KEY, current);
  } catch {
    // 디스크 저장 실패는 복구 능력만 잃는다. 송출은 계속되어야 한다.
  }

  for (const listener of listeners) listener(current.state, current.deck);
}

// ─────────────────────────────────────────────────────────────
// 조작
// ─────────────────────────────────────────────────────────────

/** 단일 슬라이드를 즉시 송출한다. 기존 묶음은 버린다. */
export function show(payload: SlidePayload): void {
  commit({
    state: { slide: payload, blank: false, cursor: null },
    deck: null,
    lastSlide: payload,
  });
}

/** 슬라이드 묶음을 올리고 지정 위치를 송출한다. */
export function loadDeck(deck: Deck): void {
  const index = clampIndex(deck.index, deck.slides.length);
  const slide = deck.slides[index] ?? null;

  commit({
    state: {
      slide,
      blank: false,
      cursor: { planItemIndex: 0, slideIndex: index },
    },
    deck: { ...deck, index },
    ...(slide ? { lastSlide: slide } : {}),
  });
}

function clampIndex(index: number, length: number): number {
  if (length === 0) return 0;
  if (!Number.isInteger(index)) return 0;
  return Math.min(Math.max(index, 0), length - 1);
}

/** 묶음 안에서 이동. 끝을 넘어가면 아무 일도 하지 않는다(순환하지 않음). */
export function goto(index: number): boolean {
  const deck = current.deck;
  if (!deck || deck.slides.length === 0) return false;

  const next = clampIndex(index, deck.slides.length);
  if (next === deck.index && current.state.slide !== null && !current.state.blank) return false;

  const slide = deck.slides[next]!;
  commit({
    state: {
      slide,
      blank: false,
      cursor: { planItemIndex: 0, slideIndex: next },
    },
    deck: { ...deck, index: next },
    lastSlide: slide,
  });
  return true;
}

export function next(): boolean {
  const deck = current.deck;
  if (!deck) return false;
  if (deck.index >= deck.slides.length - 1) return false;
  return goto(deck.index + 1);
}

/**
 * 예배 순서 항목 단위 이동 (PgDn/PgUp).
 *
 * 항목 경계가 없는 덱(단일 본문 조회)에서는 처음/끝으로 간다 —
 * 아무 일도 일어나지 않는 것보다 예측 가능하다.
 */
export function gotoGroup(direction: 1 | -1): boolean {
  const deck = current.deck;
  if (!deck || deck.slides.length === 0) return false;

  const groups = deck.groups;
  if (!groups || groups.length === 0) {
    return goto(direction === 1 ? deck.slides.length - 1 : 0);
  }

  // 현재 위치가 속한 항목을 찾는다
  let currentGroup = 0;
  for (const [index, group] of groups.entries()) {
    if (group.startIndex <= deck.index) currentGroup = index;
  }

  if (direction === 1) {
    // 항목 중간이면 그 항목의 끝이 아니라 다음 항목의 시작으로 간다
    const target = groups[currentGroup + 1];
    if (!target) return false;
    return goto(target.startIndex);
  }

  // 항목 중간에서 PgUp 은 그 항목의 처음으로, 처음에 있으면 이전 항목으로
  const atStart = groups[currentGroup]!.startIndex === deck.index;
  const target = atStart ? groups[currentGroup - 1] : groups[currentGroup];
  if (!target) return false;
  return goto(target.startIndex);
}

/** 현재 위치의 항목 정보 — 컨트롤 패널 표시용 */
export function currentGroup(): { index: number; total: number; label: string } | null {
  const deck = current.deck;
  if (!deck?.groups || deck.groups.length === 0) return null;

  let found = 0;
  for (const [index, group] of deck.groups.entries()) {
    if (group.startIndex <= deck.index) found = index;
  }
  return { index: found, total: deck.groups.length, label: deck.groups[found]!.label };
}

export function prev(): boolean {
  const deck = current.deck;
  if (!deck) return false;
  if (deck.index <= 0) return false;
  return goto(deck.index - 1);
}

/**
 * 블랙(숨김). 슬라이드는 그대로 두고 표시만 끈다 —
 * 상태를 잃지 않으므로 복구가 즉시 이뤄진다.
 */
export function setBlank(on: boolean): void {
  if (current.state.blank === on) return;
  commit({ state: { blank: on } });
}

/** Esc — 블랙을 풀고 마지막 슬라이드로 되돌린다. */
export function restore(): void {
  const slide = current.state.slide ?? current.lastSlide;
  commit({
    state: { slide, blank: false },
    ...(slide ? { lastSlide: slide } : {}),
  });
}

/** 화면을 비운다. lastSlide 는 남겨 Esc 로 되돌릴 수 있게 한다. */
export function clear(): void {
  commit({ state: { slide: null, blank: false, cursor: null }, deck: null });
}

export function setTemplate(id: number): void {
  if (current.state.templateId === id) return;
  commit({ state: { templateId: id } });
}

/** 테스트용 — 메모리 상태만 초기화한다 (디스크는 건드리지 않음) */
export function resetStateForTest(): void {
  current = { ...INITIAL, state: { ...INITIAL.state } };
  listeners.clear();
}
