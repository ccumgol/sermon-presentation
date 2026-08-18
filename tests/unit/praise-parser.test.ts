/**
 * 복음성가집 파서 단위 테스트.
 *
 * 본문은 **직접 지어낸 것**을 쓴다 — 실제 가사는 저작물이고 리포지토리에 들어갈 수
 * 없다. 대신 실제 파일에서 확인한 **여섯 가지 표시 형태**를 모두 재현한다.
 */

import { describe, expect, it } from 'vitest';

import { parsePraiseBody, parsePraiseFilename, parsePraiseSong } from '../../lib/praise-parser.ts';

const labels = (text: string): string[] => parsePraiseBody(text).map((s) => s.label);
const lines = (text: string): string[][] =>
  parsePraiseBody(text).map((s) => s.lines.map((l) => l.text));

describe('파일 이름', () => {
  it('제목과 번호를 나눈다', () => {
    expect(parsePraiseFilename('가난한 영혼 - 705')).toEqual({ title: '가난한 영혼', number: 705 });
    expect(parsePraiseFilename('갈보리 - 295')).toEqual({ title: '갈보리', number: 295 });
  });

  /** 제목에 하이픈이 든 곡이 있다 — 앞에서부터 찾으면 제목이 잘린다 */
  it('마지막 하이픈만 번호로 본다', () => {
    expect(parsePraiseFilename('Above All - 그 무엇보다 - 1234')).toEqual({
      title: 'Above All - 그 무엇보다',
      number: 1234,
    });
  });

  it('공백이 흔들려도 읽는다', () => {
    expect(parsePraiseFilename('제목-12')?.number).toBe(12);
    expect(parsePraiseFilename('제목   -   12')?.number).toBe(12);
  });

  it('번호가 없으면 undefined — 조용히 0번으로 넣지 않는다', () => {
    for (const bad of ['번호없음', '제목 - ', '제목 - abc', ' - 12', '제목 - 0']) {
      expect(parsePraiseFilename(bad), bad).toBeUndefined();
    }
  });
});

describe('절 표시 여섯 가지', () => {
  it('숫자만 한 줄 (찬미예수 2000, 1071건)', () => {
    expect(labels('1\n가사 하나\n2\n가사 둘')).toEqual(['1절', '2절']);
    expect(lines('1\n가사 하나\n2\n가사 둘')).toEqual([['가사 하나'], ['가사 둘']]);
  });

  it('숫자. 뒤에 가사가 이어짐 (많은물소리, 487건)', () => {
    const text = '1.첫 절 첫 줄\n   이어지는 줄\n2. 둘째 절\n   또 이어짐';
    expect(labels(text)).toEqual(['1절', '2절']);
    // 표시는 떼고 가사만 남는다 — 들여쓰기도 없앤다
    expect(lines(text)).toEqual([
      ['첫 절 첫 줄', '이어지는 줄'],
      ['둘째 절', '또 이어짐'],
    ]);
  });

  it('(후렴)', () => {
    expect(labels('가사\n(후렴)\n후렴 가사')).toEqual(['1절', '후렴']);
    for (const mark of ['후렴', '(후렴)', '( 후렴 )', '(후 렴)', '(후렴)2', 'Chorus']) {
      expect(labels(`가사\n${mark}\n후렴 가사`), mark).toEqual(['1절', '후렴']);
    }
  });

  it('[라벨]', () => {
    expect(labels('[자매들]\n가사\n[형제들]\n가사')).toEqual(['자매들', '형제들']);
  });

  it('빈 줄', () => {
    expect(labels('가사 하나\n\n가사 둘')).toEqual(['1절', '2절']);
  });

  it('구분선은 가사가 아니다', () => {
    expect(lines('가사\n-----\n다음')).toEqual([['가사'], ['다음']]);
  });

  it('표시와 빈 줄이 겹쳐도 빈 섹션을 만들지 않는다', () => {
    // 찬미예수 2000 은 (후렴) 앞에 빈 줄이 있다
    expect(labels('1\n가사\n2\n가사\n\n(후렴)\n후렴 가사')).toEqual(['1절', '2절', '후렴']);
  });
});

describe('표시가 없으면 쪼개지 않는다', () => {
  /** 시와찬미 429곡이 그렇다 — 절 구분을 모르는데 나누면 엉뚱한 자리에서 끊긴다 */
  it('한 덩어리는 한 섹션', () => {
    const text = ['첫째 줄', '둘째 줄', '셋째 줄', '넷째 줄'].join('\n');
    const sections = parsePraiseBody(text);
    expect(sections).toHaveLength(1);
    expect(sections[0]!.label).toBe('1절');
    expect(sections[0]!.lines).toHaveLength(4);
  });
});

describe('섹션 종류', () => {
  it('후렴은 chorus 로 잡힌다', () => {
    const sections = parsePraiseBody('가사\n(후렴)\n후렴 가사');
    expect(sections.map((s) => s.kind)).toEqual(['verse', 'chorus']);
  });

  it('위치가 0부터 순서대로 붙는다', () => {
    const sections = parsePraiseBody('1\n가\n2\n나\n(후렴)\n다');
    expect(sections.map((s) => s.position)).toEqual([0, 1, 2]);
  });

  it('줄 번호가 섹션마다 0부터 시작한다', () => {
    const sections = parsePraiseBody('1\n가\n나\n2\n다');
    expect(sections[0]!.lines.map((l) => l.lineIndex)).toEqual([0, 1]);
    expect(sections[1]!.lines.map((l) => l.lineIndex)).toEqual([0]);
  });
});

describe('곡 하나', () => {
  it('이름과 본문을 합쳐 곡을 만든다', () => {
    const song = parsePraiseSong('가난한 영혼 - 705', '1\n가사 하나\n2\n가사 둘');
    expect(song).toMatchObject({ number: 705, title: '가난한 영혼' });
    expect(song!.sections).toHaveLength(2);
  });

  it('본문이 비면 undefined — 빈 곡을 넣지 않는다', () => {
    expect(parsePraiseSong('제목 - 1', '')).toBeUndefined();
    expect(parsePraiseSong('제목 - 1', '\n\n   \n')).toBeUndefined();
    // 표시만 있고 가사가 없어도 마찬가지
    expect(parsePraiseSong('제목 - 1', '1\n2\n(후렴)')).toBeUndefined();
  });

  it('이름이 잘못되면 undefined', () => {
    expect(parsePraiseSong('번호없음', '가사')).toBeUndefined();
  });
});
