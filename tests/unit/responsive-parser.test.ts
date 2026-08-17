/**
 * 교독문 파서 단위 테스트.
 *
 * 본문은 **직접 지어낸 것**을 쓴다 — 실제 파일(`~/Desktop/Data/교독문_개역개정.txt`)은
 * 개역개정 저작 본문이고 리포지토리에 들어가면 안 된다. 실제 파일과의 대조는
 * 가져오기 스크립트가 리포트로 보여 준다.
 */

import { describe, expect, it } from 'vitest';

import { parseResponsiveReadings, readingSlides } from '../../lib/responsive-parser.ts';

/** 실제 파일과 같은 모양 — 제목은 들여쓰기, 본문은 들여쓰기 없음, 구분은 U+200B */
const SAMPLE = [
  '                1. 첫째 교독문',
  '인도자가 읽는 첫 줄',
  '회중이 읽는 첫 줄',
  '인도자가 읽는 둘째 줄',
  '회중이 읽는 둘째 줄',
  '(다같이) 함께 읽는 마지막 줄 (1-6)',
  '​',
  '                2. 둘째 교독문',
  '인도자 줄',
  '회중 줄',
  '​',
].join('\n');

describe('파싱', () => {
  it('제목과 본문을 나눈다', () => {
    const { readings, problems } = parseResponsiveReadings(SAMPLE);
    expect(problems).toEqual([]);
    expect(readings.map((r) => [r.number, r.title])).toEqual([
      [1, '첫째 교독문'],
      [2, '둘째 교독문'],
    ]);
    expect(readings[0]!.lines).toHaveLength(5);
    expect(readings[1]!.lines).toEqual(['인도자 줄', '회중 줄']);
  });

  /** 눈에 보이지 않는데 줄을 비어 있지 않게 만든다 — 실제 파일에 78개 있다 */
  it('U+200B 만 있는 줄은 본문으로 세지 않는다', () => {
    const { readings } = parseResponsiveReadings(SAMPLE);
    expect(readings[0]!.lines.some((l) => l.length === 0)).toBe(false);
    expect(readings[1]!.lines).toHaveLength(2);
  });

  /**
   * 본문을 손대지 않는다 — 절기 교독문은 줄마다 성구 표기가 붙고,
   * 시편 교독문은 마지막에 절 범위가 붙는다. 주보에 그렇게 인쇄된다.
   */
  it('성구 표기·절 범위·(다같이) 를 떼지 않는다', () => {
    const { readings } = parseResponsiveReadings(
      ['                5. 성탄절', '주께서 오셨다 (사 9:6-7)', '기뻐하라 (눅 2:10-11)'].join('\n'),
    );
    expect(readings[0]!.lines).toEqual(['주께서 오셨다 (사 9:6-7)', '기뻐하라 (눅 2:10-11)']);
    expect(parseResponsiveReadings(SAMPLE).readings[0]!.lines[4]).toBe(
      '(다같이) 함께 읽는 마지막 줄 (1-6)',
    );
  });

  it('제목의 특이한 문자를 그대로 둔다', () => {
    // 실제 파일의 '3․1절' 은 마침표가 아니라 U+2024 다
    const { readings } = parseResponsiveReadings('                69. 3․1절\n한 줄');
    expect(readings[0]!.title).toBe('3․1절');
  });

  it('들여쓰기 없는 줄은 제목으로 보지 않는다', () => {
    // 실제 파일에 이런 줄은 없지만, 있어도 본문을 제목으로 잘라 먹으면 안 된다
    const { readings } = parseResponsiveReadings(
      ['                1. 제목', '1. 이것은 본문이다', '두 번째 줄'].join('\n'),
    );
    expect(readings).toHaveLength(1);
    expect(readings[0]!.lines).toEqual(['1. 이것은 본문이다', '두 번째 줄']);
  });
});

describe('문제를 조용히 넘기지 않는다', () => {
  it('본문 없는 제목을 알린다', () => {
    const { readings, problems } = parseResponsiveReadings(
      ['                1. 빈 것', '​', '                2. 있는 것', '한 줄'].join('\n'),
    );
    expect(readings.map((r) => r.number)).toEqual([2]);
    expect(problems.join(' ')).toContain('본문이 없어');
  });

  it('제목보다 앞에 나온 줄을 알린다', () => {
    const { problems } = parseResponsiveReadings(['머리말 같은 줄', '                1. 제목', '본문'].join('\n'));
    expect(problems.join(' ')).toContain('제목보다 앞에');
  });

  it('번호가 겹치면 알리고 뒤엣것을 쓴다', () => {
    const { readings, problems } = parseResponsiveReadings(
      ['                7. 앞', '앞 본문', '                7. 뒤', '뒤 본문'].join('\n'),
    );
    expect(readings).toHaveLength(1);
    expect(readings[0]!.title).toBe('뒤');
    expect(problems.join(' ')).toContain('두 번 나옵니다');
  });

  it('빈 파일은 빈 결과 — 던지지 않는다', () => {
    expect(parseResponsiveReadings('')).toEqual({ readings: [], problems: [] });
  });
});

describe('화면 묶기 — 한 화면에 두 줄', () => {
  it('인도자와 회중이 한 화면에 함께 나온다', () => {
    // 회중은 자기 차례 줄이 화면에 있어야 읽을 수 있다
    expect(readingSlides(['가', '나', '다', '라'])).toEqual([
      { leader: '가', people: '나' },
      { leader: '다', people: '라' },
    ]);
  });

  it('홀수면 마지막 다같이 줄이 혼자 한 화면을 쓴다', () => {
    expect(readingSlides(['가', '나', '(다같이) 다'])).toEqual([
      { leader: '가', people: '나' },
      { leader: '(다같이) 다' },
    ]);
  });

  it('한 줄뿐이면 한 화면', () => {
    expect(readingSlides(['혼자'])).toEqual([{ leader: '혼자' }]);
  });

  it('빈 본문은 빈 배열 — 빈 화면을 만들지 않는다', () => {
    expect(readingSlides([])).toEqual([]);
  });

  it('줄이 하나도 빠지지 않는다', () => {
    for (const n of [1, 2, 3, 8, 11, 12, 18]) {
      const lines = Array.from({ length: n }, (_, i) => `줄${i}`);
      const flat = readingSlides(lines).flatMap((s) => (s.people === undefined ? [s.leader] : [s.leader, s.people]));
      expect(flat, `${n}줄`).toEqual(lines);
    }
  });
});
