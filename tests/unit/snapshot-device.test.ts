import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { onSameDevice } from '../../server/db/snapshot.ts';

/*
 * `songs.sqlite` 는 git 에 없어 되돌릴 방법이 백업뿐이다. 그 백업이 원본과 같은
 * 디스크에 있으면 디스크가 죽을 때 둘을 함께 잃는다 — 그것을 알려 주기 위한 판정이다.
 */
describe('백업이 원본과 같은 디스크인가', () => {
  it('같은 폴더 안의 두 경로는 같은 디스크다', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'snap-'));
    expect(onSameDevice(dir, dir)).toBe(true);
  });

  /* 확실할 때만 경고한다 — 헛경고가 잦으면 사람이 경고를 읽지 않게 된다 */
  it('없는 경로면 경고하지 않는다 (false)', () => {
    expect(onSameDevice('/nope/does/not/exist', tmpdir())).toBe(false);
    expect(onSameDevice(tmpdir(), '/nope/does/not/exist')).toBe(false);
  });
});
