/**
 * 가사 비교 격자 — 줄마다 언어를 모아 보여 주는 모델.
 *
 * ## 왜 격자인가
 *
 * 찬양에는 성경의 `장:절` 같은 **외부 기준이 없다.** `line_index 0` 이 무엇인지
 * 정해 주는 권위가 없어 언어별 줄 수가 어긋날 수 있다 (새찬송가 1장: 한국어 2줄,
 * 영어 원문 4줄). 그래서 사람이 눈으로 맞춰야 하고, 그 판단을 도우려면
 * **같은 줄의 여러 언어가 붙어 있어야** 한다.
 *
 * 열(언어)로 놓으면 편집 칸 479px 에 865px 이 필요해 좌우 스크롤이 생긴다(실측).
 * 그래서 **줄로 묶고 언어를 행으로** 놓는다 — 각 언어가 전체 폭을 쓴다.
 *
 * 본문은 지어낸 것을 쓴다 (실제 가사는 저작물).
 */

import { describe, expect, it } from 'vitest';

import { buildGrid, removeLang, setCell } from '../../lib/lyrics-grid.ts';
import type { ParsedSection } from '../../lib/lyrics-parser.ts';

const SECTIONS: ParsedSection[] = [
  {
    kind: 'verse',
    label: '1절',
    lines: [
      { lineIndex: 0, lang: 'ko', text: '한국어 첫 줄' },
      { lineIndex: 0, lang: 'en', text: 'English first' },
      { lineIndex: 1, lang: 'ko', text: '한국어 둘째 줄' },
      // 1번 줄에는 영어가 없다 — 어긋난 자리
    ],
  },
  {
    kind: 'verse',
    label: '2절',
    lines: [{ lineIndex: 0, lang: 'ko', text: '둘째 절' }],
  },
];

describe('격자 만들기', () => {
  it('줄마다 고른 언어를 모아 놓는다', () => {
    const grid = buildGrid(SECTIONS, ['ko', 'en']);

    expect(grid[0]!.label).toBe('1절');
    expect(grid[0]!.rows).toEqual([
      {
        lineIndex: 0,
        cells: [
          { lang: 'ko', text: '한국어 첫 줄' },
          { lang: 'en', text: 'English first' },
        ],
      },
      {
        lineIndex: 1,
        cells: [
          { lang: 'ko', text: '한국어 둘째 줄' },
          // 없는 줄은 **빠뜨리지 않고** null 로 남긴다 — 그래야 화면에 경고가 뜬다
          { lang: 'en', text: null },
        ],
      },
    ]);
  });

  it('고른 언어 순서대로 담는다 — 화면 위아래 순서가 된다', () => {
    const grid = buildGrid(SECTIONS, ['en', 'ko']);
    expect(grid[0]!.rows[0]!.cells.map((c) => c.lang)).toEqual(['en', 'ko']);
  });

  it('아직 없는 언어를 골라도 칸을 만들어 준다 — 넣을 자리가 보여야 넣는다', () => {
    const grid = buildGrid(SECTIONS, ['ko', 'zh']);
    expect(grid[0]!.rows[0]!.cells).toEqual([
      { lang: 'ko', text: '한국어 첫 줄' },
      { lang: 'zh', text: null },
    ]);
  });

  it('절마다 언어별 줄 수를 센다 — 절 단위로 먼저 어긋남을 알린다', () => {
    const grid = buildGrid(SECTIONS, ['ko', 'en']);
    expect(grid[0]!.counts).toEqual({ ko: 2, en: 1 });
    expect(grid[1]!.counts).toEqual({ ko: 1, en: 0 });
  });

  it('어긋난 절을 표시한다', () => {
    const grid = buildGrid(SECTIONS, ['ko', 'en']);
    expect(grid[0]!.uneven).toBe(true);
    // 2절은 영어가 아예 없다 — '어긋남' 이 아니라 '아직 안 넣음' 이다
    expect(grid[1]!.uneven).toBe(false);
  });

  it('어느 언어에도 줄이 없는 절은 빈 행을 만들지 않는다', () => {
    const grid = buildGrid([{ kind: 'verse', label: '빈 절', lines: [] }], ['ko']);
    expect(grid[0]!.rows).toEqual([]);
  });
});

describe('칸 고치기', () => {
  it('있는 줄의 글을 바꾼다', () => {
    const next = setCell(SECTIONS, 0, 0, 'en', 'Changed');
    const line = next[0]!.lines.find((l) => l.lineIndex === 0 && l.lang === 'en');
    expect(line!.text).toBe('Changed');
  });

  it('없던 줄에 글을 넣으면 새로 만든다', () => {
    const next = setCell(SECTIONS, 0, 1, 'en', 'Added');
    expect(next[0]!.lines).toContainEqual({ lineIndex: 1, lang: 'en', text: 'Added' });
  });

  it('빈 글로 바꾸면 그 줄을 **지운다** — 빈 줄이 화면에 나가지 않게', () => {
    const next = setCell(SECTIONS, 0, 0, 'en', '   ');
    expect(next[0]!.lines.some((l) => l.lang === 'en')).toBe(false);
  });

  it('주 언어 줄도 고칠 수 있다 — 사람이 직접 고르는 일이다', () => {
    const next = setCell(SECTIONS, 0, 0, 'ko', '고친 한국어');
    // 배열 위치는 계약이 아니다 (formatLyrics 도 언어로 찾는다). 언어로 확인한다
    const line = next[0]!.lines.find((l) => l.lineIndex === 0 && l.lang === 'ko');
    expect(line!.text).toBe('고친 한국어');
    expect(next[0]!.lines).toHaveLength(3);
  });

  it('다른 절·다른 줄을 건드리지 않는다', () => {
    const next = setCell(SECTIONS, 0, 0, 'en', 'Changed');
    expect(next[1]).toEqual(SECTIONS[1]);
    expect(next[0]!.lines.find((l) => l.lineIndex === 1 && l.lang === 'ko')!.text).toBe(
      '한국어 둘째 줄',
    );
  });

  it('원래 배열을 고치지 않는다', () => {
    const before = JSON.stringify(SECTIONS);
    setCell(SECTIONS, 0, 0, 'en', 'Changed');
    expect(JSON.stringify(SECTIONS)).toBe(before);
  });

  it('없는 절 번호를 주면 그대로 돌려준다 — 던지지 않는다', () => {
    expect(setCell(SECTIONS, 9, 0, 'en', 'x')).toEqual(SECTIONS);
  });
});

describe('언어 지우기', () => {
  it('그 언어의 줄만 모두 지운다', () => {
    const next = removeLang(SECTIONS, 'en');
    expect(next.every((s) => s.lines.every((l) => l.lang !== 'en'))).toBe(true);
    // 한국어는 그대로
    expect(next[0]!.lines).toHaveLength(2);
  });

  it('원래 배열을 고치지 않는다', () => {
    const before = JSON.stringify(SECTIONS);
    removeLang(SECTIONS, 'en');
    expect(JSON.stringify(SECTIONS)).toBe(before);
  });
});
