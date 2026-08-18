/**
 * 배경 목록 API — **목록만 있다** (2026-08-18, D-B 결정).
 *
 * 업로드·삭제·총량 상한을 덜어냈다. 기획서 §1.3 이 배경 재생을 범위에서 제외했고
 * ("OBS가 이미 잘 함") 검수에서 그 판단으로 되돌렸다. 덜어내면서 보안 위험 S-1
 * (무인증 업로드로 디스크 고갈 → 가사 손실)도 함께 사라졌다.
 *
 * 여기서 지키는 것은 **쓰기 경로가 없다**는 것과 **그림만 나열한다**는 것이다.
 */

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../../server/app.ts';
import { isBackgroundImage, safeBackgroundName } from '../../server/routes/backgrounds.ts';
import type { ApiResponse } from '../../shared/types.ts';

let app: FastifyInstance;

beforeAll(async () => {
  const built = await buildApp({ getPort: () => 7777 });
  app = built.app;
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

interface ListBody {
  files: Array<{ name: string; bytes: number; url: string }>;
  library: Array<{ name: string; bytes: number; url: string }>;
  libraryDir: string;
  dataDir: string;
}

describe('목록', () => {
  it('두 폴더를 따로 알려 준다', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/backgrounds' });
    const body = res.json() as ApiResponse<ListBody>;
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data!.files)).toBe(true);
    expect(Array.isArray(body.data!.library)).toBe(true);
    // 어느 폴더를 보는지 화면에 알려 줄 수 있어야 한다
    expect(body.data!.libraryDir.length).toBeGreaterThan(0);
    expect(body.data!.dataDir.length).toBeGreaterThan(0);
  });

  it('용량과 주소를 함께 준다', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/backgrounds' });
    const body = res.json() as ApiResponse<ListBody>;
    for (const file of [...body.data!.files, ...body.data!.library]) {
      expect(typeof file.bytes).toBe('number');
      expect(file.url).toMatch(/^\/(backgrounds|background-library)\//);
    }
  });
});

describe('쓰기 경로가 없다', () => {
  /** 업로드가 없으면 디스크 고갈 위험(S-1)도 없다 */
  it('업로드(POST)를 받지 않는다', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/backgrounds',
      payload: { name: 'x.png', base64: 'AAAA' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('삭제(DELETE)를 받지 않는다', async () => {
    const res = await app.inject({ method: 'DELETE', url: '/api/backgrounds/x.png' });
    expect(res.statusCode).toBe(404);
  });
});

describe('그림만 배경이 된다', () => {
  it('동영상은 배경 목록에 들어가지 않는다 — OBS 미디어 소스가 맡는다', () => {
    for (const name of ['a.mp4', 'a.webm', 'a.mov', 'a.m4v']) {
      expect(isBackgroundImage(name), name).toBe(false);
      expect(safeBackgroundName(name), name).toBeUndefined();
    }
  });

  it('그림 확장자는 통과한다', () => {
    for (const name of ['a.png', 'a.JPG', 'a.jpeg', 'a.webp', 'a.gif', 'a.avif']) {
      expect(isBackgroundImage(name), name).toBe(true);
    }
  });

  /** 순서표에 담긴 배경 이름도 이 함수로 검증한다 — 두 곳에서 따로 막으면 어긋난다 */
  it('경로를 떼고 숨김·엉뚱한 확장자를 막는다', () => {
    expect(safeBackgroundName('sub/dir/bg.png')).toBe('bg.png');
    expect(safeBackgroundName('../../etc/passwd')).toBeUndefined();
    expect(safeBackgroundName('.env')).toBeUndefined();
    expect(safeBackgroundName('notes.txt')).toBeUndefined();
    expect(safeBackgroundName('')).toBeUndefined();
    expect(safeBackgroundName(42)).toBeUndefined();
  });
});
