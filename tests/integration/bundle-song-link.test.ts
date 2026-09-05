/**
 * **집에서 만든 순서를 교회 PC 로 옮겨도 곡이 그대로 열리는가.**
 *
 * ## 왜 이 검사가 있는가
 *
 * 예배 순서 항목은 곡을 `songId` 로 가리킨다. 가져오기가 곡을 새로 만들면 id 가
 * 새로 매겨지는데, 그 항목의 `songId` 를 바꿔 주지 않으면 **순서에는 제목이 남아
 * 멀쩡해 보이는데 누르면 '곡을 찾을 수 없습니다'** 가 된다. 예배 중에 만나는 오류다.
 *
 * 실제로 그랬다 (2026-09-05 실측 재현): 집에서 곡 3개 중 하나를 지워 id 에 구멍이
 * 나면(실제 DB 는 늘 그렇다) 교회 PC 에서 id 가 밀려 어긋난다.
 *
 * 여기서는 두 개의 격리된 저장소를 오가는 대신, **번들을 손으로 지어** 같은 상황을
 * 만든다 — 옛 id 와 새 id 가 다르기만 하면 재현된다.
 */

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from '../../server/app.ts';
import * as plans from '../../server/db/plans.ts';
import * as songs from '../../server/db/songs.ts';
import { applyBundle, BUNDLE_FORMAT, BUNDLE_VERSION, type Bundle } from '../../server/routes/backup.ts';

let app: FastifyInstance;

const SOURCE = 'bundle_link_test';
const PLAN_NAME = '연결 시험 순서';

function bundleWith(overrides: Partial<Bundle>): Bundle {
  return {
    format: BUNDLE_FORMAT,
    version: BUNDLE_VERSION,
    exportedAt: new Date().toISOString(),
    songs: [],
    templates: [],
    plans: [],
    settings: {},
    fonts: [],
    ...overrides,
  };
}

/** 집 PC 에서 온 곡 — id 가 이 PC 와 겹치지 않게 크게 잡는다 */
function homeSong(id: number, title: string, number?: number) {
  return {
    id,
    title,
    tags: [],
    hasAmen: false,
    source: SOURCE,
    langs: ['ko'],
    entries: number === undefined ? [] : [{ songbookId: 'hymn_new', songbookName: '새찬송가', songbookShortLabel: '새', number }],
    sections: [
      {
        id: 1,
        kind: 'verse' as const,
        label: '1절',
        position: 0,
        lines: [{ lineIndex: 0, lang: 'ko' as const, text: `${title} 가사` }],
      },
    ],
  } as unknown as Bundle['songs'][number];
}

function cleanUp(): void {
  songs.deleteBySource(SOURCE);
  for (const plan of plans.listPlans()) {
    if (plan.name === PLAN_NAME) plans.deletePlan(plan.id);
  }
}

beforeAll(async () => {
  app = (await buildApp({ getPort: () => 7777 })).app;
  await app.ready();
  songs.initSongsDb();
});

afterAll(async () => {
  cleanUp();
  await app.close();
});

beforeEach(cleanUp);

/** 그 순서 항목이 실제로 가리키게 된 곡의 제목 */
function linkedTitle(): string | undefined {
  const plan = plans.listPlans().find((one) => one.name === PLAN_NAME);
  const item = plan?.items.find((one) => one.type === 'song');
  if (!item || item.type !== 'song') return undefined;
  return songs.getSong(item.songId)?.title;
}

describe('가져오기가 곡 연결을 이어 준다', () => {
  it('id 가 달라져도 같은 곡을 가리킨다', () => {
    const result = applyBundle(
      bundleWith({
        songs: [homeSong(9001, '첫째곡', 9001), homeSong(9003, '셋째곡', 9003)],
        plans: [{ name: PLAN_NAME, items: [{ id: 'a1', type: 'song', songId: 9003, songTitle: '셋째곡', langs: ['ko'] }] }],
      }),
      'merge',
    );

    expect(result.songs).toBe(2);
    expect(result.skipped).toEqual([]);
    // 새로 매겨진 id 는 9003 이 아니다. 그래도 '셋째곡' 을 가리켜야 한다
    expect(linkedTitle()).toBe('셋째곡');
  });

  /**
   * 번들에 없는 곡을 가리키는 항목은 **이을 곳이 없다.** 조용히 넘기면 순서에는
   * 제목이 남아 멀쩡해 보이는데 예배 중에 안 나간다 — 미리 알려야 한다.
   */
  it('이을 곳이 없으면 알려 준다', () => {
    const result = applyBundle(
      bundleWith({
        songs: [homeSong(9001, '첫째곡', 9001)],
        plans: [{ name: PLAN_NAME, items: [{ id: 'a1', type: 'song', songId: 7777, songTitle: '없는곡', langs: ['ko'] }] }],
      }),
      'merge',
    );

    expect(result.skipped.some((one) => one.includes('없는곡'))).toBe(true);
  });

  /** 이미 있는 곡이면 새로 만들지 않고 **그 곡으로** 이어야 한다 */
  it('이미 있는 곡이면 그 곡으로 이어 준다', () => {
    const existing = songs.createSong({
      title: '이미있는곡',
      source: SOURCE,
      entries: [{ songbookId: 'hymn_new', number: 9005 }],
      sections: [{ kind: 'verse', label: '1절', lines: [{ lineIndex: 0, lang: 'ko', text: '가사' }] }],
    });

    const result = applyBundle(
      bundleWith({
        songs: [homeSong(9005, '이미있는곡', 9005)],
        plans: [{ name: PLAN_NAME, items: [{ id: 'a1', type: 'song', songId: 9005, songTitle: '이미있는곡', langs: ['ko'] }] }],
      }),
      'merge',
    );

    expect(result.songs).toBe(0);
    expect(result.songsExisting).toBe(1);
    const plan = plans.listPlans().find((one) => one.name === PLAN_NAME)!;
    const item = plan.items.find((one) => one.type === 'song')!;
    expect(item.type === 'song' && item.songId).toBe(existing);
  });
});

describe('merge 가 곡을 복제하지 않는다', () => {
  /**
   * 전에는 `createSong` 을 무조건 불러서, 같은 번들을 두 번 넣으면 곡이 통째로
   * 복제됐다. 자료를 주기적으로 주고받으면 매번 두 배가 된다.
   */
  it('같은 번들을 두 번 넣어도 곡이 늘지 않는다', () => {
    const bundle = bundleWith({ songs: [homeSong(9001, '첫째곡', 9001), homeSong(9002, '둘째곡', 9002)] });

    expect(applyBundle(bundle, 'merge').songs).toBe(2);
    const after = songs.countSongs();

    const again = applyBundle(bundle, 'merge');
    expect(again.songs).toBe(0);
    expect(again.songsExisting).toBe(2);
    expect(songs.countSongs()).toBe(after);
  });

  /**
   * **번호가 같아도 제목이 다르면 다른 곡이다.** 같은 번호를 두 곡이 갖는 경우가
   * 실제로 35건 있다 — 번호만 보고 건너뛰면 그중 한 곡이 조용히 사라진다.
   */
  it('번호가 같아도 제목이 다르면 둘 다 남는다', () => {
    applyBundle(bundleWith({ songs: [homeSong(9001, '첫째곡', 9001)] }), 'merge');
    const result = applyBundle(bundleWith({ songs: [homeSong(9002, '다른곡', 9001)] }), 'merge');

    expect(result.songs).toBe(1);
    expect(result.songsExisting).toBe(0);
  });

  /** 번호 없는 곡('기타' 등)은 제목으로 알아본다 — 아니면 넣을 때마다 복제된다 */
  it('번호가 없으면 제목으로 알아본다', () => {
    applyBundle(bundleWith({ songs: [homeSong(9001, '번호없는곡')] }), 'merge');
    const result = applyBundle(bundleWith({ songs: [homeSong(9002, '번호없는곡')] }), 'merge');

    expect(result.songs).toBe(0);
    expect(result.songsExisting).toBe(1);
  });
});
