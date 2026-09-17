/**
 * **사용설명서** — 글 안의 강조를 가르는 부분과 내용의 앞뒤가 맞는지.
 *
 * ## 왜 검사하는가
 *
 * 설명서는 **틀려도 프로그램이 죽지 않는다.** 그래서 아무도 모르는 채 틀려 있기 쉽다.
 * 여기서 못 박는 것은 두 가지다.
 *
 * | | 왜 |
 * |---|---|
 * | 강조 기호를 **삼키지 않는다** | `2 * 3` 을 굵게로 읽어 별표를 먹으면 설명서가 거짓말을 한다 |
 * | 차례 열쇠가 **겹치지 않는다** | 겹치면 눌렀을 때 엉뚱한 장이 열린다 — 화면에서는 티가 안 난다 |
 *
 * 검색이 본문까지 본다는 것도 여기서 지킨다 — 막힌 사람이 손에 쥔 낱말은 대개
 * 제목이 아니라 **표 안의 한 마디**다.
 */

import { describe, expect, it } from 'vitest';

import { HELP_CHAPTERS, HELP_SECTIONS, parseInline, sectionText } from '../../src/control/help/index.ts';

describe('parseInline', () => {
  it('굵게와 코드를 가른다', () => {
    expect(parseInline('앞 **굵게** 뒤')).toEqual([
      { t: 'text', v: '앞 ' },
      { t: 'b', v: '굵게' },
      { t: 'text', v: ' 뒤' },
    ]);

    expect(parseInline('`npm run dist` 를 돌린다')).toEqual([
      { t: 'code', v: 'npm run dist' },
      { t: 'text', v: ' 를 돌린다' },
    ]);
  });

  it('한 줄에 여러 개가 있어도 순서대로 가른다', () => {
    expect(parseInline('**가** 와 `나` 와 **다**').map((token) => token.t)).toEqual([
      'b',
      'text',
      'code',
      'text',
      'b',
    ]);
  });

  it('짝이 안 맞는 별표는 글자 그대로 둔다', () => {
    // 삼켜 버리면 '2 3 4' 가 되어 뜻이 달라진다
    const text = '2 * 3 * 4 는 24 다';
    expect(parseInline(text)).toEqual([{ t: 'text', v: text }]);
  });

  it('코드 안의 별표는 강조가 아니다', () => {
    expect(parseInline('`a ** b`')).toEqual([{ t: 'code', v: 'a ** b' }]);
  });

  it('강조가 없으면 통째로 한 조각이다', () => {
    expect(parseInline('그냥 글')).toEqual([{ t: 'text', v: '그냥 글' }]);
  });

  it('빈 글도 한 조각을 돌려준다', () => {
    // 부르는 쪽이 빈 배열을 따로 다루지 않아도 되게
    expect(parseInline('')).toEqual([{ t: 'text', v: '' }]);
  });

  it('가른 조각을 다시 이으면 원래 글이다', () => {
    // 어떤 글이 와도 **잃는 글자가 없어야** 한다 — 강조 기호만 빠진다
    for (const raw of ['앞 **굵게** 뒤', '`코드`만', '**시작**과 끝', '아무 강조 없음']) {
      const joined = parseInline(raw)
        .map((token) => token.v)
        .join('');
      expect(joined).toBe(raw.replace(/\*\*/g, '').replace(/`/g, ''));
    }
  });
});

describe('설명서 내용', () => {
  it('장 열쇠가 겹치지 않는다', () => {
    const ids = HELP_SECTIONS.map((section) => section.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('모든 장에 제목·한 줄 설명·내용이 있다', () => {
    for (const section of HELP_SECTIONS) {
      expect(section.title.length, section.id).toBeGreaterThan(0);
      expect(section.summary.length, section.id).toBeGreaterThan(0);
      expect(section.blocks.length, section.id).toBeGreaterThan(0);
    }
  });

  it('표는 머리 칸 수와 줄 칸 수가 맞는다', () => {
    // 어긋나면 화면에서 칸이 밀려 엉뚱한 줄과 짝지어 읽힌다
    for (const section of HELP_SECTIONS) {
      for (const block of section.blocks) {
        if (block.t !== 'table') continue;
        for (const row of block.rows) {
          expect(row.length, `${section.id} 의 표`).toBe(block.head.length);
        }
      }
    }
  });

  it('검색용 글에 표 칸과 단축키까지 들어간다', () => {
    const keys = HELP_SECTIONS.find((section) => section.id === 'keys');
    expect(keys).toBeDefined();
    const text = sectionText(keys!);
    // 'B' 는 단축키 표 안에만 있고 제목에는 없다
    expect(text).toContain('블랙');
    expect(text).toContain('PgDn');
  });

  it('검색용 글에서 강조 기호를 뺀다', () => {
    // '**' 를 치는 사람은 없다 — 남겨 두면 '굵게' 로 못 찾는다
    for (const section of HELP_SECTIONS) {
      expect(sectionText(section), section.id).not.toMatch(/[*`]/);
    }
  });

  it('부(部)마다 장이 하나 이상 있다', () => {
    expect(HELP_CHAPTERS.length).toBeGreaterThan(0);
    for (const chapter of HELP_CHAPTERS) {
      expect(chapter.sections.length, chapter.id).toBeGreaterThan(0);
    }
  });

  it('예배를 준비하고 진행하는 데 필요한 장이 모두 있다', () => {
    // 사용자 요청의 핵심 — '실제로 예배를 준비하고 실행할 수 있게'
    const ids = new Set(HELP_SECTIONS.map((section) => section.id));
    for (const must of ['first-run', 'day-before', 'day-of', 'keys', 'plan', 'song', 'pack', 'song-input']) {
      expect(ids.has(must), `'${must}' 장이 없다`).toBe(true);
    }
  });
});
