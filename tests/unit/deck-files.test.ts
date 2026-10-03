/**
 * **PDF 꾸러미의 이름 규칙과 상한** (`lib/deck-files.ts`).
 *
 * ## 왜 검사하는가
 *
 * 이 규칙이 느슨하면 **`decks/` 밖의 파일을 읽거나 쓴다.** 쪽 그림을 쓰는 길은
 * 보안 S-1(«업로드에 총량 제한이 없어 디스크가 차면 가사를 잃는다») 때문에 한 번
 * 통째로 걷어냈던 자리라, 다시 여는 이상 울타리가 실제로 서 있는지 못 박아야 한다.
 */

import { describe, expect, it } from 'vitest';

import {
  MAX_DECK_BYTES,
  MAX_DECK_PAGES,
  MAX_PAGE_BYTES,
  deckNameOf,
  pageFileName,
  safeDeckName,
} from '../../lib/deck-files.ts';

describe('이름 막이', () => {
  it('보통 이름은 받는다', () => {
    expect(safeDeckName('선교보고')).toBe('선교보고');
    expect(safeDeckName('2026 가을 선교보고')).toBe('2026 가을 선교보고');
    expect(safeDeckName('  여백 있는 이름  ')).toBe('여백 있는 이름');
  });

  it('경로 구분자와 `..` 를 막는다', () => {
    // 통과시키면 decks/ 밖의 파일을 읽거나 쓴다
    for (const bad of ['../secret', 'a/b', 'a\\b', '..', '../../etc/passwd']) {
      expect(safeDeckName(bad), bad).toBeUndefined();
    }
  });

  it('숨김 이름을 막는다', () => {
    expect(safeDeckName('.hidden')).toBeUndefined();
  });

  it('윈도우에서 못 쓰는 글자를 막는다', () => {
    // 맥에서 만든 이름이 윈도우에서 안 열리는 것을 **만들 때** 막는다
    for (const bad of ['a:b', 'a<b', 'a>b', 'a|b', 'a?b', 'a*b', 'a"b']) {
      expect(safeDeckName(bad), bad).toBeUndefined();
    }
  });

  it('빈 이름과 지나치게 긴 이름을 막는다', () => {
    expect(safeDeckName('')).toBeUndefined();
    expect(safeDeckName('   ')).toBeUndefined();
    expect(safeDeckName('가'.repeat(121))).toBeUndefined();
    expect(safeDeckName('가'.repeat(120))).toBe('가'.repeat(120));
  });

  it('글자가 아닌 것을 막는다', () => {
    for (const bad of [undefined, null, 42, {}, []]) {
      expect(safeDeckName(bad), String(bad)).toBeUndefined();
    }
  });
});

describe('PDF 이름에서 꾸러미 이름 뽑기', () => {
  it('확장자를 떼고, 대소문자를 가리지 않는다', () => {
    expect(deckNameOf('선교보고.pdf')).toBe('선교보고');
    expect(deckNameOf('REPORT.PDF')).toBe('REPORT');
  });

  it('PDF 가 아니면 뽑지 않는다', () => {
    for (const other of ['메모.txt', '영상.mp4', '그림.png', 'pdf', '선교보고.pdf.txt']) {
      expect(deckNameOf(other), other).toBeUndefined();
    }
  });

  it('이름 막이를 함께 지난다', () => {
    // '../x.pdf' 가 통과하면 밖으로 나간다
    expect(deckNameOf('../x.pdf')).toBeUndefined();
    expect(deckNameOf('.숨김.pdf')).toBeUndefined();
  });
});

describe('쪽 파일 이름', () => {
  it('자리를 채운다 — 이름순 정렬이 곧 쪽 차례다', () => {
    // 채우지 않으면 10쪽이 2쪽 앞에 온다
    expect(pageFileName(1)).toBe('0001.webp');
    expect(pageFileName(10)).toBe('0010.webp');
    expect([pageFileName(2), pageFileName(10)].sort()).toEqual(['0002.webp', '0010.webp']);
  });
});

describe('상한', () => {
  it('쪽 수·쪽 용량·합계가 모두 정해져 있다', () => {
    // 하나라도 0 이거나 없으면 울타리에 구멍이 난다
    expect(MAX_DECK_PAGES).toBeGreaterThan(0);
    expect(MAX_PAGE_BYTES).toBeGreaterThan(0);
    expect(MAX_DECK_BYTES).toBeGreaterThan(0);
  });

  it('합계가 쪽 하나보다 넉넉하다', () => {
    // 뒤집히면 첫 쪽부터 거부당해 아무것도 못 넣는다
    expect(MAX_DECK_BYTES).toBeGreaterThan(MAX_PAGE_BYTES);
  });
});
