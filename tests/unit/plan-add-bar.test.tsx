// @vitest-environment jsdom
/**
 * **항목 추가 바** (`src/control/components/plan/PlanAddBar.tsx`).
 *
 * ## 왜 값이 있는가
 *
 * 예배 순서를 **만드는** 입구다. 종류 열 개마다 입력칸이 갈리는데, 그 갈림이
 * 틀리면 넣을 수가 없다 — 그리고 그것은 **예배 준비 중에** 드러난다.
 *
 * 여기서 지키는 규칙:
 *
 * | | 왜 |
 * |---|---|
 * | 종류마다 입력칸이 바뀐다 (한 줄 ↔ 여러 줄) | 광고·순서 표시는 여러 줄이다 |
 * | 참조를 넣기 **전에** 확인해 보여 준다 | 틀린 참조가 순서표에 들어가면 예배 중에 발견한다 |
 * | 가져오기를 안 했으면 **무엇을 해야 하는지** 알려 준다 | 빈 목록만 보이면 고장으로 보인다 |
 * | 한글은 조합 중 Enter 를 무시한다 | 안 그러면 마지막 글자에서 두 번 추가된다 |
 *
 * ## 틀(harness)
 *
 * `usePlanAdd` 를 가짜로 넣는다. 이름 스물다섯이 그 훅 하나에서 오므로
 * 객체째로 준다 — 낱개로 만들면 검사 쪽이 먼저 무너진다.
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ADD_KINDS, MAX_SECONDARY, ORDER_PRESETS } from '../../lib/plan-item-view.ts';
import { LITURGY_TEXTS } from '../../lib/liturgy-texts.ts';
import { PlanAddBar } from '../../src/control/components/plan/PlanAddBar.tsx';
import type { ServicePlan, Translation } from '../../shared/types.ts';
import type { PlanAdd } from '../../src/control/hooks/usePlanAdd.ts';
import type { PlanBackgrounds } from '../../src/control/hooks/usePlanBackgrounds.ts';

afterEach(cleanup);

const PLAN = { id: 1, name: '주일예배', kind: 'plan', items: [] } as unknown as ServicePlan;
const TRANSLATIONS = [
  { id: 'nkrv', name: '개역개정', shortName: '개정' },
  { id: 'niv', name: 'NIV', shortName: 'NIV' },
  { id: 'esv', name: 'ESV', shortName: 'ESV' },
  { id: 'kjv', name: 'KJV', shortName: 'KJV' },
] as unknown as Translation[];

const spies = {
  pickKind: vi.fn(), setAddInput: vi.fn(), setAddPrimary: vi.fn(), setAddSecondary: vi.fn(),
  setReadingBook: vi.fn(), setPickedFolder: vi.fn(), addFromInput: vi.fn(),
  addLiturgy: vi.fn(), addReading: vi.fn(), addSong: vi.fn(), addText: vi.fn(),
};

type Options = Partial<{
  kind: string;
  plan: ServicePlan | null;
  addInput: string;
  wantsRef: boolean;
  parseOk: { ok: boolean; text: string } | null;
  addPrimary: string;
  addSecondary: string[];
  songHits: Array<{ id: number; title: string; label?: string; songLabel?: string }>;
  songTotal: number;
  readingHits: Array<{ number: number; title: string; lineCount: number; slideCount: number }>;
  readingTotal: number | null;
  readingCounts: Record<string, number> | null;
  readingBook: string;
  pickedFolder: string;
  folders: { library: Array<{ name: string; count: number }>; data: Array<{ name: string; count: number }> };
}>;

function setup(o: Options = {}) {
  cleanup();
  vi.clearAllMocks();

  const add = {
    addKind: o.kind ?? 'bible',
    pickKind: spies.pickKind,
    addInput: o.addInput ?? '',
    setAddInput: spies.setAddInput,
    wantsRef: o.wantsRef ?? false,
    parseOk: o.parseOk ?? null,
    songHits: o.songHits ?? [],
    songTotal: o.songTotal ?? 0,
    addPrimary: o.addPrimary ?? 'nkrv',
    setAddPrimary: spies.setAddPrimary,
    addSecondary: o.addSecondary ?? [],
    setAddSecondary: spies.setAddSecondary,
    readingHits: o.readingHits ?? [],
    readingBook: o.readingBook ?? 'hymn_new',
    setReadingBook: spies.setReadingBook,
    readingCounts: o.readingCounts ?? null,
    readingTotal: o.readingTotal ?? null,
    pickedFolder: o.pickedFolder ?? '',
    setPickedFolder: spies.setPickedFolder,
    addRef: { current: null },
    addFromInput: spies.addFromInput,
    addLiturgy: spies.addLiturgy,
    addReading: spies.addReading,
    addSong: spies.addSong,
    addText: spies.addText,
  } as unknown as PlanAdd;

  const backgrounds = {
    folders: o.folders ?? { library: [], data: [] },
    dirs: { library: '~/Desktop/Data/Background', data: '~/앱/backgrounds' },
  } as unknown as PlanBackgrounds;

  render(<PlanAddBar add={add} plan={o.plan === undefined ? PLAN : o.plan} translations={TRANSLATIONS} backgrounds={backgrounds} />);
}

const input = (): HTMLInputElement | HTMLTextAreaElement =>
  document.querySelector('.add-bar input, .add-bar textarea')!;

// ─────────────────────────────────────────────────────────────
describe('종류 고르기', () => {
  it('열 가지가 모두 단추로 있다', () => {
    setup();
    for (const option of ADD_KINDS) {
      expect(screen.getByTitle(option.label), option.label).toBeDefined();
    }
  });

  it('지금 종류만 켜져 보인다', () => {
    setup({ kind: 'song' });
    expect(screen.getByTitle('찬양').className).toContain('active');
    expect(screen.getByTitle('성경').className).not.toContain('active');
  });

  it('누르면 종류가 바뀐다', () => {
    setup();
    fireEvent.click(screen.getByTitle('교독문'));
    expect(spies.pickKind).toHaveBeenCalledWith('reading');
  });

  /** 순서표를 열지 않았으면 넣을 곳이 없다 */
  it('순서표가 없으면 추가 바가 아예 없다', () => {
    setup({ plan: null });
    expect(document.querySelector('.add-bar')).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────
describe('입력칸이 종류마다 갈린다', () => {
  it('성경·찬양은 한 줄 입력칸', () => {
    setup({ kind: 'bible' });
    expect(input().tagName).toBe('INPUT');
  });

  /** 광고·순서 표시는 여러 줄이다 — 한 줄 칸이면 설교자를 못 넣는다 */
  it('광고와 순서 표시는 여러 줄 입력칸', () => {
    for (const kind of ['notice', 'order']) {
      setup({ kind });
      expect(input().tagName, kind).toBe('TEXTAREA');
    }
  });

  it('여러 줄일 때는 Enter·Shift+Enter 안내가 나온다', () => {
    setup({ kind: 'notice' });
    expect(screen.getByText(/Enter 로 추가 · Shift\+Enter 줄바꿈/)).toBeDefined();
  });

  it('안내 문구가 종류를 따라간다', () => {
    setup({ kind: 'song' });
    expect(input().getAttribute('placeholder')).toBe(
      ADD_KINDS.find((one) => one.kind === 'song')!.hint,
    );
  });

  it('공백은 입력칸 없이 단추 하나', () => {
    setup({ kind: 'blank' });
    expect(document.querySelector('.add-bar input, .add-bar textarea')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '공백 추가' }));
    expect(spies.addFromInput).toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────
describe('Enter 로 넣기', () => {
  it('한 줄 칸에서 Enter 면 추가한다', () => {
    setup({ kind: 'bible', addInput: '요 3:16' });
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(spies.addFromInput).toHaveBeenCalled();
  });

  /**
   * **한글은 마지막 글자가 조합 중이라 Enter 가 두 번 처리된다.**
   * 조합 중에는 무시해야 같은 항목이 두 번 들어가지 않는다.
   */
  it('한글 조합 중 Enter 는 무시한다', () => {
    setup({ kind: 'bible', addInput: '창세기' });
    fireEvent.keyDown(input(), { key: 'Enter', keyCode: 229 });
    expect(spies.addFromInput).not.toHaveBeenCalled();
  });

  it('여러 줄 칸에서 Shift+Enter 는 줄바꿈이라 추가하지 않는다', () => {
    setup({ kind: 'notice', addInput: '광고' });
    fireEvent.keyDown(input(), { key: 'Enter', shiftKey: true });
    expect(spies.addFromInput).not.toHaveBeenCalled();
  });

  it('여러 줄 칸에서도 그냥 Enter 면 추가한다', () => {
    setup({ kind: 'notice', addInput: '광고' });
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(spies.addFromInput).toHaveBeenCalled();
  });

  it('글자를 치면 훅에 올라간다', () => {
    setup({ kind: 'bible' });
    fireEvent.change(input(), { target: { value: '요 3:16' } });
    expect(spies.setAddInput).toHaveBeenCalledWith('요 3:16');
  });
});

// ─────────────────────────────────────────────────────────────
describe('참조 확인 — 넣기 전에 보여 준다', () => {
  it('맞으면 초록으로 알린다', () => {
    setup({ kind: 'bible', wantsRef: true, parseOk: { ok: true, text: '요한복음 3:16' } });
    const line = screen.getByText(/요한복음 3:16/);
    expect(line.className).toContain('ok');
  });

  it('틀리면 빨강으로 알린다', () => {
    setup({ kind: 'bible', wantsRef: true, parseOk: { ok: false, text: '알 수 없는 참조' } });
    expect(screen.getByText(/알 수 없는 참조/).className).toContain('error');
  });

  /** 인용구는 절마다 낱개가 된다 — 모르고 넣으면 6개가 한꺼번에 생긴다 */
  it('인용구는 낱개가 된다고 덧붙인다', () => {
    setup({ kind: 'quote', wantsRef: true, parseOk: { ok: true, text: '창 1:1-6' } });
    expect(screen.getByText(/절마다 낱개 항목이 됩니다/)).toBeDefined();
  });

  it('참조를 안 쓰는 종류에는 확인 줄이 없다', () => {
    setup({ kind: 'notice', wantsRef: false, parseOk: { ok: true, text: '안 보여야 한다' } });
    expect(screen.queryByText(/안 보여야 한다/)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────
describe('역본 고르기', () => {
  it('참조를 쓰는 종류에만 나온다', () => {
    setup({ kind: 'notice', wantsRef: false });
    expect(screen.queryByTitle('주 역본')).toBeNull();
    setup({ kind: 'bible', wantsRef: true });
    expect(screen.getByTitle('주 역본')).toBeDefined();
  });

  /** 주 역본으로 올라간 것이 보조에 남아 있으면 같은 본문이 두 번 나간다 */
  it('주 역본을 바꾸면 보조에서 뺀다', () => {
    setup({ kind: 'bible', wantsRef: true, addSecondary: ['niv'] });
    fireEvent.change(screen.getByTitle('주 역본'), { target: { value: 'niv' } });

    expect(spies.setAddPrimary).toHaveBeenCalledWith('niv');
    const mutate = spies.setAddSecondary.mock.calls.at(-1)![0] as (p: string[]) => string[];
    expect(mutate(['niv', 'esv'])).toEqual(['esv']);
  });

  it('주 역본은 보조 후보에서 빠진다', () => {
    setup({ kind: 'bible', wantsRef: true, addPrimary: 'nkrv' });
    const names = [...document.querySelectorAll('.candidates button')].map((one) => one.textContent);
    expect(names).not.toContain('개정');
    expect(names).toContain('NIV');
  });

  it(`보조는 ${MAX_SECONDARY}개까지 — 넘으면 잠긴다`, () => {
    setup({ kind: 'bible', wantsRef: true, addSecondary: ['niv', 'esv'] });
    const kjv = screen.getByRole('button', { name: 'KJV' }) as HTMLButtonElement;
    expect(kjv.disabled).toBe(true);
    // 켜진 것은 끌 수 있어야 한다
    expect((screen.getByRole('button', { name: 'NIV' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('보조를 켜고 끈다', () => {
    setup({ kind: 'bible', wantsRef: true, addSecondary: [] });
    fireEvent.click(screen.getByRole('button', { name: 'NIV' }));
    const mutate = spies.setAddSecondary.mock.calls.at(-1)![0] as (p: string[]) => string[];
    expect(mutate([])).toEqual(['niv']);
    expect(mutate(['niv'])).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────
describe('종류별 목록', () => {
  it('주기도문·사도신경은 제목 단추로 바로 넣는다', () => {
    setup({ kind: 'liturgy' });
    fireEvent.click(screen.getByRole('button', { name: LITURGY_TEXTS[0]!.title }));
    expect(spies.addLiturgy).toHaveBeenCalledWith(LITURGY_TEXTS[0]!.id);
  });

  /** 매주 같은 이름을 다시 타이핑하지 않게 한다 */
  it('순서 표시는 자주 쓰는 이름을 단추로 준다', () => {
    setup({ kind: 'order' });
    fireEvent.click(screen.getByRole('button', { name: ORDER_PRESETS[0]! }));
    expect(spies.addText).toHaveBeenCalledWith(ORDER_PRESETS[0], 'order');
  });

  /**
   * 네 번째 인자가 **찬송가 수록**이다 (2026-09-12). 제목 화면에 번호를 적을지가
   * 여기서 갈린다 — 찬미예수는 찬송가가 아니므로 `undefined` 가 맞다.
   */
  it('찬양 검색 결과를 누르면 넣는다 — 찬송가가 아니면 수록을 주지 않는다', () => {
    setup({ kind: 'song', songHits: [{ id: 7, title: '주께와 엎드려', label: '찬7', songLabel: '찬미예수 7장' }], songTotal: 1 });
    fireEvent.click(screen.getByRole('button', { name: /주께와 엎드려/ }));
    expect(spies.addSong).toHaveBeenCalledWith(7, '주께와 엎드려', '찬미예수 7장', undefined);
  });

  it('찬송가면 수록을 함께 넘긴다 — 제목 화면의 번호가 여기서 나온다', () => {
    setup({
      kind: 'song',
      songHits: [
        {
          id: 9,
          title: '나 같은 죄인 살리신',
          label: '새305',
          songLabel: '새찬송가 305장',
          hymnal: { label: '새찬송가 305장', songbookId: 'hymn_new' },
        },
      ],
      songTotal: 1,
    });
    fireEvent.click(screen.getByRole('button', { name: /나 같은 죄인 살리신/ }));
    expect(spies.addSong).toHaveBeenCalledWith(9, '나 같은 죄인 살리신', '새찬송가 305장', {
      label: '새찬송가 305장',
      songbookId: 'hymn_new',
    });
  });

  /** 결과가 잘렸다는 것을 알려야 '왜 안 나오지' 를 피한다 */
  it('결과가 잘리면 알려 준다', () => {
    setup({ kind: 'song', songHits: [{ id: 1, title: '은혜' }], songTotal: 40 });
    expect(screen.getByText(/40곡 중 1곡만 보입니다/)).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────
/**
 * 두 찬송가의 교독문은 **번호가 같아도 다른 글**이다 (통일 76편 · 새 137편).
 * 그래서 번호를 치기 전에 어느 쪽인지 먼저 골라야 한다.
 */
describe('교독문', () => {
  it('찬송가를 골라야 한다 — 지금 고른 것이 보인다', () => {
    setup({ kind: 'reading', readingBook: 'hymn_old', readingCounts: { hymn_old: 76, hymn_new: 137 } });
    const buttons = [...document.querySelectorAll('.candidates button')] as HTMLButtonElement[];
    const old = buttons.find((one) => one.textContent?.includes('76편'))!;
    expect(old.className).toContain('primary');
  });

  it('몇 편 있는지 함께 보여 준다', () => {
    setup({ kind: 'reading', readingCounts: { hymn_old: 76, hymn_new: 137 } });
    expect(screen.getByText(/137편/)).toBeDefined();
  });

  it('바꾸면 훅에 올라간다', () => {
    setup({ kind: 'reading', readingCounts: { hymn_old: 76, hymn_new: 137 } });
    const buttons = [...document.querySelectorAll('.candidates button')] as HTMLButtonElement[];
    fireEvent.click(buttons.find((one) => one.textContent?.includes('76편'))!);
    expect(spies.setReadingBook).toHaveBeenCalledWith('hymn_old');
  });

  /** 빈 목록만 보여 주면 고장으로 보인다 — 무엇을 해야 하는지 적는다 */
  it('가져오지 않았으면 방법을 알려 준다', () => {
    setup({ kind: 'reading', readingTotal: 0, readingBook: 'hymn_new' });
    expect(screen.getByText(/교독문이 없습니다/)).toBeDefined();
    expect(screen.getByText('node scripts/import-kyodoc.ts --apply')).toBeDefined();
  });

  it('찬송가마다 다른 명령을 알려 준다', () => {
    setup({ kind: 'reading', readingTotal: 0, readingBook: 'hymn_old' });
    expect(screen.getByText('node scripts/import-responsive.ts --apply')).toBeDefined();
  });

  it('결과를 누르면 넣는다', () => {
    const hit = { number: 1, title: '예배', lineCount: 10, slideCount: 3 };
    setup({ kind: 'reading', readingTotal: 137, readingHits: [hit] });
    fireEvent.click(screen.getByRole('button', { name: /1\. 예배/ }));
    expect(spies.addReading).toHaveBeenCalledWith(hit);
  });

  it('있는데 못 찾으면 그렇다고 말한다', () => {
    setup({ kind: 'reading', readingTotal: 137, readingHits: [] });
    expect(screen.getByText(/찾는 교독문이 없습니다 \(전체 137편\)/)).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────
describe('그림 폴더', () => {
  /** 빈 드롭다운만 주면 '고장났다' 로 보인다 — 어디에 넣는지 실제 경로로 알린다 */
  it('고를 폴더가 없으면 어디에 넣는지 알려 준다', () => {
    setup({ kind: 'slideshow', folders: { library: [], data: [] } });
    expect(screen.getByText(/쓸 수 있는 그림이 없습니다/)).toBeDefined();
    expect(screen.getByText('~/Desktop/Data/Background')).toBeDefined();
  });

  it('폴더와 장 수를 함께 보여 준다', () => {
    setup({ kind: 'slideshow', folders: { library: [{ name: '가을', count: 12 }], data: [] } });
    expect(screen.getByRole('option', { name: /가을 — 12장/ })).toBeDefined();
  });

  it('폴더 바로 밑도 고를 수 있다', () => {
    setup({ kind: 'slideshow', folders: { library: [{ name: '', count: 3 }], data: [] } });
    expect(screen.getByRole('option', { name: /\(폴더 바로 밑\) — 3장/ })).toBeDefined();
  });

  /** 안 고르고 누르면 빈 항목이 들어간다 */
  it('폴더를 고르기 전에는 추가가 잠긴다', () => {
    setup({ kind: 'slideshow', folders: { library: [{ name: '가을', count: 12 }], data: [] }, pickedFolder: '' });
    expect((screen.getByRole('button', { name: '추가' }) as HTMLButtonElement).disabled).toBe(true);

    setup({ kind: 'slideshow', folders: { library: [{ name: '가을', count: 12 }], data: [] }, pickedFolder: 'library/가을' });
    expect((screen.getByRole('button', { name: '추가' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('어느 폴더에서 왔는지 표시한다', () => {
    setup({ kind: 'slideshow', folders: { library: [{ name: '가을', count: 1 }], data: [{ name: '겨울', count: 2 }] } });
    expect(screen.getByRole('option', { name: /가을.*모아 둔 폴더/ })).toBeDefined();
    expect(screen.getByRole('option', { name: /겨울.*앱 폴더/ })).toBeDefined();
  });
});
