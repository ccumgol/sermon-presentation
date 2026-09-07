/**
 * **자료를 옮겨도 사람이 한 작업이 남는다** (점검 P-2, 2026-09-07).
 *
 * 번들에는 `confirmed`·`isFavorite`·구간별 `linesSource`·`links` 가 실려 있었는데
 * 가져오기가 그것을 **버렸다.** `createSong` 에 `linesSource` 를 넘기지 않아
 * 기본값 `'auto'` 가 되고, 즐겨찾기와 대응곡은 아예 손대지 않았다.
 *
 * 그 결과 봉사자 PC 로 옮기면 (또는 백업에서 되살리면)
 *
 *  - 승인(`manual`)·원본 줄나눔(`imported`) 표시가 전부 `auto` 로 내려간다
 *    → 그 곡들이 검토 대기열로 되돌아오고 **자동 재정렬의 대상이 된다**
 *  - 즐겨찾기가 비고, 새찬송가↔통일찬송가 대응 연결이 끊긴다
 *
 * 실데이터로는 구간 10,305개 중 2,304개(manual 50 · imported 2,254)가 걸렸다.
 *
 * ## 이 검사가 지키는 것
 *
 * **한 곡 안에서 구간마다 값이 다른 경우**까지 확인한다. 곡 단위로 하나만 옮기면
 * '1절만 승인한 곡' 이 통째로 승인되거나 통째로 자동이 된다.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { applyBundle, buildBundle, type Bundle } from '../../server/routes/backup.ts';
import * as store from '../../server/db/songs.ts';
import { initAppDb } from '../../server/db/app.ts';
import type { LinesSource } from '../../server/db/songs.ts';
import type { Song } from '../../shared/types.ts';

const TITLE_A = '이전 충실도 시험 가';
const TITLE_B = '이전 충실도 시험 나';

/** 구간마다 다른 값을 준다 — 곡 단위로 옮기면 이 조합이 무너진다 */
const MIXED: readonly LinesSource[] = ['manual', 'auto', 'imported'];

function makeSections(): store.SongInput['sections'] {
  return MIXED.map((linesSource, index) => ({
    kind: 'verse' as const,
    label: `${index + 1}절`,
    lines: [{ lineIndex: 0, lang: 'ko' as const, text: `${index + 1}절 첫 줄` }],
    linesSource,
  }));
}

/** 제목으로 곡을 찾는다 (가져오기가 새 id 를 발급하므로) */
function findByTitle(title: string): Song | undefined {
  for (const hit of store.listSongs(100000)) {
    if (hit.title === title) return store.getSong(hit.id);
  }
  return undefined;
}

function cleanUp(): void {
  for (const title of [TITLE_A, TITLE_B]) {
    const found = findByTitle(title);
    if (found) store.deleteSong(found.id);
  }
}

let bundle: Bundle;

beforeAll(() => {
  initAppDb();
  store.initSongsDb();
  cleanUp();

  const idA = store.createSong({ title: TITLE_A, sections: makeSections() });
  const idB = store.createSong({ title: TITLE_B, sections: makeSections() });
  store.toggleFavorite(idA, true);
  store.linkSongs(idA, idB);

  bundle = buildBundle();

  // 옮긴 PC 를 흉내 낸다 — 그 곡이 없는 상태에서 번들을 받는다
  store.deleteSong(idA);
  store.deleteSong(idB);
});

afterAll(() => {
  cleanUp();
});

describe('번들이 정보를 담는다', () => {
  it('구간별 linesSource · 즐겨찾기 · 대응곡이 번들에 있다', () => {
    const exported = bundle.songs.find((song) => song.title === TITLE_A);
    expect(exported).toBeDefined();
    expect(exported!.sections.map((section) => section.linesSource)).toEqual([...MIXED]);
    expect(exported!.isFavorite).toBe(true);
    expect(exported!.links?.map((link) => link.title)).toEqual([TITLE_B]);
  });
});

describe('가져오기가 그것을 되살린다', () => {
  beforeAll(() => {
    const result = applyBundle(bundle, 'merge');
    // 대응곡 한 짝이 양쪽에서 한 번씩 걸린다
    expect(result.links).toBeGreaterThanOrEqual(1);
  });

  it('구간별 줄나눔 출처가 그대로다 — 승인이 auto 로 내려가지 않는다', () => {
    const restored = findByTitle(TITLE_A);
    expect(restored).toBeDefined();
    expect(restored!.sections.map((section) => section.linesSource)).toEqual([...MIXED]);
  });

  it('승인 표시(confirmed)가 유지된다', () => {
    // `confirmed` 는 '모든 구간이 auto 가 아님' 이므로, 섞인 곡은 false 가 맞다.
    // 여기서 확인하는 것은 **값이 계산되는 근거가 살아 있는가** 다.
    const restored = findByTitle(TITLE_A)!;
    expect(restored.sections.some((section) => section.linesSource === 'manual')).toBe(true);
    expect(restored.sections.some((section) => section.linesSource === 'imported')).toBe(true);
  });

  it('즐겨찾기가 유지된다', () => {
    const restored = findByTitle(TITLE_A)!;
    expect(restored.isFavorite).toBe(true);
    expect(store.listFavorites(100).some((hit) => hit.title === TITLE_A)).toBe(true);
  });

  it('대응곡 연결이 양방향으로 되살아난다', () => {
    const a = findByTitle(TITLE_A)!;
    const b = findByTitle(TITLE_B)!;
    expect(a.links?.map((link) => link.id)).toEqual([b.id]);
    expect(b.links?.map((link) => link.id)).toEqual([a.id]);
  });

  it('상대 곡이 번들에 없으면 조용히 넘기지 않고 알린다', () => {
    const orphan: Bundle = {
      ...bundle,
      songs: [
        {
          ...bundle.songs.find((song) => song.title === TITLE_A)!,
          title: '대응곡 짝 없는 곡',
          links: [{ id: 999999, title: '없는 상대', entries: [] }],
        },
      ],
    };
    const result = applyBundle(orphan, 'merge');
    expect(result.skipped.some((line) => line.includes('대응곡'))).toBe(true);

    const created = findByTitle('대응곡 짝 없는 곡');
    if (created) store.deleteSong(created.id);
  });
});
