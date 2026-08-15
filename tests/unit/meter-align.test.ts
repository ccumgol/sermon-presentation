import { describe, expect, it } from 'vitest';

import { alignToMeter, alignVerses, splitToTarget } from '../../lib/meter-align.ts';

/** 실제 데이터로 확인한 곡들 — 새찬송가 원문(줄바꿈 없는 상태) */
const HYMN_256 = [
  '나의 죄 모두 지신 주님 십자가 모진 그 고통을 묵묵히 참고 당하셨네 그 은혜 어찌 보답할까',
  '흉악한 죄는 내가 짓고 고통은 주가 당했으니 나 어찌 감히 고개 들고 주 얼굴 뵐 수 있으리까',
  '눈물로 주께 아룁니다 그 피로 이 몸 사셨으니 충성된 종이 되게 하사 주 위해 살게 하옵소서',
];

describe('splitToTarget', () => {
  it('어절을 쪼개지 않는다', () => {
    const words = ['나의', '죄', '모두', '지신', '주님'];
    const split = splitToTarget(words, 2, 5)!;
    expect(split.flat()).toEqual(words);
  });

  it('목표 길이에 가깝게 나눈다', () => {
    // 12자를 2행으로 → 6자씩이 이상적
    const split = splitToTarget(['가나다', '라마바', '사아자', '차카타'], 2, 6)!;
    expect(split.map((line) => line.join('').length)).toEqual([6, 6]);
  });

  it('행 수가 어절 수보다 많으면 나눌 수 없다', () => {
    expect(splitToTarget(['하나', '둘'], 3, 2)).toBeNull();
  });

  it('요청한 행 수를 정확히 지킨다', () => {
    for (const count of [2, 3, 4]) {
      const split = splitToTarget(['가', '나', '다', '라', '마', '바'], count, 2)!;
      expect(split, `${count}행`).toHaveLength(count);
    }
  });
});

describe('alignVerses — 절 간 운율 정렬', () => {
  it('새256 의 세 절을 같은 구조로 나눈다', () => {
    const result = alignVerses(HYMN_256)!;

    expect(result.lineCount).toBe(4);
    expect(result.deviation).toBe(0);
    expect(result.confidence).toBe('high');
    // 모든 절의 모든 행이 9자 — 실제 악보의 운율과 맞는다
    for (const verse of result.verses) expect(verse.lengths).toEqual([9, 9, 9, 9]);
  });

  it('구를 끊지 않는다 (보고된 사고가 재현되지 않는다)', () => {
    const [first, second, third] = alignVerses(HYMN_256)!.verses;

    // '묵묵히 참고' 와 '당하셨네' 가 갈라지지 않는다
    expect(first!.lines).toContain('묵묵히 참고 당하셨네');
    // '고개' 와 '들고' 가 갈라지지 않는다
    expect(second!.lines).toContain('나 어찌 감히 고개 들고');
    // '이' 와 '몸' 이 갈라지지 않는다
    expect(third!.lines).toContain('그 피로 이 몸 사셨으니');
  });

  it('원문을 한 글자도 바꾸지 않는다', () => {
    const result = alignVerses(HYMN_256)!;
    result.verses.forEach((verse, index) => {
      expect(verse.lines.join(' ')).toBe(HYMN_256[index]);
    });
  });

  it('후보가 여럿이면 세밀한 쪽을 고른다', () => {
    // 정형 운율이라 2행(14자)·4행(7자)이 모두 완벽히 일치한다.
    // 짧은 행은 화면 단위로 다시 묶을 수 있으므로 4행이 낫다.
    const hymn305 = [
      '나 같은 죄인 살리신 주 은혜 놀라워 잃었던 생명 찾았고 광명을 얻었네',
      '큰 죄악에서 건지신 주 은혜 고마워 나 처음 믿은 그 시간 귀하고 귀하다',
      '이제껏 내가 산 것도 주님의 은혜라 또 나를 장차 본향에 인도해 주시리',
      '거기서 우리 영원히 주님의 은혜로 해처럼 밝게 살면서 주 찬양하리라',
    ];
    const result = alignVerses(hymn305)!;
    expect(result.lineCount).toBeGreaterThanOrEqual(4);
    expect(result.confidence).not.toBe('low');
  });

  it('절이 하나뿐이면 추측하지 않는다', () => {
    // 비교할 대상이 없다 — 원래대로 두고 사람에게 알린다
    expect(alignVerses(['혼자 있는 절 하나뿐이라 비교할 수 없다'])).toBeNull();
    expect(alignVerses([])).toBeNull();
  });

  it('빈 절이 섞이면 정렬하지 않는다', () => {
    expect(alignVerses(['가사가 있는 절이다', '   '])).toBeNull();
  });

  it('절마다 길이가 크게 다르면 신뢰도를 낮춘다', () => {
    const result = alignVerses([
      '짧은 절 하나 둘 셋 넷 다섯 여섯',
      '아주 훨씬 더 긴 절 하나 둘 셋 넷 다섯 여섯 일곱 여덟 아홉 열 열하나 열둘 열셋',
    ]);
    if (result) expect(result.confidence).toBe('low');
  });

  it('행 길이가 운율 범위를 벗어나면 후보에서 뺀다', () => {
    // 두 어절짜리 절 — 나누면 한 행이 너무 짧아진다
    expect(alignVerses(['가 나', '다 라'])).toBeNull();
  });
});

describe('alignToMeter — 후렴을 절의 운율에 맞춤', () => {
  it('목표 길이에 맞춰 행을 만든다', () => {
    const lines = alignToMeter('할렐루야 할렐루야 할렐루야 할렐루야', 9)!;
    expect(lines.join(' ')).toBe('할렐루야 할렐루야 할렐루야 할렐루야');
    expect(lines.length).toBeGreaterThanOrEqual(1);
  });

  it('목표보다 짧으면 한 행', () => {
    expect(alignToMeter('짧은 후렴', 20)).toEqual(['짧은 후렴']);
  });

  it('빈 텍스트는 null', () => {
    expect(alignToMeter('   ', 9)).toBeNull();
  });
});
