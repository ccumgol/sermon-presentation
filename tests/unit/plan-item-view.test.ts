/**
 * `lib/plan-item-view.ts` — PlanPanel 에서 떼어낸 보여 주기 규칙 (검토 R-4).
 *
 * 떼어낸 이유가 이것이다. 화면 안에 있을 때는 테스트할 수 없었다.
 */
import { describe, expect, it } from 'vitest';

import {
  itemIcon, itemMeta, slideSummary, songLabelOf, textVariantLabel, wrapsAtScale,
} from '../../lib/plan-item-view.ts';
import type { CueItem, SlidePayload, SongEntry } from '../../shared/types.ts';

const entry = (songbookName: string, number?: number): SongEntry =>
  ({ songbookId: 'sb1', songbookName, songbookShortLabel: songbookName, number });

describe('songLabelOf — 곡집·번호 표기', () => {
  it('번호가 있는 첫 수록만 쓴다', () => {
    expect(songLabelOf([entry('새찬송가', 305), entry('통일찬송가', 405)])).toBe('새찬송가 305장');
  });

  it('번호 없는 곡집만 있으면 표기하지 않는다', () => {
    expect(songLabelOf([entry('기타')])).toBeUndefined();
    expect(songLabelOf([])).toBeUndefined();
  });
});

describe('itemIcon — 목록에서 종류를 구별한다', () => {
  it('인용구는 성경 항목이어도 본문 낭독과 다른 아이콘', () => {
    expect(itemIcon({ type: 'bible', quote: true } as unknown as CueItem)).toBe('💬');
    expect(itemIcon({ type: 'bible' } as unknown as CueItem)).toBe('📖');
  });

  it('옛 자유 글자 인용구·순서 표시도 구별한다', () => {
    expect(itemIcon({ type: 'text', variant: 'quote' } as unknown as CueItem)).toBe('💬');
    expect(itemIcon({ type: 'text', variant: 'order' } as unknown as CueItem)).toBe('📋');
    expect(itemIcon({ type: 'text' } as unknown as CueItem)).toBe('📝');
  });
});

describe('slideSummary — 절 번호는 각 절 첫 장에만', () => {
  const slide = (sectionLabel: string, text: string): SlidePayload =>
    ({ kind: 'song', sectionLabel, lines: [[{ text }]] }) as unknown as SlidePayload;

  it('절의 첫 장에는 번호를 붙인다', () => {
    expect(slideSummary(slide('1절', '주 믿는 사람'))).toBe('1. 주 믿는 사람');
  });

  it('같은 절이 이어지는 장에는 붙이지 않는다', () => {
    const first = slide('1절', '주 믿는 사람');
    expect(slideSummary(slide('1절', '이 세상 모든'), first)).toBe('이 세상 모든');
  });

  it('절이 바뀌면 다시 붙인다', () => {
    const first = slide('1절', '주 믿는 사람');
    expect(slideSummary(slide('2절', '악한 마귀'), first)).toBe('2. 악한 마귀');
  });

  it('순서 표시는 담당자를 함께 보여 준다', () => {
    expect(slideSummary({ kind: 'order', title: '대표기도', presenter: '김집사' } as unknown as SlidePayload))
      .toBe('대표기도 — 김집사');
    expect(slideSummary({ kind: 'order', title: '축도' } as unknown as SlidePayload)).toBe('축도');
  });

  it('교독문은 인도자/회중을 함께 보여 준다', () => {
    expect(slideSummary({ kind: 'reading', leader: '인도자 줄', people: '회중 줄' } as unknown as SlidePayload))
      .toBe('인도자 줄 / 회중 줄');
  });

  it('모르는 종류는 (공백) — 화면을 비우지 않는다는 원칙과 같은 태도', () => {
    expect(slideSummary({ kind: 'blank' } as unknown as SlidePayload)).toBe('(공백)');
  });
});

describe('itemMeta — 한 줄 부가 설명', () => {
  it('성경은 보조 역본 개수를 붙인다', () => {
    expect(itemMeta({ type: 'bible', primary: 'nkrv', secondary: ['esv', 'niv'] } as unknown as CueItem))
      .toBe('nkrv +2');
    expect(itemMeta({ type: 'bible', primary: 'nkrv', secondary: [] } as unknown as CueItem)).toBe('nkrv');
  });

  it('순서 표시는 둘째 줄(설교자)을 함께 보여 준다', () => {
    expect(itemMeta({ type: 'text', variant: 'order', content: '설교 제목\n박목사' } as unknown as CueItem))
      .toBe('순서 표시 · 박목사');
    expect(itemMeta({ type: 'text', variant: 'order', content: '축도' } as unknown as CueItem)).toBe('순서 표시');
  });

  it('변형 이름', () => {
    expect(textVariantLabel('quote')).toBe('인용구');
    expect(textVariantLabel('order')).toBe('순서 표시');
    expect(textVariantLabel(undefined)).toBe('광고');
  });
});

describe('wrapsAtScale — 함께 읽는 본문이 감기면 호흡이 어긋난다', () => {
  it('명조는 고딕보다 넓어 더 빨리 감긴다', () => {
    const chars = 26, size = 84;
    expect(wrapsAtScale(chars, size, { font: 'sans', scale: 1 } as never)).toBe(false);
    expect(wrapsAtScale(chars, size, { font: 'serif', scale: 1 } as never)).toBe(true);
  });

  it('크기를 키우면 감긴다', () => {
    expect(wrapsAtScale(21, 84, { font: 'sans', scale: 1 } as never)).toBe(false);
    expect(wrapsAtScale(21, 84, { font: 'sans', scale: 1.4 } as never)).toBe(true);
  });

  it('줄이 없으면 감길 것도 없다', () => {
    expect(wrapsAtScale(0, 84, undefined)).toBe(false);
  });
});
