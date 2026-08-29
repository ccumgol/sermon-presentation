import { describe, expect, it } from 'vitest';

import { composeLyrics, toBlock } from '../../lib/lyrics-compose.ts';
import { parseLyrics } from '../../lib/lyrics-parser.ts';

const KO = '[1절]\n주 곁에 거하리\n주 품에 안기리';
const EN = "[1절]\nBy Your side I would stay,\nin Your arms I would lay.";

describe('두 칸을 하나로 합치기', () => {
  it('줄 번호로 짝지어 `|` 형식을 만든다', () => {
    const { text } = composeLyrics(KO, EN, 'en');
    expect(text).toBe(
      '[1절]\n주 곁에 거하리\n| By Your side I would stay,\n주 품에 안기리\n| in Your arms I would lay.',
    );
  });

  it('한국어만 있어도 된다', () => {
    const { text, problems } = composeLyrics(KO, '', 'en');
    expect(text).toBe('[1절]\n주 곁에 거하리\n주 품에 안기리');
    expect(problems).toEqual([]);
  });

  /* 한국어가 절 나눔과 줄 수를 정한다 — 그러지 않으면 저장할 때마다 결과가 달라진다 */
  it('영어가 남으면 버리지 않고 알린다', () => {
    const { text, problems, counts } = composeLyrics(KO, `${EN}\nextra line`, 'en');
    expect(problems).toEqual(['1절: 1줄이 남습니다 (한국어 2줄)']);
    expect(counts).toEqual([{ label: '1절', primary: 2, secondary: 3 }]);
    expect(text).not.toContain('extra line');
  });

  it('영어가 모자라면 그 줄만 비운다', () => {
    const { text, counts } = composeLyrics(KO, '[1절]\nBy Your side I would stay,', 'en');
    expect(text).toBe('[1절]\n주 곁에 거하리\n| By Your side I would stay,\n주 품에 안기리');
    expect(counts).toEqual([{ label: '1절', primary: 2, secondary: 1 }]);
  });

  it('절 이름이 다르면 순서로 짝짓는다', () => {
    const { text } = composeLyrics('[1절]\n가\n나', '[Verse 1]\nA\nB', 'en');
    expect(text).toBe('[1절]\n가\n| A\n나\n| B');
  });

  it('한국어에 없는 절이 영어에만 있으면 알린다', () => {
    const { problems } = composeLyrics(KO, `${EN}\n\n[2절]\nSecond verse`, 'en');
    expect(problems).toContain('2절: 한국어 쪽에 같은 절이 없습니다');
  });

  it('한국어 칸이 비면 알린다 — 조용히 가사를 지우지 않는다', () => {
    const { problems } = composeLyrics('', EN, 'en');
    expect(problems).toContain('한국어 칸이 비었습니다');
  });

  it('절 머리가 없으면 통째로 1절이다', () => {
    const { text } = composeLyrics('가\n나', 'A\nB', 'en');
    expect(text).toBe('[1절]\n가\n| A\n나\n| B');
  });

  /*
   * 곡에 세 언어가 있을 때 두 칸으로 편집하면 나머지 하나가 사라질 수 있다.
   * 원래 가사에서 뽑아 두었다가 줄 번호 그대로 되돌려 붙인다.
   */
  it('손대지 않은 언어를 지키지 않고 되살린다', () => {
    const original = '[1절]\n가\n| A\n|zh 甲\n나\n| B\n|zh 乙';
    const { text } = composeLyrics('[1절]\n가\n나', '[1절]\nA2\nB2', 'en', {
      text: original,
      langs: ['ko', 'en', 'zh'],
    });
    const section = parseLyrics(text)[0]!;
    const zh = section.lines.filter((l) => l.lang === 'zh').map((l) => l.text);
    expect(zh).toEqual(['甲', '乙']);
    expect(section.lines.filter((l) => l.lang === 'en').map((l) => l.text)).toEqual(['A2', 'B2']);
  });

  it('한국어 줄이 줄면 되살린 언어도 그만큼만 남는다', () => {
    const original = '[1절]\n가\n|zh 甲\n나\n|zh 乙';
    const { text } = composeLyrics('[1절]\n가', '', 'en', { text: original, langs: ['ko', 'zh'] });
    expect(text).toBe('[1절]\n가\n|zh 甲');
  });
});

describe('구조를 편집 칸 원문으로', () => {
  it('절 머리를 붙여 그 언어만 뽑는다', () => {
    const sections = parseLyrics('[1절]\n가\n| A\n나\n| B\n\n[후렴]\n다\n| C');
    expect(toBlock(sections, 'ko')).toBe('[1절]\n가\n나\n\n[후렴]\n다');
    expect(toBlock(sections, 'en')).toBe('[1절]\nA\nB\n\n[후렴]\nC');
  });

  it('그 언어가 없는 절은 빈 절로 남는다 — 자리를 지킨다', () => {
    const sections = parseLyrics('[1절]\n가\n| A\n\n[2절]\n나');
    expect(toBlock(sections, 'en')).toBe('[1절]\nA\n\n[2절]\n');
  });
});
