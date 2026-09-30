/**
 * **동영상 폴더를 훑는 길** (`server/routes/videos.ts`).
 *
 * ## 왜 필요한가
 *
 * 이 코드가 정하는 것은 **예배 중에 무엇을 고를 수 있는가**다. 여기서 빠진 파일은
 * 순서표에 넣을 수 없고, 여기서 «안전» 으로 잘못 나온 파일은 **예배 중에 화면이
 * 안 나간다.** 그런데 파일시스템을 읽는 것이 전부라 흉내로는 아무것도 확인하지 못한다.
 *
 * ## 진짜 폴더를 만든다
 *
 * 검사용 데이터 폴더(`.test-data/videos`) 안에만 만들고 끝나면 지운다.
 * 사용자가 USB 에서 넣어 둔 실제 영상은 건드리지 않는다.
 *
 * (`lib/video-files.ts` 의 형식 판정 자체는 `tests/unit/video-files.test.ts` 가 본다.
 * 여기서는 **폴더를 훑는 쪽** — 무엇을 넣고 무엇을 빼는가 — 만 본다.)
 */

import { mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../../server/app.ts';
import { listVideos } from '../../server/routes/videos.ts';
import { paths } from '../../server/paths.ts';
import type { ApiResponse } from '../../shared/types.ts';

let app: FastifyInstance;

/** 이 검사가 만든 것만 지우기 위한 이름표 */
const MARK = 'zz-test-video';
const root = paths.videosDir;

function put(name: string, bytes = 5): void {
  writeFileSync(path.join(root, name), Buffer.alloc(bytes));
}

beforeAll(async () => {
  app = (await buildApp({ getPort: () => 7777 })).app;
  await app.ready();

  mkdirSync(root, { recursive: true });

  put(`${MARK}-2 선교보고.mp4`, 2048);
  put(`${MARK}-1 안내.MP4`, 1024); // 대문자 — 카메라가 이렇게 쓴다
  put(`${MARK}-10 마지막.mp4`, 256); // 10 — 문자열 비교면 2 앞으로 온다
  put(`${MARK}-9 아이폰.mov`, 512); // 못 열릴 수 있는 것
  put(`${MARK}-가사.txt`); // 동영상이 아니다
  put(`.${MARK}-숨김.mp4`); // 숨김 파일
  mkdirSync(path.join(root, `${MARK}-폴더.mp4`), { recursive: true }); // 이름만 영상인 폴더

  /*
   * **끊어진 바로가기** — 목록에는 이름이 뜨는데 열면 없는 파일.
   * USB 를 꽂아 둔 채 뺐거나, 훑는 사이에 지워지면 이렇게 된다.
   * 하나 때문에 목록 전체가 죽으면 예배 준비가 막힌다.
   */
  symlinkSync(path.join(root, '없는파일.mp4'), path.join(root, `${MARK}-끊김.mp4`));
});

afterAll(async () => {
  for (const name of [
    `${MARK}-2 선교보고.mp4`,
    `${MARK}-1 안내.MP4`,
    `${MARK}-10 마지막.mp4`,
    `${MARK}-9 아이폰.mov`,
    `${MARK}-가사.txt`,
    `.${MARK}-숨김.mp4`,
    `${MARK}-폴더.mp4`,
    `${MARK}-끊김.mp4`,
  ]) {
    rmSync(path.join(root, name), { recursive: true, force: true });
  }
  await app.close();
});

/** 이 검사가 만든 것만 본다 — 사용자가 넣어 둔 영상이 섞여 있을 수 있다 */
function mine(): ReturnType<typeof listVideos> {
  return listVideos().filter((file) => file.name.includes(MARK));
}

describe('동영상 폴더', () => {
  it('동영상만 고르고 나머지는 뺀다', () => {
    const names = mine().map((file) => file.name);
    expect(names).toContain(`${MARK}-2 선교보고.mp4`);
    expect(names).toContain(`${MARK}-1 안내.MP4`);
    expect(names).toContain(`${MARK}-9 아이폰.mov`);
    // 자막·가사 파일이 섞이면 고르기가 나빠진다
    expect(names).not.toContain(`${MARK}-가사.txt`);
  });

  it('숨김 파일은 빼고, 이름만 영상인 폴더도 뺀다', () => {
    const names = mine().map((file) => file.name);
    expect(names.some((name) => name.startsWith('.'))).toBe(false);
    // 폴더를 내주면 고른 뒤 예배 중에 재생이 실패한다
    expect(names).not.toContain(`${MARK}-폴더.mp4`);
  });

  it('끊어진 바로가기 하나 때문에 목록 전체가 죽지 않는다', () => {
    const names = mine().map((file) => file.name);
    // 그것만 빠지고 나머지는 그대로 나온다
    expect(names).not.toContain(`${MARK}-끊김.mp4`);
    expect(names).toContain(`${MARK}-2 선교보고.mp4`);
  });

  it('숫자를 사람이 세는 차례로 늘어놓는다', () => {
    const names = mine().map((file) => file.name);
    expect(names.indexOf(`${MARK}-1 안내.MP4`)).toBeLessThan(names.indexOf(`${MARK}-2 선교보고.mp4`));
    /*
     * **여기가 요점이다.** 그냥 문자열로 견주면 `10` 이 `2` **앞**에 온다 —
     * 목록에서 10번 영상이 2번 위에 앉는다.
     */
    expect(names.indexOf(`${MARK}-2 선교보고.mp4`)).toBeLessThan(names.indexOf(`${MARK}-10 마지막.mp4`));
  });

  it('못 열릴 수 있는 것은 빼지 않고 **왜인지 붙여** 내준다', () => {
    const mov = mine().find((file) => file.name.endsWith('.mov'));
    expect(mov?.risk).toBe('risky');
    expect(mov?.warning).toBeTruthy();

    const mp4 = mine().find((file) => file.name.endsWith('.mp4'));
    expect(mp4?.risk).toBe('ok');
    expect(mp4?.warning).toBeUndefined();
  });

  it('주소는 그대로 쓸 수 있게 인코딩해 준다', () => {
    // 이름에 공백·한글이 있다. 그대로 넘기면 출력 페이지에서 404 가 난다
    const file = mine().find((f) => f.name === `${MARK}-2 선교보고.mp4`);
    expect(file?.url).toBe(`/videos/${encodeURIComponent(`${MARK}-2 선교보고.mp4`)}`);
    expect(file?.bytes).toBe(2048);
  });

  it('그 주소로 실제 파일이 내려온다 — 범위 요청까지', async () => {
    const file = mine().find((f) => f.name === `${MARK}-2 선교보고.mp4`)!;
    /*
     * 영상은 수백 MB 라 **앞부분부터 흘려보내야** 바로 재생되고 되감기가 된다.
     * `206 Partial Content` 가 그 장치다 — 이게 깨지면 큰 영상이 안 열린다.
     */
    const ranged = await app.inject({ method: 'GET', url: file.url, headers: { range: 'bytes=0-99' } });
    expect(ranged.statusCode).toBe(206);
    expect(ranged.headers['content-range']).toBe('bytes 0-99/2048');
  });

  it('API 가 폴더 자리를 함께 알려 준다', async () => {
    // 비어 있을 때 '어디에 넣어야 하는지' 를 화면이 그 자리에서 말해 줄 수 있어야 한다
    const res = await app.inject({ method: 'GET', url: '/api/videos' });
    const body = res.json() as ApiResponse<{ files: unknown[]; dir: string }>;
    expect(body.success).toBe(true);
    expect(body.data?.dir).toBe(root);
  });
});
