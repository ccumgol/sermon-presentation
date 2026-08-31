import { describe, expect, it } from 'vitest';

import { describeItem, isExpandable } from '../../lib/plan-deck.ts';
import { normalizeItems, safeFolderName } from '../../server/routes/plans.ts';

/*
 * 저장 경로의 화이트리스트는 **모르는 필드를 조용히 버린다.** 2026-08-20 에
 * 인용구가 그래서 사라졌다 — 그 뒤로 새 항목은 반드시 왕복 검사를 붙인다.
 */
describe('슬라이드쇼 항목이 저장을 왕복해도 살아남는다', () => {
  it('폴더·source·fit·label 이 그대로 돌아온다', () => {
    const { items, rejected } = normalizeItems([
      { id: 'a', type: 'slideshow', source: 'library', folder: '예배전', fit: 'cover', label: '안내' },
    ]);
    expect(rejected).toEqual([]);
    expect(items[0]).toEqual({
      id: 'a', type: 'slideshow', source: 'library', folder: '예배전', fit: 'cover', label: '안내',
    });
  });

  it('폴더를 비우면 폴더 바로 밑이라는 뜻이다', () => {
    const { items } = normalizeItems([{ id: 'a', type: 'slideshow', source: 'data', folder: '' }]);
    expect(items[0]).toEqual({ id: 'a', type: 'slideshow', source: 'data', folder: '' });
  });

  it('모르는 source 는 library 로 본다', () => {
    const { items } = normalizeItems([{ id: 'a', type: 'slideshow', source: 'nope', folder: 'x' }]);
    expect(items[0]).toMatchObject({ source: 'library' });
  });
});

/* 폴더 이름으로 배경 폴더 밖을 읽을 수 있으면 안 된다 */
describe('폴더 이름 거르기', () => {
  it('경로를 벗어나려는 이름은 막는다', () => {
    for (const bad of ['../etc', 'a/b', 'a\\b', '.hidden']) {
      expect(safeFolderName(bad)).toBeUndefined();
    }
  });

  it('평범한 이름과 빈 값은 통과한다', () => {
    expect(safeFolderName('예배전')).toBe('예배전');
    expect(safeFolderName('  안내  ')).toBe('안내');
    expect(safeFolderName('')).toBe('');
    expect(safeFolderName(undefined)).toBe('');
  });

  it('막힌 이름은 항목째로 거절한다 — 조용히 다른 폴더를 읽지 않는다', () => {
    const { items, rejected } = normalizeItems([
      { id: 'a', type: 'slideshow', source: 'library', folder: '../../etc' },
    ]);
    expect(items).toEqual([]);
    expect(rejected[0]).toContain('폴더 이름');
  });
});

describe('목록에서 보이는 모습', () => {
  const item = { id: 'a', type: 'slideshow', source: 'library', folder: '예배전' } as const;

  it('폴더 이름으로 적는다', () => {
    expect(describeItem(item)).toBe('🖼 예배전');
    expect(describeItem({ ...item, label: '주보 안내' })).toBe('주보 안내');
    expect(describeItem({ ...item, folder: '' })).toBe('🖼 그림 폴더');
  });

  it('펼칠 수 있다 — 여러 장이면 한 장씩 고를 일이 있다', () => {
    expect(isExpandable(item)).toBe(true);
  });
});
