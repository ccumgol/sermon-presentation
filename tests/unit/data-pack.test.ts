/**
 * 자료 꾸러미의 **판정 규칙** (`lib/data-pack.ts`).
 *
 * 여기서 지키는 것은 하나다 — **사람이 손본 것을 덮지 않는다.**
 * `songs.sqlite`(가사)와 `app.sqlite`(설정·순서표)는 그 PC 에서만 있는 것이고
 * git 에 없다. 한 번 덮으면 되돌릴 방법이 백업뿐이다.
 */
import { describe, expect, it } from 'vitest';

import {
  DATA_PACK_FORMAT,
  DATA_PACK_VERSION,
  PACK_DATABASES,
  formatBytes,
  holdsUserData,
  readManifest,
} from '../../lib/data-pack.ts';

describe('사람이 손본 것이 든 파일', () => {
  it('가사와 순서표가 그렇다', () => {
    expect(holdsUserData('songs.sqlite')).toBe(true);
    expect(holdsUserData('app.sqlite')).toBe(true);
  });

  /** 성경·악보는 원본에서 만들어 낸 것이라 같은 자료면 같은 결과다 */
  it('성경과 악보는 아니다', () => {
    expect(holdsUserData('bible.sqlite')).toBe(false);
    expect(holdsUserData('sheets')).toBe(false);
  });

  /** 꾸러미에 담기는 것은 모두 이 판정을 지난다 — 새 항목이 늘어도 빠지지 않게 */
  it('꾸러미에 담는 DB 셋이 모두 판정 대상이다', () => {
    expect([...PACK_DATABASES]).toEqual(['bible.sqlite', 'songs.sqlite', 'app.sqlite']);
    expect(PACK_DATABASES.filter(holdsUserData)).toEqual(['songs.sqlite', 'app.sqlite']);
  });
});

/**
 * **엉뚱한 폴더를 고르면 걸러야 한다.** 통과시키면 그 안의 파일을 데이터 폴더에
 * 쏟아붓게 된다.
 */
describe('꾸러미인지 알아본다', () => {
  const good = {
    format: DATA_PACK_FORMAT,
    version: DATA_PACK_VERSION,
    builtAt: '2026-09-12T19:21:19.750Z',
    entries: [{ name: 'bible.sqlite', bytes: 107216896 }],
  };

  it('제대로 된 것은 통과한다', () => {
    const read = readManifest(good);
    expect(read?.version).toBe(DATA_PACK_VERSION);
    expect(read?.entries).toHaveLength(1);
  });

  it('표시가 없거나 다르면 거절한다', () => {
    expect(readManifest({ ...good, format: 'something-else' })).toBeUndefined();
    expect(readManifest({ ...good, format: undefined })).toBeUndefined();
  });

  it('판이나 만든 시각이 없으면 거절한다 — 어느 꾸러미인지 알 수 없다', () => {
    expect(readManifest({ ...good, version: '' })).toBeUndefined();
    expect(readManifest({ ...good, version: 7 })).toBeUndefined();
    expect(readManifest({ ...good, builtAt: undefined })).toBeUndefined();
  });

  it('아무것이나 주어도 던지지 않는다', () => {
    for (const bad of [null, undefined, 'text', 42, []]) {
      expect(readManifest(bad)).toBeUndefined();
    }
  });

  /** 목록이 깨져 있어도 **꾸러미 자체는 살린다** — 목록은 보여 주기용이다 */
  it('목록이 이상하면 그 항목만 버린다', () => {
    const read = readManifest({ ...good, entries: [{ name: 'a', bytes: 1 }, { name: 'b' }, 'x', null] });
    expect(read?.entries).toEqual([{ name: 'a', bytes: 1 }]);
  });

  it('목록이 아예 없어도 통과한다', () => {
    expect(readManifest({ ...good, entries: undefined })?.entries).toEqual([]);
  });
});

describe('사람이 읽는 크기', () => {
  it('단위를 골라 준다', () => {
    expect(formatBytes(107216896)).toBe('102MB');
    expect(formatBytes(331776)).toBe('324KB');
    expect(formatBytes(512)).toBe('512B');
    expect(formatBytes(2 * 1024 ** 3)).toBe('2.0GB');
  });
});
