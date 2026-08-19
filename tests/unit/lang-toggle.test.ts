/**
 * 표시 언어 토글 규칙.
 *
 * 찬양 탭과 예배 순서 탭이 **같은 규칙**을 써야 한다. 전에는 찬양 탭에만 있고
 * 순서 탭에는 컨트롤이 아예 없어, 순서표의 찬양은 늘 한국어만 나갔다.
 * 규칙을 한 곳에 두고 두 탭이 같은 것을 쓴다.
 *
 * 순서가 뜻을 갖는다 — **앞에 있는 언어가 화면 위**다.
 */

import { describe, expect, it } from 'vitest';

import { toggleLang } from '../../lib/lang-select.ts';

describe('켜고 끄기', () => {
  it('없는 언어를 누르면 뒤에 붙는다 — 먼저 고른 것이 위', () => {
    expect(toggleLang(['ko'], 'en')).toEqual(['ko', 'en']);
    expect(toggleLang(['en'], 'ko')).toEqual(['en', 'ko']);
  });

  it('있는 언어를 누르면 뺀다', () => {
    expect(toggleLang(['ko', 'en'], 'en')).toEqual(['ko']);
    expect(toggleLang(['ko', 'en'], 'ko')).toEqual(['en']);
  });

  it('마지막 하나는 뺄 수 없다 — 언어가 없으면 화면이 빈다', () => {
    expect(toggleLang(['ko'], 'ko')).toEqual(['ko']);
  });
});

describe('최대 3개 — 성경의 주 역본 + 보조 2개와 같다', () => {
  it('둘이 찬 상태에서는 뒤에 붙는다', () => {
    expect(toggleLang(['ko', 'en'], 'zh')).toEqual(['ko', 'en', 'zh']);
  });

  it('셋이 찬 상태에서 새 언어를 누르면 첫 번째를 남기고 갈아 끼운다', () => {
    // 위에 있던 언어를 지키는 것이 뜻이 통한다 — 주 언어는 그대로, 아래만 바꾼다
    expect(toggleLang(['ko', 'en', 'zh'], 'ja')).toEqual(['ko', 'ja']);
  });

  it('넷이 되는 일은 없다 — 3언어 × 여러 줄이면 화면이 넘친다', () => {
    let langs = toggleLang(['ko', 'en'], 'zh');
    langs = toggleLang(langs, 'ja');
    expect(langs.length).toBeLessThanOrEqual(3);
  });
});

describe('경계', () => {
  it('빈 목록에서 누르면 그 언어 하나가 된다', () => {
    expect(toggleLang([], 'en')).toEqual(['en']);
  });

  it('원래 배열을 고치지 않는다', () => {
    const original: ReadonlyArray<'ko'> = ['ko'];
    toggleLang(original, 'en');
    expect(original).toEqual(['ko']);
  });
});
