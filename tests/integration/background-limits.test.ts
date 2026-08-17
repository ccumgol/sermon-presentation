/**
 * 배경 삭제·총량 상한 (SECURITY-AUDIT S-1).
 *
 * 파일당 한도만으로는 **개수를 막지 못한다.** 반복 업로드로 디스크가 차면 같은
 * 볼륨의 `data/songs.sqlite` 쓰기가 실패해 직접 손본 가사가 저장되지 않는다.
 * 메모리 고갈은 재시작하면 끝이지만 이건 데이터가 걸린다.
 *
 * 삭제는 그 반대 위험이 있다 — 배경은 템플릿이 **이름으로** 참조하므로 그냥
 * 지우면 템플릿이 조용히 깨지고 예배 중에 발견하게 된다.
 */

import { existsSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';

import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { BUILTIN_TEMPLATES } from '../../lib/template-presets.ts';
import { buildApp } from '../../server/app.ts';
import * as templateStore from '../../server/db/templates.ts';
import { paths } from '../../server/paths.ts';
import type { ApiResponse } from '../../shared/types.ts';

let app: FastifyInstance;
const createdTemplates: number[] = [];

/** 1×1 png */
const TINY_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const PREFIX = 'zz-limit-test-';

function testFiles(): string[] {
  if (!existsSync(paths.backgroundsDir)) return [];
  return readdirSync(paths.backgroundsDir).filter((name) => name.startsWith(PREFIX));
}

function cleanup(): void {
  for (const name of testFiles()) rmSync(path.join(paths.backgroundsDir, name), { force: true });
}

beforeAll(async () => {
  const built = await buildApp({ getPort: () => 7777 });
  app = built.app;
  await app.ready();
  cleanup();
});

afterEach(cleanup);

afterAll(async () => {
  cleanup();
  for (const id of createdTemplates) {
    try {
      templateStore.deleteTemplate(id);
    } catch {
      // 이미 지워졌으면 무시
    }
  }
  await app.close();
});

async function upload(name: string, base64 = TINY_PNG) {
  const response = await app.inject({ method: 'POST', url: '/api/backgrounds', payload: { name, base64 } });
  return { status: response.statusCode, body: response.json() as ApiResponse<Record<string, unknown>> };
}

async function remove(name: string, force = false) {
  const response = await app.inject({
    method: 'DELETE',
    url: `/api/backgrounds/${encodeURIComponent(name)}${force ? '?force=true' : ''}`,
  });
  return { status: response.statusCode, body: response.json() as ApiResponse<Record<string, unknown>> };
}

describe('배경 삭제', () => {
  it('올린 배경을 지울 수 있다', async () => {
    const name = `${PREFIX}a.png`;
    expect((await upload(name)).status).toBe(200);
    expect(existsSync(path.join(paths.backgroundsDir, name))).toBe(true);

    const { status } = await remove(name);
    expect(status).toBe(200);
    expect(existsSync(path.join(paths.backgroundsDir, name))).toBe(false);
  });

  it('없는 배경은 404', async () => {
    expect((await remove(`${PREFIX}nope.png`)).status).toBe(404);
  });

  it('경로 이탈 이름은 400', async () => {
    // safeBackgroundName 이 basename 으로 자르므로 상위 폴더를 가리킬 수 없다
    const response = await app.inject({ method: 'DELETE', url: '/api/backgrounds/..%2F..%2Fsongs.sqlite' });
    expect([400, 404]).toContain(response.statusCode);
    expect(existsSync(paths.songsDb)).toBe(true);
  });

  it('템플릿이 쓰는 배경은 막고 어느 템플릿인지 알려 준다', async () => {
    const name = `${PREFIX}used.png`;
    await upload(name);

    const created = templateStore.createTemplate({
      ...BUILTIN_TEMPLATES[0]!,
      name: '배경 쓰는 템플릿',
      canvas: { ...BUILTIN_TEMPLATES[0]!.canvas, background: { mode: 'image', src: name } },
    } as never);
    createdTemplates.push(created.id);

    const { status, body } = await remove(name);
    expect(status).toBe(409);
    expect(body.error).toContain('배경 쓰는 템플릿');
    // 막혔으니 파일은 그대로여야 한다
    expect(existsSync(path.join(paths.backgroundsDir, name))).toBe(true);

    // 강제로는 지워진다
    expect((await remove(name, true)).status).toBe(200);
    expect(existsSync(path.join(paths.backgroundsDir, name))).toBe(false);

    templateStore.deleteTemplate(created.id);
  });
});

describe('총량 상한', () => {
  it('목록이 현재 총량과 한도를 함께 준다', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/backgrounds' });
    const data = (response.json() as ApiResponse<Record<string, number>>).data!;
    expect(typeof data.totalBytes).toBe('number');
    expect(data.maxTotalBytes).toBeGreaterThan(0);
  });

  it('한도를 넘으면 507 로 거부하고 무엇을 하면 되는지 알려 준다', async () => {
    // 한도를 아주 낮춰 재현한다.
    // MAX_TOTAL_BYTES 는 모듈을 읽는 시점에 env 를 보므로 캐시를 비우고 다시 읽는다.
    const previous = process.env.SERMON_MAX_BACKGROUND_BYTES;
    process.env.SERMON_MAX_BACKGROUND_BYTES = '10';
    vi.resetModules();

    const { buildApp: rebuild } = await import('../../server/app.ts');
    const tiny = await rebuild({ getPort: () => 7777 });
    await tiny.app.ready();

    try {
      const response = await tiny.app.inject({
        method: 'POST',
        url: '/api/backgrounds',
        payload: { name: `${PREFIX}over.png`, base64: TINY_PNG },
      });
      expect(response.statusCode).toBe(507);
      const body = response.json() as ApiResponse<null>;
      expect(body.error).toContain('한도');
      expect(body.error).toContain('SERMON_MAX_BACKGROUND_BYTES');
    } finally {
      await tiny.app.close();
      if (previous === undefined) delete process.env.SERMON_MAX_BACKGROUND_BYTES;
      else process.env.SERMON_MAX_BACKGROUND_BYTES = previous;
      vi.resetModules();
    }
  });

  it('같은 이름으로 덮어쓰면 알려 준다', async () => {
    const name = `${PREFIX}same.png`;
    const first = await upload(name);
    expect(first.body.data!.replaced).toBe(false);

    const second = await upload(name);
    expect(second.body.data!.replaced).toBe(true);
  });
});

describe('용량 표시', () => {
  it('작은 값이 0MB 로 뭉개지지 않는다', async () => {
    // "한도(0MB)를 넘습니다. 지금 0MB 를 쓰고 있습니다" 를 본 적이 있다
    const { formatBytes } = await import('../../server/routes/backgrounds.ts');
    expect(formatBytes(70)).toBe('70B');
    expect(formatBytes(200 * 1024)).toBe('200KB');
    expect(formatBytes(64 * 1024 * 1024)).toBe('64MB');
    expect(formatBytes(2 * 1024 * 1024 * 1024)).toBe('2.0GB');
  });
});
