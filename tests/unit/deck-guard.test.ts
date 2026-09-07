/**
 * `deck:load` 의 모양·크기 검사 (보안 감사 L-1).
 *
 * 이 값은 그대로 `app.sqlite` 의 `live_state` 에 저장되고, 서버가 뜰 때마다
 * 읽힌다. 그래서 여기서 막는 것은 **크기와 겉모양**이다 — 슬라이드 내용은
 * 검사하지 않는다(종류가 계속 늘고, 출력 페이지가 모르는 종류를 안전하게 넘긴다).
 */

import { describe, expect, it } from 'vitest';

import { MAX_DECK_BYTES, MAX_SLIDES, checkDeck } from '../../lib/deck-guard.ts';

function deck(patch: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    reference: '요 3:16-17',
    slides: [{ kind: 'verse', lines: ['한 줄'] }],
    labels: ['3:16'],
    index: 0,
    ...patch,
  };
}

describe('정상 묶음은 통과한다 — 여기가 막히면 송출이 죽는다', () => {
  it('성경 묶음', () => {
    expect(checkDeck(deck()).ok).toBe(true);
  });

  it('예배 순서 묶음 (groups 가 있다)', () => {
    const result = checkDeck(deck({ groups: [{ label: '찬양', startIndex: 0, templateId: -1 }] }));
    expect(result.ok).toBe(true);
  });

  it('빈 묶음 — 비우기·복구 경로에서 실제로 온다', () => {
    expect(checkDeck(deck({ slides: [], labels: [], index: 0 })).ok).toBe(true);
  });

  it('시편 150편 크기 (실제 최대에 가깝다)', () => {
    const slides = Array.from({ length: 150 }, (_, i) => ({ kind: 'verse', lines: [`${i + 1}절`] }));
    expect(checkDeck(deck({ slides, labels: slides.map((_, i) => String(i + 1)) })).ok).toBe(true);
  });
});

describe('모양이 아니면 받지 않는다', () => {
  const bad: Array<[string, unknown]> = [
    ['객체가 아니다', 'deck'],
    ['null', null],
    ['배열', []],
    ['slides 가 배열이 아니다', deck({ slides: 'x' })],
    ['slides 안에 객체가 아닌 것', deck({ slides: ['글자'] })],
    ['labels 가 문자열 배열이 아니다', deck({ labels: [1, 2] })],
    ['index 가 정수가 아니다', deck({ index: 1.5 })],
    ['index 가 문자열', deck({ index: '0' })],
    ['reference 가 없다', deck({ reference: undefined })],
    ['groups 의 모양이 다르다', deck({ groups: [{ label: 1, startIndex: 0 }] })],
    ['groups 가 배열이 아니다', deck({ groups: {} })],
  ];

  for (const [label, value] of bad) {
    it(label, () => {
      const result = checkDeck(value);
      expect(result.ok).toBe(false);
      // 이유가 로그와 오류 메시지로 나간다 — 예배 전에 진단할 수 있어야 한다
      if (!result.ok) expect(result.error.length).toBeGreaterThan(3);
    });
  }
});

describe('크기를 막는다 — 상태 파일을 지키는 실제 방어막', () => {
  it('슬라이드가 너무 많으면 거부한다', () => {
    const slides = Array.from({ length: MAX_SLIDES + 1 }, () => ({ kind: 'verse' }));
    const result = checkDeck(deck({ slides, labels: [] }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('너무 많습니다');
  });

  it('슬라이드 수가 적어도 통째로 거대하면 거부한다', () => {
    // 한 장에 큰 글자를 담는 경우 — 개수 검사만으로는 못 막는다
    const huge = 'ㅁ'.repeat(MAX_DECK_BYTES);
    const result = checkDeck(deck({ slides: [{ kind: 'verse', lines: [huge] }] }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('너무 큽니다');
  });

  it('순환 참조는 거부한다 (직렬화할 수 없다)', () => {
    const circular: Record<string, unknown> = deck();
    (circular.slides as unknown[])[0] = circular;
    const result = checkDeck(circular);
    expect(result.ok).toBe(false);
  });
});
