/**
 * 데이터 이전 — 찬양·템플릿·예배순서·설정·폰트를 파일 하나로 내보내고 가져온다.
 * 다른 봉사자 PC 에 설치할 때(계획서 D1) 필요한 기능이다.
 *
 * **`.zip` 이 아니라 JSON 한 파일**로 만든다. 이유:
 *  - Node 에 zip 이 내장돼 있지 않아 의존성이 하나 늘고, Electron 패키징에서 또 변수가 된다
 *  - 사람이 열어 내용을 확인·수정할 수 있다 (예배 전 급할 때 실제로 유용하다)
 *  - 폰트는 base64 로 함께 담는다. 용량이 33% 늘지만 폰트는 보통 몇 개뿐이다
 *
 * 성경 DB 는 담지 않는다 — 원본에서 다시 빌드할 수 있고, 97MB 를 파일에 넣을 이유가 없다.
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type { FastifyInstance } from 'fastify';

import type { ApiResponse, Song, Template } from '../../shared/types.ts';
import { getConnection } from '../db/app.ts';
import { snapshotDatabases } from '../db/snapshot.ts';
import * as plans from '../db/plans.ts';
import * as songs from '../db/songs.ts';
import * as templates from '../db/templates.ts';
import { ensureDataDirs, paths } from '../paths.ts';

export const BUNDLE_FORMAT = 'sermon-presentation-bundle';
export const BUNDLE_VERSION = 1;

/**
 * 가져오기 본문 한도.
 *
 * Fastify 기본값은 1MB 인데 실제 번들이 그보다 크다 — 찬송가 1,202곡만으로 1.6MB 이고,
 * 폰트를 base64 로 담으면 수십 MB 가 될 수 있다. 기본값 그대로 두면 실제 배포 경로에서
 * 'Payload Too Large' 로 막힌다(실제로 겪었다). 이 라우트에만 한도를 올린다.
 */
const IMPORT_BODY_LIMIT = 256 * 1024 * 1024;

/** 송출 상태는 내보내지 않는다 — 다른 PC 에서 복원하면 엉뚱한 화면이 뜬다 */
const EXCLUDED_SETTINGS = new Set(['live_state']);

const FONT_EXTENSIONS = new Set(['.woff2', '.woff', '.ttf', '.otf']);

export interface Bundle {
  format: string;
  version: number;
  exportedAt: string;
  songs: Song[];
  templates: Template[];
  plans: Array<{ name: string; serviceDate?: string; items: unknown[] }>;
  settings: Record<string, string>;
  fonts: Array<{ name: string; base64: string }>;
}

function ok<T>(data: T): ApiResponse<T> {
  return { success: true, data, error: null };
}

function fail(error: string): ApiResponse<null> {
  return { success: false, data: null, error };
}

function readSettings(): Record<string, string> {
  const rows = getConnection().prepare('SELECT key, value FROM settings').all() as unknown as Array<{
    key: string;
    value: string;
  }>;
  return Object.fromEntries(rows.filter((r) => !EXCLUDED_SETTINGS.has(r.key)).map((r) => [r.key, r.value]));
}

function readFonts(): Array<{ name: string; base64: string }> {
  if (!existsSync(paths.fontsDir)) return [];
  return readdirSync(paths.fontsDir)
    .filter((name) => FONT_EXTENSIONS.has(path.extname(name).toLowerCase()))
    .map((name) => ({ name, base64: readFileSync(path.join(paths.fontsDir, name)).toString('base64') }));
}

export function buildBundle(): Bundle {
  /*
   * 사용자 템플릿 + **덮어쓴 프리셋.**
   *
   * 손대지 않은 프리셋은 담지 않는다 — 코드가 출처라 옮길 필요가 없다. 하지만
   * 덮어쓴 것은 **사용자가 만든 값**이므로 담아야 한다. 안 담으면 PC 를 옮겼을 때
   * 프리셋 조정이 조용히 사라진다.
   */
  const userTemplates = templates
    .listTemplates()
    .filter((t) => !t.isBuiltin || t.isOverridden === true);

  // 곡 전체(섹션·줄 포함)를 담는다. 실측: 찬송가 1,202곡 = 약 1.6MB.
  const allSongs = songs
    .listSongs(100000)
    .flatMap((hit) => {
      const song = songs.getSong(hit.id);
      return song ? [song] : [];
    });

  return {
    format: BUNDLE_FORMAT,
    version: BUNDLE_VERSION,
    exportedAt: new Date().toISOString(),
    songs: allSongs,
    templates: userTemplates,
    plans: plans.listPlans().map((plan) => ({
      name: plan.name,
      ...(plan.serviceDate ? { serviceDate: plan.serviceDate } : {}),
      items: plan.items,
    })),
    settings: readSettings(),
    fonts: readFonts(),
  };
}

export interface ImportResult {
  songs: number;
  templates: number;
  plans: number;
  settings: number;
  /** replace 로 지우기 전에 뜬 백업 파일 (merge 면 없다) */
  backupFiles?: string[];
  fonts: number;
  /** 건너뛴 항목 — 조용히 넘기지 않고 알린다 */
  skipped: string[];
}

export type ImportMode = 'merge' | 'replace';

/**
 * 번들을 적용한다.
 *
 * 기본은 'merge' — 기존 데이터를 남기고 추가한다. 'replace' 는 사용자 데이터를
 * 먼저 지우므로 되돌릴 수 없다. 그래서 명시적으로 지정해야만 동작한다.
 */
export function applyBundle(raw: unknown, mode: ImportMode): ImportResult {
  if (typeof raw !== 'object' || raw === null) throw new Error('번들 형식이 올바르지 않습니다');
  const bundle = raw as Partial<Bundle>;

  if (bundle.format !== BUNDLE_FORMAT) {
    throw new Error(`이 파일은 이 앱의 백업이 아닙니다 (format: ${String(bundle.format)})`);
  }
  if (typeof bundle.version !== 'number' || bundle.version > BUNDLE_VERSION) {
    throw new Error(`지원하지 않는 버전입니다 (${String(bundle.version)}). 앱을 업데이트하세요.`);
  }

  const result: ImportResult = { songs: 0, templates: 0, plans: 0, settings: 0, fonts: 0, skipped: [] };

  if (mode === 'replace') {
    // 지우기 **전에** 스냅샷을 남긴다.
    //
    // 가사는 git 에 없어 되돌릴 방법이 백업뿐이다. 백업을 못 뜨면 **가져오기를
    // 중단한다** — 보호 없이 지우는 것이 이 조치가 막으려는 위험 자체다.
    // (SECURITY-AUDIT H-2: 무인증으로 순서표 4개가 0개가 된 것이 실증됐다)
    try {
      const snapshot = snapshotDatabases('before-import');
      result.backupFiles = snapshot.files;
    } catch (err) {
      throw new Error(
        '가져오기 전 백업에 실패해 중단했습니다. 기존 데이터는 그대로입니다. ' +
          `(${err instanceof Error ? err.message : '알 수 없는 오류'})`,
      );
    }

    // 사용자 데이터만 지운다. 성경 DB 와 내장 프리셋은 건드리지 않는다.
    for (const song of songs.listSongs(100000)) songs.deleteSong(song.id);
    for (const template of templates.listTemplates()) {
      // 덮어쓴 프리셋은 지우는 것이 아니라 **원본으로 되돌린다** (코드가 원본이다)
      if (template.isOverridden === true) templates.restoreBuiltin(template.id);
      else if (!template.isBuiltin) templates.deleteTemplate(template.id);
    }
    for (const plan of plans.listPlans()) plans.deletePlan(plan.id);
  }

  for (const song of bundle.songs ?? []) {
    if (typeof song?.title !== 'string' || !Array.isArray(song.sections)) {
      result.skipped.push(`곡 '${String(song?.title ?? '?')}': 형식 오류`);
      continue;
    }
    try {
      songs.createSong({
        title: song.title,
        ...(song.titleAlt ? { titleAlt: song.titleAlt } : {}),
        ...(song.author ? { author: song.author } : {}),
        ...(song.composer ? { composer: song.composer } : {}),
        ...(song.copyright ? { copyright: song.copyright } : {}),
        ...(song.ccliNumber ? { ccliNumber: song.ccliNumber } : {}),
        tags: Array.isArray(song.tags) ? song.tags : [],
        ...(song.hasAmen !== undefined ? { hasAmen: song.hasAmen } : {}),
        // 수록 곡집·번호를 그대로 옮긴다. 없는 곡집은 setEntries 가 '기타'로 떨어뜨린다.
        entries: (song.entries ?? []).map((entry) => ({
          songbookId: entry.songbookId,
          ...(entry.number !== undefined ? { number: entry.number } : {}),
        })),
        ...(song.source ? { source: song.source } : {}),
        sections: song.sections.map((section) => ({
          kind: section.kind,
          label: section.label,
          lines: section.lines,
        })),
      });
      result.songs++;
    } catch (err) {
      result.skipped.push(`곡 '${song.title}': ${err instanceof Error ? err.message : '저장 실패'}`);
    }
  }

  for (const template of bundle.templates ?? []) {
    if (typeof template?.name !== 'string' || !template.canvas) {
      result.skipped.push(`템플릿 '${String(template?.name ?? '?')}': 형식 오류`);
      continue;
    }
    try {
      const { id, isBuiltin: _b, isOverridden: _o, ...rest } = template;
      /*
       * 프리셋 id(음수)로 담긴 것은 **그 프리셋의 덮어쓰기**다. `createTemplate` 로
       * 넣으면 양수 id 의 사본이 되어 프리셋은 원본 그대로 남는다 — 옮긴 설정이
       * 적용되지 않고 목록에 사본만 하나 늘어난다.
       */
      if (typeof id === 'number' && id < 0 && templates.getTemplate(id)?.isBuiltin === true) {
        templates.updateTemplate(id, rest);
      } else {
        templates.createTemplate(rest);
      }
      result.templates++;
    } catch (err) {
      result.skipped.push(`템플릿 '${template.name}': ${err instanceof Error ? err.message : '저장 실패'}`);
    }
  }

  for (const plan of bundle.plans ?? []) {
    if (typeof plan?.name !== 'string') {
      result.skipped.push('예배 순서: 이름 없음');
      continue;
    }
    try {
      plans.createPlan({
        name: plan.name,
        ...(plan.serviceDate ? { serviceDate: plan.serviceDate } : {}),
        // 항목 id 를 새로 발급한다 — 다른 PC 의 id 를 그대로 쓰면 재배치가 꼬인다
        items: (Array.isArray(plan.items) ? plan.items : []).map((item) => ({
          ...(item as Record<string, unknown>),
          id: plans.newItemId(),
        })) as never,
      });
      result.plans++;
    } catch (err) {
      result.skipped.push(`예배 순서 '${plan.name}': ${err instanceof Error ? err.message : '저장 실패'}`);
    }
  }

  for (const [key, value] of Object.entries(bundle.settings ?? {})) {
    if (EXCLUDED_SETTINGS.has(key) || typeof value !== 'string') continue;
    getConnection()
      .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(key, value);
    result.settings++;
  }

  if ((bundle.fonts ?? []).length > 0) {
    ensureDataDirs();
    for (const font of bundle.fonts ?? []) {
      if (typeof font?.name !== 'string' || typeof font.base64 !== 'string') {
        result.skipped.push('폰트: 형식 오류');
        continue;
      }
      // 경로 탈출 방지 — 파일 이름만 쓴다
      const safeName = path.basename(font.name);
      if (!FONT_EXTENSIONS.has(path.extname(safeName).toLowerCase())) {
        result.skipped.push(`폰트 '${safeName}': 지원하지 않는 확장자`);
        continue;
      }
      writeFileSync(path.join(paths.fontsDir, safeName), Buffer.from(font.base64, 'base64'));
      result.fonts++;
    }
  }

  return result;
}

export async function registerBackupRoutes(app: FastifyInstance): Promise<void> {
  /** 번들 내려받기 */
  app.get('/api/backup/export', async (_request, reply) => {
    const bundle = buildBundle();
    const stamp = bundle.exportedAt.replace(/[:.]/g, '-').slice(0, 19);
    return reply
      .header('Content-Type', 'application/json; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="sermon-bundle-${stamp}.json"`)
      .send(JSON.stringify(bundle, null, 2));
  });

  /** 내보내기 전에 무엇이 담기는지 미리 본다 */
  app.get('/api/backup/summary', async () => {
    const bundle = buildBundle();
    return ok({
      songs: bundle.songs.length,
      templates: bundle.templates.length,
      plans: bundle.plans.length,
      settings: Object.keys(bundle.settings).length,
      fonts: bundle.fonts.map((f) => f.name),
      approximateBytes: Buffer.byteLength(JSON.stringify(bundle)),
    });
  });

  app.post<{ Body: { bundle?: unknown; mode?: string } }>(
    '/api/backup/import',
    { bodyLimit: IMPORT_BODY_LIMIT },
    async (request, reply) => {
      const mode: ImportMode = request.body?.mode === 'replace' ? 'replace' : 'merge';
      try {
        return ok(applyBundle(request.body?.bundle, mode));
      } catch (err) {
        return reply.code(400).send(fail(err instanceof Error ? err.message : '가져오지 못했습니다'));
      }
    },
  );
}
