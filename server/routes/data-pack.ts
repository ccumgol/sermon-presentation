/**
 * **자료 꾸러미 설치** — 다른 PC 에서 만든 자료를 이 PC 에 넣는다 (2026-09-12 사용자 요청).
 *
 * ## 왜 올리지 않고 폴더에서 읽나
 *
 * 꾸러미는 **158MB** 다. 브라우저로 올리면 그만한 양이 메모리를 거쳐 가고, 중간에
 * 끊기면 무엇이 들어갔는지 알 수 없다. 그런데 조작 화면과 서버는 **같은 PC** 다 —
 * 사람이 데이터 폴더에 넣어 두면 서버가 바로 읽으면 된다.
 *
 * 그래서 자리를 정해 둔다: **데이터 폴더 안의 `install/`**.
 * 설정 탭의 '데이터 폴더 열기' 로 열고 거기 넣는다.
 *
 * ## ⚠️ 사람이 손본 것은 덮지 않는다
 *
 * `songs.sqlite`(가사)와 `app.sqlite`(설정·순서표)에는 **그 PC 에서 손본 것**이 있고
 * git 에 없다. 이미 있으면 **건드리지 않는다** — 합치는 일은 이미 있는
 * '자료 가져오기(번들)' 가 한다 (검사도 그쪽에 있다).
 *
 * 성경·악보는 원본에서 만들어 낸 것이라 같은 자료면 같은 결과다. 그래도 덮기 전에
 * `snapshotDatabases()` 로 뜬다.
 *
 * ## 열려 있는 DB 를 덮지 않는다
 *
 * 윈도우는 열려 있는 파일을 바꾸지 못한다(sharing violation). 맥은 되지만 그러면
 * 서버가 **옛 파일을 붙든 채** 돌아 화면과 파일이 어긋난다. 그래서 닫고 → 바꾸고 →
 * 다시 연다.
 */

import { DatabaseSync } from 'node:sqlite';
import { copyFileSync, cpSync, existsSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';

import type { FastifyInstance, FastifyRequest } from 'fastify';

import {
  PACK_DATABASES,
  PACK_FOLDERS,
  holdsUserData,
  readManifest,
  type DataPackManifest,
} from '../../lib/data-pack.ts';
import { isLoopbackAddress } from '../../lib/lan-auth.ts';
import type { ApiResponse } from '../../shared/types.ts';
import { closeAppDb, initAppDb } from '../db/app.ts';
import { closeBibleDb } from '../db/bible.ts';
import { closeSongsDb, initSongsDb } from '../db/songs.ts';
import { initReadingStore } from '../db/readings.ts';
import { snapshotDatabases } from '../db/snapshot.ts';
import { initTemplateStore } from '../db/templates.ts';
import { paths } from '../paths.ts';

function ok<T>(data: T): ApiResponse<T> {
  return { success: true, data, error: null };
}

function fail(error: string): ApiResponse<null> {
  return { success: false, data: null, error };
}

/** 꾸러미를 놓는 자리 — 설정 탭이 이 경로를 사람에게 보여 준다 */
export function installDir(): string {
  return path.join(paths.dataDir, 'install');
}

interface PackStatus {
  dir: string;
  found: boolean;
  manifest?: DataPackManifest;
  /** 넣으면 무엇이 될지 — 사람이 **누르기 전에** 알아야 한다 */
  plan: Array<{ name: string; action: 'install' | 'replace' | 'skip'; reason?: string }>;
}

/**
 * 꾸러미를 살펴본다. **아무것도 바꾸지 않는다** — 누르기 전에 보여 줄 것이다.
 *
 * `install/` 안에 `manifest.json` 이 바로 있을 수도 있고, 폴더를 통째로 끌어다 놓아
 * 한 겹 더 들어가 있을 수도 있다(`install/sermon-data-0.1.0/`). 둘 다 받는다 —
 * 사람이 어느 쪽으로 넣을지 우리가 정할 수 없다.
 */
export function inspectPack(): PackStatus {
  const root = installDir();
  const candidates = [root];
  if (existsSync(root)) {
    for (const name of readdirSync(root)) {
      const full = path.join(root, name);
      try {
        if (statSync(full).isDirectory()) candidates.push(full);
      } catch {
        // 읽을 수 없는 항목은 건너뛴다 — 하나 때문에 전체가 죽지 않게
      }
    }
  }

  for (const dir of candidates) {
    const file = path.join(dir, 'manifest.json');
    if (!existsSync(file)) continue;
    let manifest: DataPackManifest | undefined;
    try {
      manifest = readManifest(JSON.parse(readFileSync(file, 'utf8')));
    } catch {
      continue; // 깨진 JSON — 다음 후보를 본다
    }
    if (!manifest) continue;

    return { dir, found: true, manifest, plan: planFor(dir) };
  }

  return { dir: root, found: false, plan: [] };
}

function planFor(dir: string): PackStatus['plan'] {
  const plan: PackStatus['plan'] = [];

  for (const name of [...PACK_DATABASES, ...PACK_FOLDERS]) {
    const source = path.join(dir, name);
    if (!existsSync(source)) continue;

    const target = path.join(paths.dataDir, name);
    if (!existsSync(target)) {
      plan.push({ name, action: 'install' });
    } else if (!holdsUserData(name)) {
      plan.push({ name, action: 'replace' });
    } else if (isUntouched(target, name)) {
      /*
       * 앱은 처음 뜰 때 **빈 DB 를 만든다.** 파일이 있다고 건너뛰면 새 PC 에서
       * 가사가 안 들어간다 — 이 기능이 쓰이는 바로 그 자리다 (2026-09-12 실측).
       */
      plan.push({ name, action: 'install', reason: '이 PC 에 만들어 둔 것이 없습니다' });
    } else {
      plan.push({
        name,
        action: 'skip',
        reason: '이 PC 에 이미 자료가 있습니다 — 손본 것이 사라지지 않게 건드리지 않습니다',
      });
    }
  }

  return plan;
}

/**
 * 이 DB 에 **사람이 만든 흔적이 하나도 없는가** — 없으면 넣어도 잃을 것이 없다.
 *
 * ⚠️ **'행이 0개' 로는 못 가른다.** 앱은 첫 기동에 기본 예배 유형 넷을 넣고,
 * 그 유형들은 **항목까지 들고 있다** (2026-09-12 실측: 주일예배 11개 · 수요예배 6개 …).
 * 그래서 표마다 '사람이 만든 것' 이 무엇인지 골라 센다.
 *
 * | | 갓 만든 PC | 쓰던 PC (실측) |
 * |---|---:|---:|
 * | `kind='plan'` 순서표 | 0 | 3 |
 * | 템플릿 | 0 | 4 |
 * | 교독문 | 0 | 213 |
 * | 설정 | 0 | 3 |
 *
 * 못 읽으면 **비었다고 보지 않는다.** 이유가 무엇이든 그 상태에서 덮는 것보다
 * 건너뛰고 사람이 보게 하는 편이 낫다.
 */
function isUntouched(file: string, name: string): boolean {
  const counts: string[] =
    name === 'songs.sqlite'
      ? ['SELECT count(*) AS c FROM songs']
      : [
          // 기본으로 깔린 유형(`template`)은 사람이 만든 것이 아니다
          "SELECT count(*) AS c FROM service_plans WHERE kind <> 'template'",
          'SELECT count(*) AS c FROM templates',
          'SELECT count(*) AS c FROM responsive_readings',
          'SELECT count(*) AS c FROM settings',
        ];

  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(file, { readOnly: true });
    for (const sql of counts) {
      const row = db.prepare(sql).get() as unknown as { c: number } | undefined;
      if ((row?.c ?? 0) > 0) return false;
    }
    return true;
  } catch {
    return false;
  } finally {
    db?.close();
  }
}

/** 이 PC 에서 온 요청인가 — 파일을 통째로 바꾸는 일이다 */
function isLocal(request: FastifyRequest): boolean {
  return isLoopbackAddress(request.ip);
}

export function registerDataPackRoutes(app: FastifyInstance): void {
  /** 무엇이 놓여 있고, 누르면 무엇이 되는가 */
  app.get('/api/data-pack', async () => ok(inspectPack()));

  /**
   * 실제로 넣는다.
   *
   * 순서가 중요하다: **뜨고 → 닫고 → 바꾸고 → 다시 연다.**
   * 백업이 실패하면 `snapshotDatabases` 가 던지고 여기서 멈춘다 — 백업 없이
   * 사용자 자료를 바꾸지 않는다 (CLAUDE.md).
   */
  app.post<{ Body: { overwriteMine?: unknown } }>('/api/data-pack/install', async (request, reply) => {
    if (!isLocal(request)) return reply.code(403).send(fail('이 PC 에서만 설치할 수 있습니다'));

    /*
     * **건너뛴 것까지 덮는다** — 사람이 화면에서 일부러 켜야 한다.
     *
     * 짐작으로 가를 수 없는 경우가 있다(기본 유형을 손본 뒤 꾸러미를 받는 등).
     * 그때 '자동으로 잘 해 주는' 것보다 **사람이 보고 정하는** 편이 맞다 —
     * 잃는 것이 되돌릴 수 없는 자료이기 때문이다.
     */
    const overwriteMine = request.body?.overwriteMine === true;

    const status = inspectPack();
    if (!status.found) {
      return reply.code(400).send(fail(`꾸러미를 찾지 못했습니다: ${status.dir}`));
    }

    const doing = overwriteMine ? status.plan : status.plan.filter((one) => one.action !== 'skip');
    if (doing.length === 0) {
      return reply.code(409).send(fail('넣을 것이 없습니다 — 이 PC 에 이미 다 있습니다'));
    }

    try {
      snapshotDatabases('before-data-pack');
    } catch (err) {
      return reply
        .code(500)
        .send(fail(`백업에 실패해 멈췄습니다. 자료를 바꾸지 않았습니다: ${String(err)}`));
    }

    // 열려 있는 파일은 바꿀 수 없다 (윈도우) · 바꿔도 옛 것을 붙든다 (맥)
    closeBibleDb();
    closeSongsDb();
    closeAppDb();

    const done: string[] = [];
    try {
      for (const entry of doing) {
        const source = path.join(status.dir, entry.name);
        const target = path.join(paths.dataDir, entry.name);

        if (statSync(source).isDirectory()) {
          rmSync(target, { recursive: true, force: true });
          cpSync(source, target, { recursive: true });
        } else {
          /*
           * **`-wal`·`-shm` 을 지운다.** 새 파일과 짝이 맞지 않는 옛 WAL 이 남으면
           * SQLite 가 그것을 읽어 **바꾸기 전 내용이 되살아난다.**
           */
          for (const suffix of ['-wal', '-shm']) rmSync(`${target}${suffix}`, { force: true });
          copyFileSync(source, target);
        }
        done.push(entry.name);
      }
    } finally {
      // 무엇이 잘못돼도 **서버는 살아 있어야 한다** — 예배 중일 수 있다
      initAppDb();
      initTemplateStore();
      initReadingStore();
      initSongsDb();
    }

    app.log.warn(`자료 꾸러미를 넣었습니다: ${done.join(', ')}`);
    const skipped = overwriteMine ? [] : status.plan.filter((one) => one.action === 'skip').map((one) => one.name);
    return ok({
      installed: done,
      skipped,
      /** 성경 DB 는 앱이 뜰 때 한 번 연다 — 바꿨으면 다시 시작해야 반영된다 */
      restartRequired: done.includes('bible.sqlite'),
    });
  });
}
