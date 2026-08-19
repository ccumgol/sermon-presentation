/**
 * 영어 가사 붙이기 — 기존 한국어 줄에 영어를 짝지어 끼운다.
 *
 * 본문은 **지어낸 것**을 쓴다. 실제 찬양 가사는 저작물이라 리포지토리에 들어갈 수
 * 없고, 여기서 확인하는 것은 짝을 맞추는 규칙과 경계다 (교독문 테스트와 같은 원칙).
 *
 * 핵심 요구는 셋이다.
 *  1. 한국어를 **한 글자도 고치지 않는다** — 사람이 승인한 글이다.
 *  2. 영어를 **조용히 버리지 않는다** — 남으면 반드시 알린다.
 *  3. 결과는 **제안**이다 — 편집 칸에 채워 주고 저장은 사람이 누른다.
 */

import { describe, expect, it } from 'vitest';

import { mergeSecondaryLyrics } from '../../lib/lyrics-merge.ts';

const KOREAN = `[1절]
첫째 줄 한국어
둘째 줄 한국어

[2절]
셋째 줄 한국어
넷째 줄 한국어`;

describe('짝 맞추기', () => {
  it('절마다 순서대로 짝지어 | 줄로 끼운다', () => {
    const result = mergeSecondaryLyrics(KOREAN, `first line
second line

third line
fourth line`);

    expect(result.text).toBe(`[1절]
첫째 줄 한국어
| first line
둘째 줄 한국어
| second line

[2절]
셋째 줄 한국어
| third line
넷째 줄 한국어
| fourth line`);
  });

  it('한국어 본문을 한 글자도 고치지 않는다', () => {
    const result = mergeSecondaryLyrics(KOREAN, 'a\nb\n\nc\nd');
    const korean = result.text
      .split('\n')
      .filter((line) => line.length > 0 && !line.startsWith('|') && !line.startsWith('['));
    expect(korean).toEqual(['첫째 줄 한국어', '둘째 줄 한국어', '셋째 줄 한국어', '넷째 줄 한국어']);
  });

  it('절 구분을 [ ] 로 준 영어도 받는다 — 라벨이 맞는 절에 넣는다', () => {
    const result = mergeSecondaryLyrics(KOREAN, `[2절]
third line
fourth line

[1절]
first line
second line`);
    expect(result.text).toContain('첫째 줄 한국어\n| first line');
    expect(result.text).toContain('셋째 줄 한국어\n| third line');
  });
});

describe('수가 어긋날 때', () => {
  it('영어가 모자라면 남은 한국어 줄은 그대로 둔다 (§2.3)', () => {
    const result = mergeSecondaryLyrics(KOREAN, 'first line\n\nthird line');
    expect(result.text).toContain('첫째 줄 한국어\n| first line');
    // 짝이 없는 줄은 한국어만 — 화면에서는 그 줄만 한 언어로 나간다
    expect(result.text).toContain('둘째 줄 한국어\n\n[2절]');
    expect(result.problems.join(' ')).toContain('1절');
  });

  it('영어가 남으면 버리지 않고 알린다', () => {
    const result = mergeSecondaryLyrics(KOREAN, 'a\nb\nc extra\n\nd\ne');
    expect(result.problems.join(' ')).toContain('c extra');
    // 넘친 줄이 조용히 사라지지 않았다는 것을 못박는다
    expect(result.dropped).toEqual(['c extra']);
  });

  it('영어 절이 한국어 절보다 많으면 알린다', () => {
    const result = mergeSecondaryLyrics(KOREAN, 'a\nb\n\nc\nd\n\ne\nf');
    expect(result.problems.join(' ')).toContain('번역 절이 1개 더 있습니다');
    expect(result.dropped).toEqual(['e', 'f']);
  });
});

describe('이미 영어가 있을 때', () => {
  it('있던 | 줄을 새 것으로 갈아 끼운다 — 두 벌이 쌓이지 않는다', () => {
    const withEnglish = `[1절]
첫째 줄 한국어
| old english
둘째 줄 한국어`;
    const result = mergeSecondaryLyrics(withEnglish, 'new english\nsecond new');
    expect(result.text).not.toContain('old english');
    expect(result.text).toContain('| new english');
    expect(result.replaced).toBe(1);
  });
});

describe('경계', () => {
  it('영어가 비면 원본을 그대로 돌려주고 아무것도 하지 않는다', () => {
    const result = mergeSecondaryLyrics(KOREAN, '   \n\n  ');
    expect(result.text).toBe(KOREAN);
    expect(result.paired).toBe(0);
  });

  it('한국어가 비면 영어를 전부 남김으로 알린다 — 넣을 자리가 없다', () => {
    const result = mergeSecondaryLyrics('', 'a\nb');
    expect(result.paired).toBe(0);
    expect(result.dropped).toEqual(['a', 'b']);
  });

  it('짝지은 줄 수를 알려 준다 — 눈으로 확인할 근거', () => {
    const result = mergeSecondaryLyrics(KOREAN, 'a\nb\n\nc\nd');
    expect(result.paired).toBe(4);
    expect(result.problems).toEqual([]);
  });

  it('빈 줄이 여럿이어도 절 하나로 본다', () => {
    const result = mergeSecondaryLyrics(KOREAN, 'a\nb\n\n\n\nc\nd');
    expect(result.paired).toBe(4);
  });
});

describe('언어가 셋 이상일 때', () => {
  const KO_EN = `[1절]
한국어 첫 줄
|en English first
한국어 둘째 줄
|en English second`;

  it('다른 언어를 붙일 때 **있던 언어를 지우지 않는다**', () => {
    const result = mergeSecondaryLyrics(KO_EN, '中文 一\n中文 二', 'zh');
    // 이것이 고장났던 자리다 — 中文 을 붙이면 English 가 사라졌다
    expect(result.text).toContain('|en English first');
    expect(result.text).toContain('|zh 中文 一');
    expect(result.replaced).toBe(0);
  });

  it('같은 언어를 다시 붙이면 그 언어만 갈아 끼운다', () => {
    const result = mergeSecondaryLyrics(KO_EN, 'New first\nNew second', 'en');
    expect(result.text).not.toContain('English first');
    // 언어가 둘(ko·en)뿐이면 표를 붙이지 않는다 — 손으로 쓰기 쉬운 형태를 지킨다
    expect(result.text).toContain('| New first');
    expect(result.replaced).toBe(2);
  });

  it('언어를 지정하지 않으면 영어로 본다 — 지금까지 쓰던 대로', () => {
    const result = mergeSecondaryLyrics(KOREAN, 'a\nb\n\nc\nd');
    expect(result.text).toContain('| a');
  });

  it('세 언어가 된 뒤에는 모든 보조 줄에 표가 붙는다', () => {
    const three = mergeSecondaryLyrics(KO_EN, '中文 一\n中文 二', 'zh');
    // 표가 없으면 다시 읽을 때 어느 줄이 어느 언어인지 알 수 없다
    for (const line of three.text.split('\n').filter((l) => l.startsWith('|'))) {
      expect(line).toMatch(/^\|(en|zh) /);
    }
  });
});
