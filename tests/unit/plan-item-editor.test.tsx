// @vitest-environment jsdom
/**
 * **항목 설정 칸** (`src/control/components/plan/PlanItemEditor.tsx`, 732줄).
 *
 * ## 왜 값이 있는가
 *
 * 예배 순서에서 **가장 크고 가장 많이 만지는** 화면이다. 종류마다 다른 설정이
 * 나오고(구분·찬양·성경·교독문·전례문·순서 표시), 그중 틀리면 예배 중에
 * 드러난다. 여태 검사가 0% 였다.
 *
 * ## 여기서 지키는 규칙
 *
 * | | 왜 |
 * |---|---|
 * | 종류에 맞는 설정만 나온다 | 찬양에 '역본' 이 나오면 무엇을 만지는지 알 수 없다 |
 * | 만지면 **송출 중인 화면이 따라온다** | 눈으로 보며 맞추는 것이 이 칸의 존재 이유다 |
 * | 주 역본으로 올라간 것은 보조에서 뺀다 | 같은 본문이 두 번 나간다 |
 * | 역본을 바꾸면 인용구 미리보기를 **지운다** | 옛 역본의 글을 보여 주는 것보다 참조만 보이는 편이 낫다 |
 *
 * ## 틀(harness)
 *
 * 프롭이 스물여덟이라 기본값을 한 곳에 모아 두고 필요한 것만 덮어쓴다.
 * `patchItems` 는 진짜 훅처럼 **그 자리에서 적용해** 쌓는다 — 나중에 부르면
 * React 가 제어 컴포넌트 값을 되돌린 뒤라 바뀌기 전 값이 읽힌다
 * (`plan-defaults-card.test.tsx` 에서 실제로 겪었다).
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildPlanRows } from '../../lib/plan-deck.ts';
import { DEFAULT_LITURGY_PER_SLIDE, LITURGY_TEXTS, findLiturgy } from '../../lib/liturgy-texts.ts';
import { MAX_SECONDARY } from '../../lib/plan-item-view.ts';
import { PRESENTER_SCALE_MAX, PRESENTER_SCALE_MIN } from '../../lib/order-rhythm.ts';
import { getBuiltinTemplate } from '../../lib/template-presets.ts';
import { PlanItemEditor } from '../../src/control/components/plan/PlanItemEditor.tsx';
import { AUTO_HOLD_MS_DEFAULT, type CueItem, type ServicePlan, type Translation } from '../../shared/types.ts';

afterEach(cleanup);

const BOTTOM = getBuiltinTemplate(-1)!;
const PLAN = { id: 1, name: '주일예배', kind: 'plan', items: [] } as unknown as ServicePlan;
const TRANSLATIONS = [
  { id: 'nkrv', name: '개역개정', shortName: '개정' },
  { id: 'niv', name: 'NIV', shortName: 'NIV' },
  { id: 'esv', name: 'ESV', shortName: 'ESV' },
  { id: 'kjv', name: 'KJV', shortName: 'KJV' },
] as unknown as Translation[];

const spies = {
  patchItems: vi.fn(), setDetailOpen: vi.fn(), setLiturgyDraft: vi.fn(),
  sendItem: vi.fn(), refreshLive: vi.fn(), refreshQuotePreview: vi.fn(),
  restoreBefore: vi.fn(),
};

/** 화면이 담은 항목들 — 진짜 훅의 상태 자리다 */
let stored: CueItem[] = [];

function setup(
  current: CueItem,
  o: Partial<{
    detailOpen: boolean;
    connected: boolean;
    before: { slide: unknown; label: string } | null;
    liveItemId: string | null;
    liveItemIndex: number;
    songInfo: { id: number; available: string[]; hasSheet: boolean } | null;
    extraItems: CueItem[];
  }> = {},
) {
  cleanup();
  vi.clearAllMocks();

  const items = [current, ...(o.extraItems ?? [])];
  stored = items;
  spies.patchItems.mockImplementation((next: CueItem[] | ((p: CueItem[]) => CueItem[])) => {
    stored = typeof next === 'function' ? next(stored) : next;
  });

  const rows = buildPlanRows(items, null, 0);

  render(
    <PlanItemEditor
      current={current}
      currentRow={rows[0]!}
      items={items}
      translations={TRANSLATIONS}
      connected={o.connected ?? true}
      detailOpen={o.detailOpen ?? true}
      setDetailOpen={spies.setDetailOpen}
      bgFiles={[]}
      bgLibrary={[]}
      liturgyDraft={null}
      setLiturgyDraft={spies.setLiturgyDraft}
      songInfo={o.songInfo ?? null}
      liveItemId={o.liveItemId ?? null}
      liveItemIndex={o.liveItemIndex ?? -1}
      liveViaPlanDeck={false}
      patchItems={spies.patchItems}
      itemTemplateFor={() => BOTTOM}
      baseFontSizeFor={(_i, fallback) => fallback}
      sendItem={spies.sendItem}
      refreshLive={spies.refreshLive}
      refreshQuotePreview={spies.refreshQuotePreview}
      restoreBefore={spies.restoreBefore}
      before={(o.before ?? null) as never}
    />,
  );
}

/** 화면이 실제로 담은 그 항목 */
function edited(id = 'x'): Record<string, unknown> {
  expect(spies.patchItems).toHaveBeenCalled();
  return stored.find((one) => one.id === id) as unknown as Record<string, unknown>;
}

/** 레이블과 같은 줄에서 그 뒤에 오는 첫 컨트롤 */
function controlFor<T extends Element>(labelText: string, tag: string): T {
  const label = screen.getByText(labelText, { selector: 'label' });
  const row = label.closest('.row')!;
  const children = [...row.children];
  for (const node of children.slice(children.indexOf(label) + 1)) {
    if (node.tagName === tag) return node as unknown as T;
  }
  throw new Error(`'${labelText}' 뒤에 ${tag} 가 없다`);
}

const divider = (patch: Record<string, unknown> = {}): CueItem =>
  ({ id: 'x', type: 'divider', label: '찬양', ...patch }) as unknown as CueItem;
const song = (patch: Record<string, unknown> = {}): CueItem =>
  ({ id: 'x', type: 'song', songId: 7, songTitle: '주께와 엎드려', langs: ['ko'], ...patch }) as unknown as CueItem;
const bible = (patch: Record<string, unknown> = {}): CueItem =>
  ({ id: 'x', type: 'bible', ref: '요 3:16', primary: 'nkrv', secondary: [], ...patch }) as unknown as CueItem;
const order = (patch: Record<string, unknown> = {}): CueItem =>
  ({ id: 'x', type: 'text', variant: 'order', content: '대표기도\n홍길동', ...patch }) as unknown as CueItem;

// ─────────────────────────────────────────────────────────────
describe('머리 줄', () => {
  it('제목 줄이 곧 접기 단추다', () => {
    setup(bible());
    fireEvent.click(screen.getByTitle('편집 칸 접기'));
    expect(spies.setDetailOpen).toHaveBeenCalled();
  });

  it('접으면 안이 사라진다', () => {
    setup(bible(), { detailOpen: false });
    expect(document.querySelector('.plan-detail-body')).toBeNull();
    expect(screen.getByTitle('편집 칸 펼치기')).toBeDefined();
  });

  /** 지금 나가고 있는 항목을 만지는지 알아야 한다 */
  it('송출 중이면 표시가 붙는다', () => {
    setup(bible(), { liveItemIndex: 0 });
    expect(screen.getByText('송출 중')).toBeDefined();
  });

  it('송출 중이 아니면 표시가 없다', () => {
    setup(bible(), { liveItemIndex: 5 });
    expect(screen.queryByText('송출 중')).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────
describe('↩ 직전으로', () => {
  it('돌아갈 화면이 있을 때만 나온다', () => {
    setup(bible(), { before: null });
    expect(screen.queryByText(/직전으로/)).toBeNull();

    setup(bible(), { before: { slide: {}, label: '요 3:16' } });
    fireEvent.click(screen.getByRole('button', { name: /직전으로 \(요 3:16\)/ }));
    expect(spies.restoreBefore).toHaveBeenCalled();
  });

  /** 서버가 끊겼으면 보낼 곳이 없다 */
  it('연결이 끊기면 잠긴다', () => {
    setup(bible(), { before: { slide: {}, label: '앞 화면' }, connected: false });
    expect((screen.getByRole('button', { name: /직전으로/ }) as HTMLButtonElement).disabled).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────
describe('구분 — 예배 전 안내', () => {
  it('켜면 기본 시간과 순환이 함께 담긴다', () => {
    setup(divider());
    fireEvent.click(screen.getByLabelText('예배 전 안내 (자동으로 넘김)'));

    expect(edited().auto).toEqual({ holdMs: AUTO_HOLD_MS_DEFAULT, loop: true });
  });

  it('끄면 지워진다', () => {
    setup(divider({ auto: { holdMs: 8000, loop: true } }));
    fireEvent.click(screen.getByLabelText('예배 전 안내 (자동으로 넘김)'));
    expect(edited().auto).toBeUndefined();
  });

  /**
   * **켠 뒤에 무엇이 생기는지 적는다.** 체크만 하고 목록으로 돌아가면 어디를
   * 눌러야 시작하는지 알 수 없다 — 실제로 '▶ 를 눌러도 안 된다' 신고가 있었다.
   */
  it('켜기 전과 후의 안내가 다르다', () => {
    setup(divider());
    expect(screen.getByText(/켜면 이 구분 행에 ▶ 가 생기고/)).toBeDefined();

    setup(divider({ auto: { holdMs: 8000, loop: true } }));
    expect(screen.getByText(/이 구분 행에서 ▶ 를 누르면 시작합니다/)).toBeDefined();
  });

  it('머무는 시간을 바꾼다', () => {
    setup(divider({ auto: { holdMs: 8000, loop: true } }));
    fireEvent.change(controlFor<HTMLInputElement>('한 장에 머무는 시간', 'INPUT'), { target: { value: '15' } });
    expect((edited().auto as { holdMs: number }).holdMs).toBe(15000);
  });

  it('순환을 끈다', () => {
    setup(divider({ auto: { holdMs: 8000, loop: true } }));
    fireEvent.click(screen.getByLabelText('마지막에서 처음으로'));
    expect((edited().auto as { loop: boolean }).loop).toBe(false);
  });

  it('켜지 않으면 시간 칸이 없다', () => {
    setup(divider());
    expect(screen.queryByText('한 장에 머무는 시간')).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────
describe('찬양', () => {
  it('화면 넘김을 바꾸면 송출 화면이 따라온다', () => {
    setup(song());
    fireEvent.change(controlFor<HTMLSelectElement>('화면 넘김', 'SELECT'), { target: { value: 'section' } });

    expect(edited().lines).toBe('section');
    // 눈으로 보며 맞추는 것이 이 칸의 존재 이유다
    expect(spies.refreshLive).toHaveBeenCalled();
  });

  it('표시 언어를 켜고 끈다', () => {
    setup(song({ langs: ['ko'] }));
    const en = [...document.querySelectorAll('.candidates button')].find((b) => b.textContent?.startsWith('English'))!;
    fireEvent.click(en);
    expect(edited().langs).toEqual(['ko', 'en']);
  });

  /** 기본은 가사다 — 단 경계 자동 검출이 아직 불완전하다 */
  it('프로젝터는 가사가 기본이다', () => {
    setup(song(), { songInfo: { id: 7, available: ['ko'], hasSheet: true } });
    const buttons = [...document.querySelectorAll('.toggle-row .toggle')] as HTMLButtonElement[];
    expect(buttons.find((b) => b.textContent === '가사')!.className).toContain('active');
  });

  it('악보로 바꾸면 담기고 송출도 따라온다', () => {
    setup(song(), { songInfo: { id: 7, available: ['ko'], hasSheet: true } });
    const sheet = [...document.querySelectorAll('.toggle-row .toggle')].find((b) => b.textContent === '악보')!;
    fireEvent.click(sheet);

    expect(edited().sheet).toBe(true);
    expect(spies.refreshLive).toHaveBeenCalled();
  });

  /** 악보가 없는 곡이면 눌러도 아무 일이 없다 — 그렇다고 말해 준다 */
  it('악보가 없는 곡이면 잠긴다', () => {
    setup(song(), { songInfo: { id: 7, available: ['ko'], hasSheet: false } });
    const sheet = [...document.querySelectorAll('.toggle-row .toggle')].find((b) => b.textContent === '악보')!;
    expect((sheet as HTMLButtonElement).disabled).toBe(true);
  });

  it('찬양에는 역본 칸이 없다', () => {
    setup(song());
    expect(screen.queryByTitle('주 역본')).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────
describe('성경', () => {
  it('주 역본을 바꾸면 보조에서 뺀다', () => {
    setup(bible({ secondary: ['niv', 'esv'] }));
    fireEvent.change(screen.getByTitle('주 역본'), { target: { value: 'niv' } });

    expect(edited().primary).toBe('niv');
    expect(edited().secondary).toEqual(['esv']);
  });

  /**
   * 인용구의 목록 미리보기는 **옛 역본의 글**이 된다. 지우고 새로 채운다 —
   * 틀린 글자를 보여 주는 것보다 참조만 보이는 편이 낫다.
   */
  it('인용구는 역본을 바꾸면 미리보기를 지우고 다시 채운다', () => {
    setup(bible({ quote: true, preview: '옛 역본의 글' }));
    fireEvent.change(screen.getByTitle('주 역본'), { target: { value: 'niv' } });

    expect(edited().preview).toBeUndefined();
    expect(spies.refreshQuotePreview).toHaveBeenCalledWith('x', '요 3:16', 'niv');
  });

  it('인용구가 아니면 미리보기를 건드리지 않는다', () => {
    setup(bible({ preview: '남아야 한다' }));
    fireEvent.change(screen.getByTitle('주 역본'), { target: { value: 'niv' } });

    expect(edited().preview).toBe('남아야 한다');
    expect(spies.refreshQuotePreview).not.toHaveBeenCalled();
  });

  it('주 역본은 보조 후보에서 빠진다', () => {
    setup(bible({ primary: 'nkrv' }));
    const names = [...document.querySelectorAll('.translation-pick .candidates button')].map((b) => b.textContent);
    expect(names).not.toContain('개정');
    expect(names).toContain('NIV');
  });

  it(`보조는 ${MAX_SECONDARY}개까지`, () => {
    setup(bible({ secondary: ['niv', 'esv'] }));
    const kjv = [...document.querySelectorAll('.translation-pick .candidates button')].find(
      (b) => b.textContent === 'KJV',
    ) as HTMLButtonElement;
    expect(kjv.disabled).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────
describe('순서 표시', () => {
  it('배치를 쌓기로 바꾼다', () => {
    setup(order());
    fireEvent.change(controlFor<HTMLSelectElement>('배치', 'SELECT'), { target: { value: 'stack' } });
    expect(edited().layout).toBe('stack');
  });

  /** 좌우가 기본이므로 값을 남기지 않는다 — 옛 순서표와 같게 다뤄진다 */
  it('좌우로 되돌리면 값을 지운다', () => {
    setup(order({ layout: 'stack' }));
    fireEvent.change(controlFor<HTMLSelectElement>('배치', 'SELECT'), { target: { value: 'split' } });
    expect(edited().layout).toBeUndefined();
  });

  /** 쌓기에는 '오른쪽' 이 없다 */
  it('쌓기일 때는 담당자 크기 칸이 없다', () => {
    setup(order({ layout: 'stack' }));
    expect(screen.queryByText('담당자 크기')).toBeNull();

    setup(order());
    expect(screen.getByText('담당자 크기')).toBeDefined();
  });

  it('담당자 크기를 바꾸면 %로 보여 준다', () => {
    setup(order({ presenterScale: 1.5 }));
    expect(screen.getByText('150%')).toBeDefined();
  });

  it('1 로 되돌리면 값을 지운다 (템플릿 기본으로)', () => {
    setup(order({ presenterScale: 1.5 }));
    fireEvent.change(controlFor<HTMLInputElement>('담당자 크기', 'INPUT'), { target: { value: '1' } });
    expect(edited().presenterScale).toBeUndefined();
  });

  it('범위가 정해져 있다', () => {
    setup(order());
    const range = controlFor<HTMLInputElement>('담당자 크기', 'INPUT');
    expect(range.min).toBe(String(PRESENTER_SCALE_MIN));
    expect(range.max).toBe(String(PRESENTER_SCALE_MAX));
  });

  /** 단독 송출 중이면 바로 다시 보내 눈으로 보며 맞춘다 */
  it('송출 중인 항목이면 바꿀 때마다 다시 보낸다', () => {
    setup(order(), { liveItemId: 'x' });
    fireEvent.change(controlFor<HTMLInputElement>('담당자 크기', 'INPUT'), { target: { value: '1.4' } });
    expect(spies.sendItem).toHaveBeenCalled();
  });

  it('송출 중이 아니면 보내지 않는다', () => {
    setup(order(), { liveItemId: null });
    fireEvent.change(controlFor<HTMLInputElement>('담당자 크기', 'INPUT'), { target: { value: '1.4' } });
    expect(spies.sendItem).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────
describe('종류에 맞는 것만 나온다', () => {
  it('구분에는 역본도 배치도 없다', () => {
    setup(divider());
    expect(screen.queryByTitle('주 역본')).toBeNull();
    expect(screen.queryByText('배치')).toBeNull();
  });

  it('성경에는 배치가 없다', () => {
    setup(bible());
    expect(screen.queryByText('배치')).toBeNull();
  });

  it('전례문에는 판본이 있다', () => {
    setup({ id: 'x', type: 'liturgy', liturgyId: LITURGY_TEXTS[0]!.id } as unknown as CueItem);
    expect(screen.getByText('판본')).toBeDefined();
  });
});


// ─────────────────────────────────────────────────────────────
/**
 * 두 찬송가의 교독문은 **번호가 같아도 다른 글**이다. 그래서 여기서는
 * 어느 것인지 **보여만 준다** — 바꾸면 내용이 통째로 달라지므로, 그럴 때는
 * 항목을 다시 넣는 편이 무엇을 고르는지 눈으로 보여 안전하다.
 */
describe('교독문', () => {
  const reading = (patch: Record<string, unknown> = {}): CueItem =>
    ({ id: 'x', type: 'reading', readingBook: 'hymn_new', readingNumber: 137, title: '예배', ...patch }) as unknown as CueItem;

  it('어느 찬송가 몇 번인지 보여 준다', () => {
    setup(reading());
    expect(screen.getByText(/새찬송가용 · 137번/)).toBeDefined();
  });

  /** 바꾸는 칸이 없어야 한다 — 있으면 내용이 통째로 달라진다 */
  it('찬송가를 바꾸는 칸은 없다', () => {
    setup(reading());
    const label = screen.getByText('교독문', { selector: 'label' });
    const row = label.closest('.row')!;
    expect(row.querySelector('select[title="주 역본"]')).toBeNull();
  });

  it('배경 고르는 칸이 있다', () => {
    setup(reading());
    expect(screen.getByText('배경', { selector: 'label' })).toBeDefined();
  });

  /**
   * 순서표 전체가 올라가 있으면 항목을 고쳐도 화면이 안 바뀐다 —
   * 그것을 말해 주지 않으면 '고쳤는데 왜 그대로냐' 가 된다.
   */
  it('순서표 전체가 올라가 있으면 그렇다고 알려 준다', () => {
    cleanup();
    vi.clearAllMocks();
    const item = reading();
    stored = [item];
    spies.patchItems.mockImplementation(() => undefined);
    const rows = buildPlanRows([item], null, 0);
    render(
      <PlanItemEditor current={item} currentRow={rows[0]!} items={[item]}
        translations={TRANSLATIONS} connected detailOpen setDetailOpen={spies.setDetailOpen} bgFiles={[]} bgLibrary={[]}
        liturgyDraft={null} setLiturgyDraft={spies.setLiturgyDraft} songInfo={null}
        liveItemId={null} liveItemIndex={0} liveViaPlanDeck
        patchItems={spies.patchItems} itemTemplateFor={() => BOTTOM}
        baseFontSizeFor={(_i, f) => f} sendItem={spies.sendItem} refreshLive={spies.refreshLive}
        refreshQuotePreview={spies.refreshQuotePreview} restoreBefore={spies.restoreBefore}
        before={null}
      />,
    );
    expect(screen.getByText(/순서표 전체가 올라가 있어/)).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────
describe('주기도문·사도신경', () => {
  const first = LITURGY_TEXTS[0]!;
  const liturgy = (patch: Record<string, unknown> = {}): CueItem =>
    ({ id: 'x', type: 'liturgy', textId: first.id, version: 'new', ...patch }) as unknown as CueItem;

  it('판본을 고를 수 있다', () => {
    setup(liturgy());
    const versions = Object.values(findLiturgy(first.id)?.versions ?? {});
    for (const version of versions) {
      expect(screen.getByRole('button', { name: version.label })).toBeDefined();
    }
  });

  it('지금 판본이 켜져 보인다', () => {
    setup(liturgy({ version: 'new' }));
    const label = findLiturgy(first.id)!.versions.new!.label;
    expect(screen.getByRole('button', { name: label }).className).toContain('active');
  });

  it('판본을 바꾸면 담긴다', () => {
    setup(liturgy({ version: 'new' }));
    const other = Object.entries(findLiturgy(first.id)!.versions).find(([key]) => key !== 'new');
    if (!other) return; // 판본이 하나뿐이면 볼 것이 없다
    fireEvent.click(screen.getByRole('button', { name: other[1]!.label }));
    expect(edited().version).toBe(other[0]);
  });

  it('화면 넘김 기본값이 골라져 있다', () => {
    setup(liturgy());
    expect(controlFor<HTMLSelectElement>('화면 넘김', 'SELECT').value).toBe(String(DEFAULT_LITURGY_PER_SLIDE));
  });

  it('화면 넘김을 바꾸면 숫자로 담긴다', () => {
    setup(liturgy());
    fireEvent.change(controlFor<HTMLSelectElement>('화면 넘김', 'SELECT'), { target: { value: '4' } });
    expect(edited().perSlide).toBe(4);
  });
});

// ─────────────────────────────────────────────────────────────
describe('성경 화면 넘김', () => {
  it('기본은 1절씩', () => {
    setup(bible());
    expect(controlFor<HTMLSelectElement>('화면 넘김', 'SELECT').value).toBe('verse');
  });

  it('바꾸면 담긴다', () => {
    setup(bible());
    fireEvent.change(controlFor<HTMLSelectElement>('화면 넘김', 'SELECT'), { target: { value: 'all' } });
    expect(edited().paging).toBe('all');
  });
});

// ─────────────────────────────────────────────────────────────
describe('본문 고치기 (광고·순서 표시)', () => {
  it('여러 줄 칸에 지금 내용이 들어 있다', () => {
    setup(order({ content: '대표기도\n홍길동' }));
    expect((document.querySelector('textarea.detail-text') as HTMLTextAreaElement).value).toBe('대표기도\n홍길동');
  });

  it('고치면 담긴다', () => {
    setup(order());
    fireEvent.change(document.querySelector('textarea.detail-text')!, { target: { value: '축도\n김목사' } });
    expect(edited().content).toBe('축도\n김목사');
  });

  /** 첫 줄이 순서 이름, 다음 줄이 담당자 — 모르면 한 줄로만 쓴다 */
  it('순서 표시는 줄의 뜻을 알려 준다', () => {
    setup(order());
    expect(screen.getByText('첫 줄 = 순서 이름, 다음 줄 = 담당자')).toBeDefined();
  });

  it('광고에는 그 안내가 없다', () => {
    setup({ id: 'x', type: 'text', variant: 'notice', content: '광고' } as unknown as CueItem);
    expect(screen.queryByText(/첫 줄 = 순서 이름/)).toBeNull();
  });
});


// ─────────────────────────────────────────────────────────────
/**
 * **외곽선 두께** — 지정하지 않으면 템플릿 값을 쓴다.
 *
 * 지정이 없을 때 0 에서 출발하면 조금만 건드려도 글자가 튄다. 그래서 **템플릿
 * 값에서 시작**하고, 되돌리기(↺)로 '지정 없음' 으로 돌아간다.
 */
describe('순서 표시 — 테두리', () => {
  /**
   * **테두리 줄 안의** 슬라이더만 센다. `OrderCharTuner`(글자별 조정)도 같은
   * `.knob` 를 쓰므로 화면 전체에서 찾으면 열 개가 잡힌다.
   */
  const strokeRow = (): HTMLElement =>
    screen.getByText('테두리', { selector: 'label' }).closest('.row') as HTMLElement;
  const knobs = (): HTMLInputElement[] =>
    [...strokeRow().querySelectorAll('.knob input[type=range]')] as HTMLInputElement[];

  it('순서와 담당자 두 개가 있다', () => {
    setup(order());
    expect(knobs()).toHaveLength(2);
    expect(strokeRow().querySelectorAll('.knob .tag')[0]!.textContent).toBe('순서');
  });

  /** 쌓기에는 '담당자' 가 없다 */
  it('쌓기면 담당자 두께가 사라진다', () => {
    setup(order({ layout: 'stack' }));
    expect(knobs()).toHaveLength(1);
  });

  it('지정이 없으면 템플릿 두께에서 출발한다', () => {
    setup(order());
    const fallback = BOTTOM.text.primary.stroke?.width ?? 0;
    expect(Number(knobs()[0]!.value)).toBe(fallback);
  });

  it('바꾸면 담긴다', () => {
    setup(order());
    fireEvent.change(knobs()[0]!, { target: { value: '4' } });
    expect(edited().titleStroke).toBe(4);
  });

  /** 되돌리면 '지정 없음' 이라 템플릿을 고치면 따라간다 */
  it('되돌리면 둘 다 지정 없음이 된다', () => {
    setup(order({ titleStroke: 3, presenterStroke: 2 }));
    fireEvent.click(screen.getByTitle('템플릿 두께로 되돌리기'));

    expect(edited().titleStroke).toBeUndefined();
    expect(edited().presenterStroke).toBeUndefined();
  });

  it('지정한 것이 없으면 되돌리기가 잠긴다', () => {
    setup(order());
    expect((screen.getByTitle('템플릿 두께로 되돌리기') as HTMLButtonElement).disabled).toBe(true);

    setup(order({ titleStroke: 3 }));
    expect((screen.getByTitle('템플릿 두께로 되돌리기') as HTMLButtonElement).disabled).toBe(false);
  });

  it('송출 중이면 두께를 바꿀 때마다 다시 보낸다', () => {
    setup(order(), { liveItemId: 'x' });
    fireEvent.change(knobs()[0]!, { target: { value: '5' } });
    expect(spies.sendItem).toHaveBeenCalled();
  });
});
