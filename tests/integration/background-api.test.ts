/**
 * 배경 파일 라우트 통합 테스트.
 *
 * 이 라우트는 **파일을 쓰는 유일한 API** 라 방어가 핵심이다.
 * 경로를 담은 이름(`../../`), 허용하지 않는 확장자, 빈 내용이 통과하면
 * 데이터 폴더 밖에 파일이 생길 수 있다.
 */

import { existsSync, rmSync } from 'node:fs';
import path from 'node:path';

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../../server/app.ts';
import { paths } from '../../server/paths.ts';
import { safeBackgroundName, type BackgroundFile } from '../../server/routes/backgrounds.ts';
import type { ApiResponse } from '../../shared/types.ts';

let app: FastifyInstance;

/** 이 테스트가 만든 파일만 지운다 */
const createdFiles: string[] = [];

// 1×1 투명 PNG
const TINY_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

beforeAll(async () => {
  const built = await buildApp({ getPort: () => 7777 });
  app = built.app;
  await app.ready();
});

afterAll(async () => {
  for (const name of createdFiles) {
    const full = path.join(paths.backgroundsDir, name);
    if (existsSync(full)) rmSync(full);
  }
  await app.close();
});

async function post<T>(payload: Record<string, unknown>): Promise<{ status: number; body: ApiResponse<T> }> {
  const response = await app.inject({ method: 'POST', url: '/api/backgrounds', payload });
  return { status: response.statusCode, body: response.json() as ApiResponse<T> };
}

describe('safeBackgroundName — 이름 검증', () => {
  it('그림·동영상 확장자만 통과한다', () => {
    expect(safeBackgroundName('sunrise.jpg')).toBe('sunrise.jpg');
    expect(safeBackgroundName('loop.MP4')).toBe('loop.MP4');
    expect(safeBackgroundName('script.sh')).toBeUndefined();
    expect(safeBackgroundName('notes.txt')).toBeUndefined();
  });

  it('경로를 담은 이름은 파일 이름만 남긴다', () => {
    // 상위 폴더로 나가는 이름이 그대로 쓰이면 데이터 폴더 밖에 파일이 생긴다
    expect(safeBackgroundName('../../evil.png')).toBe('evil.png');
    expect(safeBackgroundName('/etc/passwd.png')).toBe('passwd.png');
  });

  it('빈 이름·숨김 파일·문자열이 아닌 값은 거부한다', () => {
    expect(safeBackgroundName('')).toBeUndefined();
    expect(safeBackgroundName('   ')).toBeUndefined();
    expect(safeBackgroundName('.hidden.png')).toBeUndefined();
    expect(safeBackgroundName(42)).toBeUndefined();
    expect(safeBackgroundName(null)).toBeUndefined();
  });
});

describe('배경 API', () => {
  it('목록과 올리기 한도를 준다', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/backgrounds' });
    const body = response.json() as ApiResponse<{ files: BackgroundFile[]; maxUploadBytes: number }>;
    expect(response.statusCode).toBe(200);
    expect(Array.isArray(body.data!.files)).toBe(true);
    expect(body.data!.maxUploadBytes).toBeGreaterThan(0);
  });

  it('그림을 올리면 목록과 폴더에 나타난다', async () => {
    createdFiles.push('agent-j-test.png');
    const { status, body } = await post<{ file: BackgroundFile | null }>({
      name: 'agent-j-test.png',
      base64: TINY_PNG,
    });

    expect(status).toBe(200);
    expect(body.data!.file).toMatchObject({ name: 'agent-j-test.png', kind: 'image' });
    expect(existsSync(path.join(paths.backgroundsDir, 'agent-j-test.png'))).toBe(true);

    const list = (
      (await app.inject({ method: 'GET', url: '/api/backgrounds' })).json() as ApiResponse<{
        files: BackgroundFile[];
      }>
    ).data!.files;
    expect(list.some((f) => f.name === 'agent-j-test.png')).toBe(true);
  });

  it('올린 파일을 /backgrounds/ 로 내려준다', async () => {
    const response = await app.inject({ method: 'GET', url: '/backgrounds/agent-j-test.png' });
    expect(response.statusCode).toBe(200);
  });

  it('허용하지 않는 확장자는 400 — 파일이 생기지 않는다', async () => {
    const { status } = await post({ name: 'evil.sh', base64: TINY_PNG });
    expect(status).toBe(400);
    expect(existsSync(path.join(paths.backgroundsDir, 'evil.sh'))).toBe(false);
  });

  it('경로를 담은 이름은 데이터 폴더 안에만 쓴다', async () => {
    createdFiles.push('escape.png');
    const { status } = await post({ name: '../../escape.png', base64: TINY_PNG });

    expect(status).toBe(200);
    expect(existsSync(path.join(paths.backgroundsDir, 'escape.png'))).toBe(true);
    // 상위 폴더로 새어 나가지 않았다
    expect(existsSync(path.join(paths.backgroundsDir, '..', '..', 'escape.png'))).toBe(false);
  });

  it('내용이 비면 400', async () => {
    const { status } = await post({ name: 'empty.png', base64: '' });
    expect(status).toBe(400);
    expect(existsSync(path.join(paths.backgroundsDir, 'empty.png'))).toBe(false);
  });
});
