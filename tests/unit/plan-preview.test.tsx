// @vitest-environment jsdom
/**
 * **항목 하나를 슬라이드로 푸는 것** (`src/control/hooks/usePlanPreview.ts`).
 *
 * ## 왜 값이 있는가
 *
 * `resolveItem` 은 **무엇이 화면에 나갈지 정하는 함수**다. 성경·찬양·순서 표시·
 * 슬라이드쇼·전례문·교독문·공백 일곱 종류가 여기를 지난다. 2026-09-07 까지
 * 2,549줄짜리 `PlanPanel` 안에 있어서 화면을 다 띄우지 않고는 부를 수 없었다.
 *
 * `quote-consistency` 검사가 이 조건을 **소스 글자로** 붙잡고 있었다
 * ("item.quote ? quoteSlides(" 가 파일에 있는지). 이제 함수를 직접 부를 수 있으니
 * 여기서 동작으로 확인한다.
 *
 * ## 틀(harness)
 *
 * `api` 를 우리 것으로 바꿔 끼운다 — 서버가 필요 없다. 측정 iframe 은 jsdom 에서
 * `contentWindow` 가 없어 '넘치지 않음' 으로 답한다 (`use-measure` 검사가 그 규칙을
 * 따로 잡는다).
 */

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CueItem, Template } from '../../shared/types.ts';
import { getBuiltinTemplate } from '../../lib/template-presets.ts';

// ── api 를 바꿔 끼운다 (import 보다 먼저) ────────────────────
const passage = vi.fn();
const songDeck = vi.fn();
const reading = vi.fn();
const slideshow = vi.fn();
const templates = vi.fn();

class FakeApiError extends Error {}

vi.mock('../../src/control/api.ts', () => ({
  api: {
    passage: (...a: unknown[]) => passage(...a),
    songDeck: (...a: unknown[]) => songDeck(...a),
    reading: (...a: unknown[]) => reading(...a),
    slideshow: (...a: unknown[]) => slideshow(...a),
    templates: () => templates(),
  },
  ApiError: FakeApiError,
}));

const { usePlanPreview } = await import('../../src/control/hooks/usePlanPreview.ts');

const BOTTOM = getBuiltinTemplate(-1)!;

/**
 * 성경 슬라이드의 실제 모양 — 줄(`lines`)이 아니라 **역본별 블록**이다
 * (`shared/types.ts` 의 `kind: 'bible'`). 인용구가 참조를 앞에 붙일 때 이 안을
 * 만지므로, 여기서 모양을 틀리게 잡으면 검사가 헛돈다.
 */
const BIBLE_SLIDE = {
  kind: 'bible' as const,
  reference: '요 3:16',
  blocks: [{ translationId: 'nkrv', verses: [{ number: 16, text: '하나님이 세상을 이처럼 사랑하사' }] }],
};

afterEach(cleanup);

beforeEach(() => {
  vi.clearAllMocks();
  templates.mockResolvedValue([]);
  passage.mockResolvedValue({
    parse: { ok: true },
    passage: { blocks: [] },
    deck: { slides: [BIBLE_SLIDE], labels: ['3:16'] },
  });
  songDeck.mockResolvedValue({ deck: { slides: [{ kind: 'song', lines: ['가사'] }], labels: ['1절'] } });
  reading.mockResolvedValue({ title: '시편 98', slides: [{ leader: '인도자', people: '회중' }] });
  slideshow.mockResolvedValue({ files: [{ name: 'a.png', url: '/bg/a.png', bytes: 1 }] });
});

/** 훅을 띄우고 resolveItem 만 꺼낸다 */
function resolver(template: Template | null = BOTTOM) {
  const hook = renderHook(() => usePlanPreview({ items: [], expandedId: null, template }));
  return { hook, resolve: (item: CueItem) => hook.result.current.resolveItem(item) };
}

const item = (patch: Record<string, unknown>): CueItem => patch as unknown as CueItem;

describe('성경 본문', () => {
  it('참조가 틀리면 그 이유를 돌려준다 (던지지 않는다)', async () => {
    passage.mockResolvedValue({ parse: { ok: false, message: '그런 책이 없습니다' }, passage: null, deck: null });
    const { resolve } = resolver();
    await expect(resolve(item({ id: 'b', type: 'bible', ref: '없음 1:1', primary: 'nkrv', secondary: [] })))
      .resolves.toMatchObject({ slides: [], error: '그런 책이 없습니다' });
  });

  it('참조는 맞지만 본문이 없으면 그렇게 말한다', async () => {
    passage.mockResolvedValue({ parse: { ok: true }, passage: null, deck: null });
    const { resolve } = resolver();
    await expect(resolve(item({ id: 'b', type: 'bible', ref: '요 3:16', primary: 'nkrv', secondary: [] })))
      .resolves.toMatchObject({ error: '본문을 찾지 못했습니다' });
  });

  it('역본을 주 → 보조 순으로 서버에 넘긴다', async () => {
    const { resolve } = resolver();
    await resolve(item({ id: 'b', type: 'bible', ref: '요 3:16', primary: 'nkrv', secondary: ['niv', 'esv'] }));
    expect(passage).toHaveBeenCalledWith('요 3:16', ['nkrv', 'niv', 'esv'], 'verse');
  });

  it('★ 표시 여부·꾸밈은 슬라이드에 실어 보내기만 한다 — 결정은 출력 페이지가 한다', async () => {
    const { resolve } = resolver();
    const display = { reference: false };
    const style = { color: '#fff' };
    const out = await resolve(item({
      id: 'b', type: 'bible', ref: '요 3:16', primary: 'nkrv', secondary: [], display, style,
    }));
    expect(out.slides[0]).toMatchObject({ kind: 'bible', display, style });
  });

  it('지정이 없으면 슬라이드를 손대지 않는다', async () => {
    const { resolve } = resolver();
    const out = await resolve(item({ id: 'b', type: 'bible', ref: '요 3:16', primary: 'nkrv', secondary: [] }));
    expect(out.slides[0]).toEqual(BIBLE_SLIDE);
    expect(out.labels).toEqual(['3:16']);
  });

  it('★ 인용구는 참조를 본문 앞에 붙인다 — 네 화면이 서로 다른 렌더러를 쓰기 때문이다', async () => {
    const { resolve } = resolver();
    const out = await resolve(item({
      id: 'q', type: 'bible', ref: '고전 1:3', primary: 'nkrv', secondary: [], quote: true,
    }));
    // 참조를 **글자로** 넣어야 네 화면이 그것을 '본문' 으로 받아 저절로 같아진다
    expect(JSON.stringify(out.slides)).toContain('고전 1:3');
  });

  it('본문 낭독(인용구가 아닌 성경)은 그 길로 가지 않는다', async () => {
    const { resolve } = resolver();
    const out = await resolve(item({ id: 'b', type: 'bible', ref: '고전 1:3', primary: 'nkrv', secondary: [] }));
    expect(JSON.stringify(out.slides)).not.toContain('고전 1:3');
  });
});

describe('찬양', () => {
  it('★ 악보는 항목이 켠 것만 — 기본은 가사다 (2026-09-04 사용자 결정)', async () => {
    const { resolve } = resolver();
    await resolve(item({ id: 's', type: 'song', songId: 7, songTitle: '주 사랑', langs: ['ko'] }));
    // 마지막 인자가 sheet 다
    expect(songDeck).toHaveBeenCalledWith(7, ['ko'], '2', undefined, BOTTOM.behavior.maxCharsPerLine, false);

    await resolve(item({ id: 's', type: 'song', songId: 7, songTitle: '주 사랑', langs: ['ko'], sheet: true }));
    expect(songDeck).toHaveBeenLastCalledWith(7, ['ko'], '2', undefined, BOTTOM.behavior.maxCharsPerLine, true);
  });

  it('★ 템플릿이 정한 행 폭을 넘긴다 — 없으면 운율 행이 엉뚱한 폭으로 묶인다', async () => {
    const { resolve } = resolver(null);
    await resolve(item({ id: 's', type: 'song', songId: 1, songTitle: 'ㄱ', langs: ['ko'] }));
    expect(songDeck).toHaveBeenCalledWith(1, ['ko'], '2', undefined, undefined, false);
  });

  it('꾸밈을 실어 보낸다', async () => {
    const { resolve } = resolver();
    const out = await resolve(item({
      id: 's', type: 'song', songId: 1, songTitle: 'ㄱ', langs: ['ko'], display: { title: false },
    }));
    expect(out.slides[0]).toMatchObject({ kind: 'song', display: { title: false } });
  });
});

describe('순서 표시 · 광고', () => {
  it('★ 순서 표시는 기본이 좌우 나누기다 — 왼쪽 순서 이름, 오른쪽 담당자', async () => {
    const { resolve } = resolver();
    const out = await resolve(item({ id: 't', type: 'text', variant: 'order', content: '대표기도  김집사' }));
    expect(out.slides).toHaveLength(1);
    expect(out.slides[0]!.kind).toBe('order');
    expect(out.labels).toEqual(['순서 표시']);
  });

  it("layout: 'stack' 이면 좌우로 나누지 않는다 — 한 줄로 붙여 쓰는 순서가 있다", async () => {
    const { resolve } = resolver();
    const out = await resolve(item({
      id: 't', type: 'text', variant: 'order', layout: 'stack', content: '대표기도\n김집사',
    }));
    expect(out.slides[0]!.kind).toBe('text');
  });

  it('★ 빈 줄은 버린다 — 광고를 여러 줄로 붙여 넣을 때 사이가 벌어진다', async () => {
    const { resolve } = resolver();
    const out = await resolve(item({ id: 't', type: 'text', content: '첫 줄\n\n  \n둘째 줄' }));
    expect(out.slides[0]).toEqual({ kind: 'text', lines: ['첫 줄', '둘째 줄'] });
  });

  it('순서 표시의 글자 조정값을 함께 싣는다', async () => {
    const { resolve } = resolver();
    const out = await resolve(item({
      id: 't', type: 'text', variant: 'order', content: 'ㄱ  ㄴ', presenterScale: 0.8, titleStroke: 2,
    }));
    expect(out.slides[0]).toMatchObject({ presenterScale: 0.8, titleStroke: 2 });
  });
});

describe('슬라이드쇼 (그림 폴더)', () => {
  it('★ 띄울 때 폴더를 읽는다 — 순서표에는 폴더만 담긴다 (파일을 더 넣어도 고칠 것이 없다)', async () => {
    slideshow.mockResolvedValue({
      files: [{ name: 'a.png', url: '/bg/a.png' }, { name: 'b.jpg', url: '/bg/b.jpg' }],
    });
    const { resolve } = resolver();
    const out = await resolve(item({ id: 'i', type: 'slideshow', source: 'library', folder: '광고' }));

    expect(slideshow).toHaveBeenCalledWith('library', '광고');
    expect(out.slides).toEqual([
      { kind: 'image', src: '/bg/a.png', alt: 'a.png' },
      { kind: 'image', src: '/bg/b.jpg', alt: 'b.jpg' },
    ]);
    // 라벨에서 확장자를 뗀다 — 목록에 '.png' 가 줄줄이 보이면 읽기 어렵다
    expect(out.labels).toEqual(['a', 'b']);
  });

  it('폴더가 비었으면 어느 폴더인지까지 말한다', async () => {
    slideshow.mockResolvedValue({ files: [] });
    const { resolve } = resolver();
    await expect(resolve(item({ id: 'i', type: 'slideshow', source: 'data', folder: '광고' })))
      .resolves.toMatchObject({ error: '폴더에 그림이 없습니다 (광고)' });
  });

  it("폴더 이름이 비었으면 '기본 폴더' 라고 부른다", async () => {
    slideshow.mockResolvedValue({ files: [] });
    const { resolve } = resolver();
    await expect(resolve(item({ id: 'i', type: 'slideshow', source: 'data', folder: '' })))
      .resolves.toMatchObject({ error: '폴더에 그림이 없습니다 (기본 폴더)' });
  });

  it("fit: 'cover' 만 실어 보낸다 (기본은 담기)", async () => {
    const { resolve } = resolver();
    const plain = await resolve(item({ id: 'i', type: 'slideshow', source: 'data', folder: 'x' }));
    expect(plain.slides[0]).not.toHaveProperty('fit');

    const cover = await resolve(item({ id: 'i', type: 'slideshow', source: 'data', folder: 'x', fit: 'cover' }));
    expect(cover.slides[0]).toMatchObject({ fit: 'cover' });
  });
});

describe('교독문', () => {
  it('인도자/회중을 나눠 담고 제목을 참조로 쓴다', async () => {
    reading.mockResolvedValue({
      title: '시편 98',
      slides: [{ leader: '새 노래로', people: '여호와께' }, { leader: '홀로' }],
    });
    const { resolve } = resolver();
    const out = await resolve(item({ id: 'r', type: 'reading', readingNumber: 23, readingBook: 'hymn_old' }));

    expect(reading).toHaveBeenCalledWith(23, 'hymn_old');
    expect(out.slides[0]).toMatchObject({ kind: 'reading', leader: '새 노래로', people: '여호와께', reference: '시편 98' });
    // 회중 없는 장은 people 을 붙이지 않는다 (빈 칸이 그려지면 안 된다)
    expect(out.slides[1]).not.toHaveProperty('people');
  });

  it('★ 가져오기를 안 한 PC 면 왜 안 되는지 말한다 — 조용히 빈 화면을 내보내지 않는다', async () => {
    reading.mockRejectedValue(new FakeApiError('교독문이 없습니다. 먼저 가져오세요.'));
    const { resolve } = resolver();
    await expect(resolve(item({ id: 'r', type: 'reading', readingNumber: 1, readingBook: 'hymn_old' })))
      .resolves.toMatchObject({ slides: [], error: '교독문이 없습니다. 먼저 가져오세요.' });
  });

  it('모르는 실패도 삼키지 않는다', async () => {
    reading.mockRejectedValue(new Error('무엇'));
    const { resolve } = resolver();
    await expect(resolve(item({ id: 'r', type: 'reading', readingNumber: 1, readingBook: 'hymn_old' })))
      .resolves.toMatchObject({ error: '교독문을 불러오지 못했습니다' });
  });

  it('본문이 비어 있으면 그렇게 말한다', async () => {
    reading.mockResolvedValue({ title: 'ㄱ', slides: [] });
    const { resolve } = resolver();
    await expect(resolve(item({ id: 'r', type: 'reading', readingNumber: 1, readingBook: 'hymn_old' })))
      .resolves.toMatchObject({ error: '본문이 비어 있습니다' });
  });
});

describe('전례문 (주기도문·사도신경)', () => {
  it('없는 본문이면 그렇게 말한다', async () => {
    const { resolve } = resolver();
    await expect(resolve(item({ id: 'l', type: 'liturgy', textId: '없는것', version: 'new' })))
      .resolves.toMatchObject({ slides: [], error: '본문을 찾지 못했습니다' });
  });

  it("★ 판본이 비어 있어도 죽지 않고 '못 찾았다' 로 답한다 — 옛 순서표에 version 이 없을 수 있다", async () => {
    const { resolve } = resolver();
    await expect(resolve(item({ id: 'l', type: 'liturgy', textId: 'lords-prayer' })))
      .resolves.toMatchObject({ slides: [], error: '본문을 찾지 못했습니다' });
  });

  it('★ 서버를 부르지 않는다 — 본문이 lib 안에 있다 (예배 중 네트워크에 매달리지 않는다)', async () => {
    const { resolve } = resolver();
    const out = await resolve(item({ id: 'l', type: 'liturgy', textId: 'lords-prayer', version: 'new' }));
    expect(out.slides.length).toBeGreaterThan(0);
    expect(out.slides[0]!.kind).toBe('text');
    // 장 번호를 라벨로 붙인다
    expect(out.labels[0]).toBe('1');
  });

  it('배경·꾸밈을 실어 보낸다', async () => {
    const { resolve } = resolver();
    const out = await resolve(item({
      id: 'l', type: 'liturgy', textId: 'lords-prayer', version: 'new',
      background: { source: 'library', name: 'bg_1.png' }, style: { color: '#fff' },
    }));
    expect(out.slides[0]).toMatchObject({ background: { source: 'library', name: 'bg_1.png' }, style: { color: '#fff' } });
  });
});

describe('공백 · 구분', () => {
  it('공백은 한 장이다', async () => {
    const { resolve } = resolver();
    await expect(resolve(item({ id: 'x', type: 'blank' })))
      .resolves.toEqual({ slides: [{ kind: 'blank' }], labels: ['공백'] });
  });

  it('★ 구분은 슬라이드가 없다 — 목록의 머리글일 뿐이다', async () => {
    const { resolve } = resolver();
    await expect(resolve(item({ id: 'd', type: 'divider', label: '찬양' })))
      .resolves.toEqual({ slides: [], labels: [] });
  });
});

describe('펼친 항목을 자동으로 푼다', () => {
  const one: CueItem = item({ id: 'b1', type: 'bible', ref: '요 3:16', primary: 'nkrv', secondary: [] });

  it('아무것도 펼치지 않았으면 미리보기가 없다', () => {
    const { result } = renderHook(() => usePlanPreview({ items: [one], expandedId: null, template: BOTTOM }));
    expect(result.current.preview).toBeNull();
    expect(passage).not.toHaveBeenCalled();
  });

  it('펼친 항목을 풀어 담는다', async () => {
    const { result } = renderHook(() => usePlanPreview({ items: [one], expandedId: 'b1', template: BOTTOM }));
    await waitFor(() => expect(result.current.preview).not.toBeNull());
    expect(result.current.preview!.labels).toEqual(['3:16']);
    expect(result.current.previewError).toBeNull();
  });

  it('★ 항목 **내용**이 바뀌면 다시 푼다 — id 만 보면 판본을 바꿔도 미리보기가 그대로다', async () => {
    const { result, rerender } = renderHook(
      (props: { items: CueItem[] }) => usePlanPreview({ ...props, expandedId: 'b1', template: BOTTOM }),
      { initialProps: { items: [one] } },
    );
    await waitFor(() => expect(passage).toHaveBeenCalledTimes(1));

    rerender({ items: [item({ ...(one as object), primary: 'niv' })] });
    await waitFor(() => expect(passage).toHaveBeenCalledTimes(2));
    expect(passage).toHaveBeenLastCalledWith('요 3:16', ['niv'], 'verse');
    void result;
  });

  it('같은 내용으로 다시 그려도 또 풀지 않는다', async () => {
    const { rerender } = renderHook(
      (props: { items: CueItem[] }) => usePlanPreview({ ...props, expandedId: 'b1', template: BOTTOM }),
      { initialProps: { items: [one] } },
    );
    await waitFor(() => expect(passage).toHaveBeenCalledTimes(1));
    rerender({ items: [one] });
    rerender({ items: [one] });
    expect(passage).toHaveBeenCalledTimes(1);
  });

  it('★ 실패하면 앞의 슬라이드를 지운다 — 남겨 두면 오퍼레이터가 엉뚱한 것을 송출한다', async () => {
    const { result, rerender } = renderHook(
      (props: { items: CueItem[] }) => usePlanPreview({ ...props, expandedId: 'b1', template: BOTTOM }),
      { initialProps: { items: [one] } },
    );
    await waitFor(() => expect(result.current.preview).not.toBeNull());

    passage.mockRejectedValue(new FakeApiError('서버에 연결할 수 없습니다'));
    rerender({ items: [item({ ...(one as object), primary: 'niv' })] });

    await waitFor(() => expect(result.current.previewError).toBe('서버에 연결할 수 없습니다'));
    expect(result.current.preview).toBeNull();
  });

  it('접으면 미리보기를 비운다', async () => {
    const { result, rerender } = renderHook(
      (props: { expandedId: string | null }) => usePlanPreview({ items: [one], ...props, template: BOTTOM }),
      { initialProps: { expandedId: 'b1' as string | null } },
    );
    await waitFor(() => expect(result.current.preview).not.toBeNull());
    rerender({ expandedId: null });
    expect(result.current.preview).toBeNull();
  });
});

describe('항목마다 고를 수 있는 표시 템플릿 목록', () => {
  it('한 번 읽어 둔다', async () => {
    templates.mockResolvedValue([{ id: 3, name: '내 템플릿' }]);
    const { result } = renderHook(() => usePlanPreview({ items: [], expandedId: null, template: BOTTOM }));
    await waitFor(() => expect(result.current.styleTemplates).toHaveLength(1));
  });

  /**
   * 목록 읽기가 실패해도 **나머지가 계속 돌아야 한다.**
   *
   * 처음에 이 검사를 `styleTemplates` 가 `[]` 인지로 썼는데, 초기값이 이미 `[]` 라서
   * `.catch` 를 지워도 통과했다(변이 검증에서 잡혔다). 실패 경로가 관측되지 않는
   * 자리였다 — 관측되는 것으로 바꿨다.
   */
  it('★ 못 읽어도 순서표 작업이 멈추지 않는다 (미리보기는 계속 풀린다)', async () => {
    templates.mockRejectedValue(new Error('끊김'));
    const one: CueItem = item({ id: 'b1', type: 'bible', ref: '요 3:16', primary: 'nkrv', secondary: [] });
    const { result } = renderHook(() => usePlanPreview({ items: [one], expandedId: 'b1', template: BOTTOM }));

    await waitFor(() => expect(result.current.preview).not.toBeNull());
    expect(result.current.previewError).toBeNull();
    expect(result.current.styleTemplates).toEqual([]);
  });

  it('한 번 읽은 뒤 다시 그려도 다시 읽지 않는다 — 탭을 오갈 때마다 부르면 낭비다', async () => {
    templates.mockResolvedValue([{ id: 3, name: '내 템플릿' }]);
    const { result, rerender } = renderHook(() =>
      usePlanPreview({ items: [], expandedId: null, template: BOTTOM }));
    await waitFor(() => expect(result.current.styleTemplates).toHaveLength(1));
    rerender();
    rerender();
    expect(templates).toHaveBeenCalledTimes(1);
  });
});
