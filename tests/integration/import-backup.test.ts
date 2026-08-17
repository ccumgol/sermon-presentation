/**
 * `replace` 가져오기 자동 백업 (SECURITY-AUDIT H-2).
 *
 * 이 경로는 **사용자 가사를 통째로 지운다.** 가사는 git 에 없어 되돌릴 방법이
 * 백업뿐이므로, 여기서 지키는 것은 두 가지다:
 *
 *  1. 지우기 **전에** 백업이 생긴다
 *  2. 백업을 못 뜨면 **아무것도 지우지 않는다** (보호 없이 지우면 안 된다)
 */

import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../../server/app.ts';
import * as planStore from '../../server/db/plans.ts';
import { snapshotDatabases } from '../../server/db/snapshot.ts';
import { paths } from '../../server/paths.ts';
import type { ApiResponse } from '../../shared/types.ts';

let app: FastifyInstance;

const EMPTY_BUNDLE = {
  format: 'sermon-presentation-bundle',
  version: 1,
  songs: [],
  templates: [],
  plans: [],
  settings: {},
  fonts: [],
};

/** 이 테스트가 만든 백업만 지우기 위해 시작 시각 이후 파일만 본다 */
function backupsNow(): string[] {
  if (!existsSync(paths.backupsDir)) return [];
  return readdirSync(paths.backupsDir).filter((name) => name.includes('before-import'));
}

beforeAll(async () => {
  const built = await buildApp({ getPort: () => 7777 });
  app = built.app;
  await app.ready();
  for (const name of backupsNow()) rmSync(path.join(paths.backupsDir, name), { force: true });
});

afterAll(async () => {
  for (const name of backupsNow()) rmSync(path.join(paths.backupsDir, name), { force: true });
  await app.close();
});

async function importBundle(mode: 'merge' | 'replace') {
  const response = await app.inject({
    method: 'POST',
    url: '/api/backup/import',
    payload: { mode, bundle: EMPTY_BUNDLE },
  });
  return { status: response.statusCode, body: response.json() as ApiResponse<Record<string, unknown>> };
}

describe('replace 가져오기 자동 백업', () => {
  it('지우기 전에 백업을 남긴다', async () => {
    planStore.createPlan({ name: '백업 확인용 순서', items: [] });

    const { status, body } = await importBundle('replace');
    expect(status).toBe(200);

    const files = body.data!.backupFiles as string[];
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) expect(existsSync(file)).toBe(true);
  });

  it('백업에 지워지기 전 내용이 들어 있다', () => {
    // 방금 만든 백업 중 app DB 스냅샷을 열어 순서표가 남아 있는지 본다
    const appSnapshot = backupsNow()
      .filter((name) => name.startsWith('app-'))
      .sort()
      .pop();
    expect(appSnapshot).toBeDefined();

    const db = new DatabaseSync(path.join(paths.backupsDir, appSnapshot!), { readOnly: true });
    try {
      const rows = db.prepare('SELECT name FROM service_plans').all() as unknown as Array<{ name: string }>;
      expect(rows.some((row) => row.name === '백업 확인용 순서')).toBe(true);
    } finally {
      db.close();
    }

    // 그리고 실제 DB 에서는 지워졌다 (replace 가 동작했다)
    expect(planStore.listPlans().some((plan) => plan.name === '백업 확인용 순서')).toBe(false);
  });

  it('merge 는 백업을 뜨지 않는다 (지우지 않으므로)', async () => {
    const before = backupsNow().length;
    const { body } = await importBundle('merge');
    expect(body.data!.backupFiles).toBeUndefined();
    expect(backupsNow().length).toBe(before);
  });

  it('백업을 못 뜨면 아무것도 지우지 않는다', async () => {
    planStore.createPlan({ name: '백업 실패 시 살아남아야 함', items: [] });

    // 백업 폴더 자리에 **파일**을 두어 스냅샷을 실패시킨다
    const dir = paths.backupsDir;
    const stash = `${dir}-stash`;
    if (existsSync(dir)) require('node:fs').renameSync(dir, stash);
    require('node:fs').writeFileSync(dir, 'not a directory');

    try {
      const { status, body } = await importBundle('replace');
      expect(status).toBe(400);
      expect(body.error).toContain('백업');

      // ★ 핵심: 데이터가 그대로 살아 있어야 한다
      expect(planStore.listPlans().some((plan) => plan.name === '백업 실패 시 살아남아야 함')).toBe(true);
    } finally {
      rmSync(dir, { force: true });
      if (existsSync(stash)) require('node:fs').renameSync(stash, dir);
      else mkdirSync(dir, { recursive: true });
    }
  });

  it('스냅샷은 WAL 내용까지 담는다 (VACUUM INTO)', () => {
    // 파일 복사였다면 WAL 에만 있는 최근 변경이 빠진다
    planStore.createPlan({ name: 'WAL 확인용', items: [] });
    const { files } = snapshotDatabases('wal-test');

    const appFile = files.find((file) => path.basename(file).startsWith('app-'));
    expect(appFile).toBeDefined();

    const db = new DatabaseSync(appFile!, { readOnly: true });
    try {
      const rows = db.prepare('SELECT name FROM service_plans').all() as unknown as Array<{ name: string }>;
      expect(rows.some((row) => row.name === 'WAL 확인용')).toBe(true);
    } finally {
      db.close();
      rmSync(appFile!, { force: true });
      for (const file of files) rmSync(file, { force: true });
    }
  });
});
