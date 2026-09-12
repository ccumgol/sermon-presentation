/**
 * 저장을 지나도 **모든 필드가 살아남아야 한다.**
 *
 * ## 왜 이 테스트가 있는가
 *
 * `normalizeItems` 는 **화이트리스트**다 — 아는 필드만 하나씩 옮겨 담고 나머지는
 * 버린다. 모르는 쓰레기가 순서표에 박히지 않게 하는 옳은 설계지만, **새 필드를 넣을
 * 때 여기를 같이 고치지 않으면 그 필드가 저장할 때 조용히 사라진다.**
 *
 * 실제로 그렇게 됐다. 인용구(`quote`·`preview`)를 만들고 여기를 고치지 않아, 사용자가
 * '템플릿 업데이트' 를 누르면 인용구가 모두 **평범한 성경 항목으로 되돌아갔다**
 * (2026-08-20 사용자 지적). 화면에서는 잘 보였으므로 저장하기 전까지 알 수 없었다.
 *
 * 그래서 이 테스트는 **종류마다 모든 선택 필드를 채운 항목**을 만들어 저장 경로를
 * 지나게 하고, 하나도 빠지지 않았는지 본다. 새 필드를 넣고 여기를 잊으면 실패한다.
 */

import { describe, expect, it } from 'vitest';

import { normalizeItems } from '../../server/routes/plans.ts';
import type { CueItem } from '../../shared/types.ts';

/** 저장 경로를 한 번 지난다 (컨트롤 패널 → PUT /api/plans/:id 가 하는 일) */
function roundTrip(item: CueItem): CueItem {
  const { items, rejected } = normalizeItems([item]);
  expect(rejected, `버려졌다: ${rejected.join(', ')}`).toEqual([]);
  expect(items).toHaveLength(1);
  return items[0]!;
}

const DISPLAY = { verseNumbers: false, headings: true, reference: true } as const;
const STYLE = { font: 'serif' as const, scale: 1.2 };

describe('성경 — 본문 낭독', () => {
  const item: CueItem = {
    id: 'b1',
    type: 'bible',
    ref: '창 1:1-6',
    primary: 'nkrv',
    secondary: ['niv', 'esv'],
    paging: 'auto',
    display: DISPLAY,
    style: STYLE,
    templateId: -8,
    note: '메모',
  };

  it('모든 필드가 살아남는다', () => {
    expect(roundTrip(item)).toEqual(item);
  });
});

describe('성경 — 인용구 (2026-08-20 에 사라졌던 것)', () => {
  const item: CueItem = {
    id: 'q1',
    type: 'bible',
    ref: '고전 1:3',
    primary: 'nkrv',
    secondary: [],
    paging: 'verse',
    quote: true,
    preview: '하나님 우리 아버지와 주 예수 그리스도로부터',
    display: { reference: false },
    style: STYLE,
    templateId: -1,
    note: '설교 중 인용',
  };

  it('quote 표시가 살아남는다 — 이것이 없으면 평범한 성경 항목이 된다', () => {
    const after = roundTrip(item);
    if (after.type !== 'bible') throw new Error('bible 이어야 한다');
    expect(after.quote).toBe(true);
  });

  it('목록 줄 미리보기가 살아남는다', () => {
    const after = roundTrip(item);
    if (after.type !== 'bible' || item.type !== 'bible') throw new Error('bible 이어야 한다');
    expect(after.preview).toBe(item.preview);
  });

  it('모든 필드가 살아남는다', () => {
    expect(roundTrip(item)).toEqual(item);
  });

  it('quote 가 없으면 preview 도 담지 않는다 — 뜻 없는 값을 남기지 않는다', () => {
    const after = roundTrip({ id: 'b2', type: 'bible', ref: '창 1:1', primary: 'nkrv', secondary: [], preview: '태초에' });
    if (after.type !== 'bible') throw new Error('bible 이어야 한다');
    expect(after.preview).toBeUndefined();
  });

  it("quote 는 true 만 받는다 — 'yes' 같은 값이 박히지 않는다", () => {
    const after = normalizeItems([
      { id: 'x', type: 'bible', ref: '창 1:1', primary: 'nkrv', secondary: [], quote: 'yes' },
    ]).items[0]!;
    if (after.type !== 'bible') throw new Error('bible 이어야 한다');
    expect(after.quote).toBeUndefined();
  });
});

describe('찬양', () => {
  const item: CueItem = {
    id: 's1',
    type: 'song',
    songId: 42,
    songTitle: '나 같은 죄인 살리신',
    songLabel: '새찬송가 305장',
    songbookId: 'hymn_new',
    langs: ['ko', 'en'],
    lines: '2',
    sheet: true,
    display: { verseNumbers: false },
    style: STYLE,
    templateId: -3,
    note: '2절만',
  };

  it('모든 필드가 살아남는다', () => {
    expect(roundTrip(item)).toEqual(item);
  });

  /**
   * **기본(가사)은 값이 없는 상태다.** `false` 를 적어 두면 나중에 기본을 바꿔도
   * 옛 순서표가 옛 기본에 묶인다 — 항목마다 끄고 켠 흔적과 구별되지 않는다.
   */
  /**
   * **제목 화면에 번호를 적을지가 이 값 하나에 달려 있다** (2026-09-12).
   *
   * 순서표를 저장하는 함수는 칸을 **골라 담는다** — 여기 적지 않으면 화면에서
   * 잘 담아 보내도 저장 뒤 다시 열면 사라진다. 조용한 실패라 검사로 못 박는다.
   */
  it('찬송가 곡집 id 가 살아남는다', () => {
    const after = roundTrip(item);
    if (after.type !== 'song') throw new Error('song 이어야 한다');
    expect(after.songbookId).toBe('hymn_new');
  });

  /** 찬송가가 아닌 곡집은 담지 않는다 — 담아 두면 제목 화면에 번호가 나간다 */
  it('찬송가가 아닌 곡집 id 는 버린다', () => {
    const after = roundTrip({ ...item, songbookId: 'many_waters' });
    if (after.type !== 'song') throw new Error('song 이어야 한다');
    expect(after.songbookId).toBeUndefined();
  });

  it('악보를 켜지 않으면 값을 남기지 않는다', () => {
    const after = roundTrip({ ...item, sheet: false });
    if (after.type !== 'song') throw new Error('song 이어야 한다');
    expect(after.sheet).toBeUndefined();

    const never = roundTrip({ ...item, sheet: undefined });
    if (never.type !== 'song') throw new Error('song 이어야 한다');
    expect(never.sheet).toBeUndefined();
  });
});

describe('교독문', () => {
  const item: CueItem = {
    id: 'r1',
    type: 'reading',
    readingBook: 'hymn_new',
    readingNumber: 15,
    readingTitle: '시편 27편',
    background: { src: 'bg_1.png', source: 'library' },
    style: STYLE,
    templateId: -10,
    note: '인도자 강조',
  };

  it('모든 필드가 살아남는다 — 어느 찬송가인지 포함', () => {
    expect(roundTrip(item)).toEqual(item);
  });
});

describe('순서 표시', () => {
  const item: CueItem = {
    id: 'o1',
    type: 'text',
    content: '설교\n홍길동 목사',
    variant: 'order',
    layout: 'stack',
    presenterScale: 0.6,
    templateId: -9,
    note: '메모',
  };

  it('모든 필드가 살아남는다', () => {
    expect(roundTrip(item)).toEqual(item);
  });
});

describe('전례문', () => {
  const item: CueItem = {
    id: 'l1',
    type: 'liturgy',
    textId: 'lords-prayer',
    version: 'traditional',
    perSlide: 4,
    overrideLines: ['하늘에 계신 우리 아버지여'],
    background: { src: 'bg_2.png', source: 'data', fit: 'contain' },
    style: STYLE,
    templateId: -10,
    note: '메모',
  };

  it('모든 필드가 살아남는다', () => {
    expect(roundTrip(item)).toEqual(item);
  });
});
