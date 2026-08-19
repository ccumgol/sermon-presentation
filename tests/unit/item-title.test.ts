/**
 * 항목 제목 — 청중이 다음을 준비하도록 띄우는 한 줄.
 *
 * ## 왜 필요한가
 *
 * 성경·찬양·교독문·전례문은 **여러 장**이라, 순서표에서 항목을 먼저 누르고 그 안의
 * 장을 눌러야 화면에 나간다. 항목을 누르는 그 순간이 '다음은 이것' 이라고 알릴
 * 가장 자연스러운 자리다.
 *
 * ## 이름을 어디서 얻는가
 *
 * 항목이 **자기 안에** 담은 것만 쓴다. 곡을 지웠거나 교독문을 아직 가져오지 않은
 * PC 에서도 순서표에 무엇이었는지 남아야 하기 때문이다 (`songTitle` 이 있는 이유와 같다).
 * 그래서 곡집·번호도 항목에 저장한다 — 없으면 제목만 띄운다.
 */

import { describe, expect, it } from 'vitest';

import { itemTitle } from '../../lib/item-title.ts';
import type { CueItem } from '../../shared/types.ts';

function bible(ref: string): CueItem {
  return { id: 'a', type: 'bible', ref, primary: 'nkrv', secondary: [] };
}

describe('성경', () => {
  it('적어 넣은 참조를 그대로 띄운다', () => {
    expect(itemTitle(bible('창 1:1-6'))).toBe('창 1:1-6');
  });

  it('전체 이름으로 적었으면 그대로', () => {
    expect(itemTitle(bible('창세기 1:1-6'))).toBe('창세기 1:1-6');
  });

  it('앞뒤 공백을 다듬는다', () => {
    expect(itemTitle(bible('  요 3:16  '))).toBe('요 3:16');
  });
});

describe('찬양', () => {
  it('곡집·번호가 있으면 함께 띄운다', () => {
    expect(
      itemTitle({
        id: 'a',
        type: 'song',
        songId: 1,
        songTitle: '만복의 근원 하나님',
        songLabel: '새찬송가 1장',
        langs: ['ko'],
      }),
    ).toBe('새찬송가 1장 만복의 근원 하나님');
  });

  it('곡집·번호가 없으면 제목만 — 옛 순서표도 뜻이 통해야 한다', () => {
    expect(
      itemTitle({ id: 'a', type: 'song', songId: 1, songTitle: '여러 해 동안 주 떠나', langs: ['ko'] }),
    ).toBe('여러 해 동안 주 떠나');
  });

  it('제목이 비어 있으면 곡집·번호만이라도 띄운다', () => {
    expect(
      itemTitle({ id: 'a', type: 'song', songId: 1, songTitle: '  ', songLabel: '새찬송가 1장', langs: ['ko'] }),
    ).toBe('새찬송가 1장');
  });
});

describe('교독문', () => {
  it('번호와 제목을 쉼표로 잇는다', () => {
    expect(
      itemTitle({ id: 'a', type: 'reading', readingNumber: 15, readingTitle: '시편 51편' }),
    ).toBe('교독문 15, 시편 51편');
  });

  it('제목이 없으면 번호만', () => {
    expect(itemTitle({ id: 'a', type: 'reading', readingNumber: 15 })).toBe('교독문 15');
  });
});

describe('주기도문·사도신경', () => {
  it('본문 이름을 그대로', () => {
    expect(itemTitle({ id: 'a', type: 'liturgy', textId: 'lords-prayer', version: 'new' })).toBe(
      '주기도문',
    );
    expect(itemTitle({ id: 'a', type: 'liturgy', textId: 'apostles-creed', version: 'new' })).toBe(
      '사도신경',
    );
  });

  it('판본은 붙이지 않는다 — 회중에게는 뜻이 없다', () => {
    const title = itemTitle({ id: 'a', type: 'liturgy', textId: 'lords-prayer', version: 'traditional' });
    expect(title).toBe('주기도문');
  });
});

describe('제목을 띄우지 않는 것', () => {
  it('한 장짜리 항목은 그 자체가 화면이라 제목이 없다', () => {
    expect(itemTitle({ id: 'a', type: 'text', content: '광고입니다', variant: 'notice' })).toBeUndefined();
    expect(itemTitle({ id: 'a', type: 'blank' })).toBeUndefined();
  });

  it('구분은 화면에 나가지 않는다', () => {
    expect(itemTitle({ id: 'a', type: 'divider', label: '찬양과 경배' })).toBeUndefined();
  });

  it('참조가 비어 있으면 띄울 것이 없다', () => {
    expect(itemTitle(bible('   '))).toBeUndefined();
  });
});
