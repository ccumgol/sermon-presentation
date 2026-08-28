import { describe, expect, it } from 'vitest';

import { rebreakEnglish, verifySameWords } from '../../lib/lyrics-rebreak.ts';

/*
 * 표본은 전부 새찬송가에서 그대로 가져왔다 — 사람이 맞춰 둔 줄나눔이 정답이다.
 */
describe('영어를 한국어 줄에 맞춰 다시 끊기', () => {
  it('새 384장 1절 — 고정 폭으로 잘린 것을 악절로 되돌린다', () => {
    const korean = [
      '나의 갈 길 다 가도록',
      '예수 인도하시니',
      '내 주 안에 있는 긍휼',
      '어찌 의심하리요',
    ];
    const english = [
      'All the way my Savior leads me;',
      'What have I to ask beside? Can I',
      "doubt His tender mercy, Who thro'",
      'life has been my guide?',
    ];
    expect(rebreakEnglish({ english, korean })).toEqual([
      'All the way my Savior leads me;',
      'What have I to ask beside?',
      'Can I doubt His tender mercy,',
      "Who thro' life has been my guide?",
    ]);
  });

  it('이미 맞은 것은 그대로 둔다', () => {
    const korean = ['나 같은 죄인 살리신', '주 은혜 놀라워'];
    const english = ['Amazing grace! how sweet the sound!', 'That saved a wretch like me!'];
    expect(rebreakEnglish({ english, korean })).toEqual(english);
  });

  it('한 줄이면 통째로 잇는다', () => {
    expect(rebreakEnglish({ english: ['Hello', 'world'], korean: ['한 줄'] })).toEqual([
      'Hello world',
    ]);
  });

  /* 짐작해 빈 줄을 만들지 않는다 — 가사가 비면 예배 화면이 빈다 */
  it('낱말이 줄 수보다 적으면 나누지 않고 undefined 를 준다', () => {
    expect(rebreakEnglish({ english: ['One two'], korean: ['가', '나', '다'] })).toBeUndefined();
    expect(rebreakEnglish({ english: ['x'], korean: [] })).toBeUndefined();
  });

  it('낱말을 하나도 잃지 않는다', () => {
    const korean = ['가', '나', '다', '라'];
    const english = ['Alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu'];
    const out = rebreakEnglish({ english, korean })!;
    expect(out).toHaveLength(4);
    expect(verifySameWords(english, out)).toBe(true);
  });
});

describe('낱말 열 대조', () => {
  it('공백이 달라도 낱말이 같으면 통과한다', () => {
    expect(verifySameWords(['a b', 'c'], ['a', 'b c'])).toBe(true);
    expect(verifySameWords(['a  b'], ['a b'])).toBe(true);
  });

  it('낱말이 사라지면 잡는다', () => {
    expect(verifySameWords(['a b c'], ['a c'])).toBe(false);
  });

  it('차례가 바뀌면 잡는다', () => {
    expect(verifySameWords(['a b'], ['b a'])).toBe(false);
  });
});
