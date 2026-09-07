/**
 * 데이터 이전 — 찬양·템플릿·예배순서·설정·폰트를 파일 하나로 내보내고 가져온다.
 * 다른 봉사자 PC 에 설치할 때(계획서 D1) 필요한 기능이다.
 *
 * **`.zip` 이 아니라 JSON 한 파일**로 만든다. 이유:
 *  - Node 에 zip 이 내장돼 있지 않아 의존성이 하나 늘고, Electron 패키징에서 또 변수가 된다
 *  - 사람이 열어 내용을 확인·수정할 수 있다 (예배 전 급할 때 실제로 유용하다)
 *  - 폰트는 base64 로 함께 담는다. 용량이 33% 늘지만 폰트는 보통 몇 개뿐이다
 *
 * ## 무엇이 담기고 무엇이 안 담기는가 (점검 P-3, 2026-09-07)
 *
 * | 담긴다 | 안 담긴다 |
 * |---|---|
 * | 찬양(가사·구간별 줄나눔 출처·즐겨찾기·대응곡·수록 정보) | **성경 DB** — 원본에서 다시 빌드한다 (97MB) |
 * | 사용자가 만든 곡집 | **악보 그림**(`data/sheets/`, 약 50MB) — 폴더를 복사한다 |
 * | 템플릿(사용자 것 + 덮어쓴 프리셋) · 예배 순서 · 설정 · 폰트 | 접속 암호·세션 열쇠·`lan_open`(그 PC 의 것이다) |
 * | **교독문**(새·통 두 벌) · **악보 상태**(단 경계·모양·검토 판정) | |
 *
 * 전에는 교독문·곡집·악보 상태가 빠져 있었는데 문서는 '자료 가져오기로 각 PC 에
 * 넣는다' 고 단언했다. 받은 사람은 교독문이 없는데 화면이 `node scripts/...` 를
 * 시키고(설치판에는 터미널이 없다), 155장을 훑어 내린 악보 판정도 사라졌다.
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type { FastifyInstance } from 'fastify';

import type { ResponsiveReading } from '../../lib/responsive-parser.ts';
import { buildIdentityIndex, findExisting } from '../../lib/song-identity.ts';
import { SECRET_SETTING_KEYS } from '../auth.ts';
import { LAN_OPEN_KEY } from '../lan-setting.ts';
import type { ApiResponse, Song, Songbook, Template } from '../../shared/types.ts';
import { getConnection } from '../db/app.ts';
import * as readings from '../db/readings.ts';
import type { ReadingBook } from '../db/readings.ts';
import * as sheets from '../db/sheets.ts';
import type { SheetRow } from '../db/sheets.ts';
import * as songbooks from '../db/songbooks.ts';
import { snapshotDatabases } from '../db/snapshot.ts';
import * as plans from '../db/plans.ts';
import * as songs from '../db/songs.ts';
import * as templates from '../db/templates.ts';
import { ensureDataDirs, paths } from '../paths.ts';

export const BUNDLE_FORMAT = 'sermon-presentation-bundle';
/**
 * 2 = 교독문·곡집·악보 상태가 더해진 판 (점검 P-3).
 *
 * **옛 번들(1)은 그대로 읽는다** — 새 칸이 없을 뿐이다. 반대로 옛 앱은 2를 거부한다
 * (`version > BUNDLE_VERSION`). 그것이 맞다: 조용히 교독문을 버리는 것보다
 * '앱을 업데이트하세요' 가 낫다.
 */
export const BUNDLE_VERSION = 2;

/**
 * 가져오기 본문 한도.
 *
 * Fastify 기본값은 1MB 인데 실제 번들이 그보다 크다 — 찬송가 1,202곡만으로 1.6MB 이고,
 * 폰트를 base64 로 담으면 수십 MB 가 될 수 있다. 기본값 그대로 두면 실제 배포 경로에서
 * 'Payload Too Large' 로 막힌다(실제로 겪었다). 이 라우트에만 한도를 올린다.
 */
const IMPORT_BODY_LIMIT = 256 * 1024 * 1024;

/**
 * 번들에 담지 않는 설정 키 — 내보내기와 가져오기가 **같은 목록**을 쓴다.
 *
 * - `live_state`: 송출 상태. 다른 PC 에서 복원하면 엉뚱한 화면이 뜬다.
 * - 접속 암호·세션 서명 열쇠(`server/auth.ts` 의 `SECRET_SETTING_KEYS`):
 *   **번들은 사람이 손으로 나르는 파일이다.** 서명 열쇠가 실리면 그것을 본 사람이
 *   암호 없이 쿠키를 만들 수 있다 (그 파일의 머리말에 근거).
 * - `lan_open`: 태블릿에 열지 말지는 **그 PC 의 보안 결정**이다. 번들을 받은 PC 가
 *   남의 선택 때문에 랜에 열리면 안 된다.
 */
const EXCLUDED_SETTINGS = new Set<string>(['live_state', LAN_OPEN_KEY, ...SECRET_SETTING_KEYS]);

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
  /** 교독문 — 새·통 두 벌을 `book` 으로 구분해 한 배열에 담는다 (v2) */
  readings?: Array<ResponsiveReading & { book: ReadingBook; source: string }>;
  /** 사용자가 만든 곡집. 내장 곡집은 코드가 출처라 담지 않는다 (v2) */
  songbooks?: Array<Omit<Songbook, 'songCount'>>;
  /**
   * 악보 **상태** — 단 경계·모양·사람의 검토 판정 (v2).
   *
   * **그림은 담지 않는다.** 약 50MB 라 JSON 한 파일에 넣을 수 없다. 그림 없이
   * 상태만 옮겨도 값이 있다 — 155장을 훑어 내린 판정이 남고, 그림을 폴더로
   * 복사하면 곧바로 이어서 쓸 수 있다.
   */
  sheets?: SheetRow[];
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
    readings: readings.listAllReadings(),
    // 내장 곡집은 코드가 출처다. 사용자가 만든 것만 옮긴다
    songbooks: songbooks
      .listSongbooks(songs.conn())
      .filter((book) => !book.isBuiltin)
      .map(({ songCount: _count, ...rest }) => rest),
    sheets: sheets.listSheets(songs.conn()),
  };
}

export interface ImportResult {
  songs: number;
  templates: number;
  plans: number;
  settings: number;
  /** 되살린 대응곡 연결 수 (양방향 한 짝을 1로 센다) */
  links: number;
  /** 교독문 편 수 (v2) */
  readings: number;
  /** 만든 곡집 수 (v2) */
  songbooks: number;
  /** 옮긴 악보 상태 수 — **그림은 폴더로 복사해야 한다** (v2) */
  sheets: number;
  /** replace 로 지우기 전에 뜬 백업 파일 (merge 면 없다) */
  backupFiles?: string[];
  fonts: number;
  /**
   * merge 에서 **이미 있어 건너뛴** 곡 수.
   *
   * `skipped` 에 넣지 않는 이유: 곡 4,531개를 두 번째로 가져오면 목록이 4,531줄이
   * 되어 정작 봐야 할 오류가 묻힌다. 이건 오류가 아니라 정상 동작이다.
   */
  songsExisting: number;
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

  const result: ImportResult = {
    songs: 0, templates: 0, plans: 0, settings: 0, links: 0,
    readings: 0, songbooks: 0, sheets: 0, fonts: 0, songsExisting: 0, skipped: [],
  };

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

  /*
   * ── 곡집을 **곡보다 먼저** 만든다 (점검 P-3) ─────────────────
   *
   * 순서가 중요하다. `setEntries` 는 **없는 곡집을 '기타' 로 떨어뜨린다** — 곡을
   * 먼저 넣으면 사용자가 만든 곡집의 수록 정보가 조용히 '기타' 가 되고, 곡집을
   * 뒤늦게 만들어도 그 연결은 돌아오지 않는다.
   *
   * 이미 있는 id 는 건드리지 않는다. 받는 쪽에서 같은 id 로 다르게 쓰고 있을 수
   * 있고, 이름을 덮어쓰는 것은 이전이 할 일이 아니다.
   */
  const existingBooks = new Set(songbooks.listSongbooks(songs.conn()).map((book) => book.id));
  for (const book of bundle.songbooks ?? []) {
    if (typeof book?.id !== 'string' || typeof book.name !== 'string') {
      result.skipped.push(`곡집 '${String(book?.name ?? '?')}': 형식 오류`);
      continue;
    }
    if (existingBooks.has(book.id)) continue;
    try {
      songbooks.createSongbook(songs.conn(), {
        id: book.id,
        name: book.name,
        shortLabel: book.shortLabel,
        numbered: book.numbered,
        ...(book.quickSlot !== undefined ? { quickSlot: book.quickSlot } : {}),
        ...(book.sourceNote !== undefined ? { sourceNote: book.sourceNote } : {}),
      });
      existingBooks.add(book.id);
      result.songbooks++;
    } catch (err) {
      result.skipped.push(`곡집 '${book.name}': ${err instanceof Error ? err.message : '만들지 못했습니다'}`);
    }
  }

  /*
   * **번들의 곡 id → 이 PC 의 곡 id.**
   *
   * 곡을 새로 만들면 id 가 새로 매겨지는데, 예배 순서 항목은 `songId` 로 곡을
   * 가리킨다. 이어 주지 않으면 순서에 제목은 보이는데 누르면 '곡을 찾을 수
   * 없습니다' 가 된다 — **예배 중에** 만나는 오류다 (2026-09-05 실측 재현).
   *
   * 짐작할 필요가 없다: 옛 id 와 새 id 가 모두 이 번들 안에 있다.
   */
  const songIdMap = new Map<number, number>();

  /*
   * merge 에서 이미 있는 곡을 알아보기 위한 색인.
   *
   * 없으면 같은 번들을 두 번 가져올 때 곡이 통째로 복제된다. replace 는 앞에서
   * 다 지웠으므로 만들 필요가 없다.
   */
  const identityIndex =
    mode === 'merge'
      ? buildIdentityIndex(
          songs.listSongs(100000).flatMap((hit) => {
            const found = songs.getSong(hit.id);
            return found ? [{ id: found.id, title: found.title, entries: found.entries }] : [];
          }),
        )
      : new Map<string, number>();

  for (const song of bundle.songs ?? []) {
    if (typeof song?.title !== 'string' || !Array.isArray(song.sections)) {
      result.skipped.push(`곡 '${String(song?.title ?? '?')}': 형식 오류`);
      continue;
    }

    // 이미 있으면 만들지 않고 **그 곡으로 이어 준다** — 순서가 그 곡을 가리켜야 한다
    if (mode === 'merge') {
      const existing = findExisting(identityIndex, { title: song.title, entries: song.entries ?? [] });
      if (existing !== undefined) {
        if (typeof song.id === 'number') songIdMap.set(song.id, existing);
        result.songsExisting++;
        continue;
      }
    }

    try {
      const newId = songs.createSong({
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
        /*
         * **구간별 `linesSource` 를 그대로 옮긴다** (점검 P-2, 2026-09-07).
         *
         * 넘기지 않으면 `createSong` 의 기본값 `'auto'` 가 되어, 옮긴 PC 에서
         * 승인(`manual`)·원본 줄나눔(`imported`) 표시가 **전부 사라진다.**
         * 그러면 그 곡들이 검토 대기열로 되돌아오고 자동 재정렬의 대상이 된다 —
         * 사람이 손으로 한 작업이 이전 한 번으로 없어지는 것이다.
         * 번들에는 값이 들어 있었는데 가져오기가 버리고 있었다.
         */
        sections: song.sections.map((section) => ({
          kind: section.kind,
          label: section.label,
          lines: section.lines,
          ...(section.linesSource ? { linesSource: section.linesSource } : {}),
        })),
      });
      if (typeof song.id === 'number') songIdMap.set(song.id, newId);
      // 즐겨찾기도 번들에 실려 있다 — 사람이 직접 지정한 것이라 되살려야 한다
      if (song.isFavorite === true) songs.toggleFavorite(newId, true);
      result.songs++;
    } catch (err) {
      result.skipped.push(`곡 '${song.title}': ${err instanceof Error ? err.message : '저장 실패'}`);
    }
  }

  /*
   * ── 대응곡 연결 (점검 P-2) ────────────────────────────────────
   *
   * **곡을 다 만든 뒤에** 걸어야 한다. 연결은 곡 id 를 가리키므로 `songIdMap` 이
   * 다 채워지기 전에는 상대를 찾을 수 없다.
   *
   * 번들에는 `links` 가 실려 있었는데 여기서 아무것도 하지 않아, 옮기면
   * 새찬송가↔통일찬송가 대응이 통째로 끊겼다. `linkSongs` 는 양방향이고
   * `INSERT OR IGNORE` 라 같은 짝을 두 번 걸어도 안전하다.
   */
  for (const song of bundle.songs ?? []) {
    if (typeof song?.id !== 'number' || !Array.isArray(song.links)) continue;
    const from = songIdMap.get(song.id);
    if (from === undefined) continue;
    for (const link of song.links) {
      const to = typeof link?.id === 'number' ? songIdMap.get(link.id) : undefined;
      if (to === undefined) {
        // 조용히 넘기지 않는다 — 대응곡이 하나만 옮겨 온 경우다
        result.skipped.push(`대응곡 '${song.title}' ↔ '${String(link?.title ?? '?')}': 상대 곡이 번들에 없습니다`);
        continue;
      }
      songs.linkSongs(from, to);
      result.links++;
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
        items: (Array.isArray(plan.items) ? plan.items : []).map((raw) => {
          const item: Record<string, unknown> = {
            ...(raw as Record<string, unknown>),
            id: plans.newItemId(),
          };
          if (item.type !== 'song' || typeof item.songId !== 'number') return item;

          // 이 PC 에서 그 곡이 받은 id 로 바꿔 준다
          const mapped = songIdMap.get(item.songId);
          if (mapped !== undefined) {
            item.songId = mapped;
            return item;
          }
          /*
           * 이을 곳이 없다 — 번들에 그 곡이 없거나 만들다 실패했다.
           *
           * **조용히 넘기지 않는다.** 순서에는 제목이 남아 멀쩡해 보이는데
           * 누르면 안 나가므로, 예배 전에 알아야 고칠 수 있다.
           */
          result.skipped.push(
            `예배 순서 '${plan.name}': '${String(item.songTitle ?? '제목 없음')}' 곡을 찾지 못해 연결이 끊겼습니다`,
          );
          return item;
        }) as never,
      });
      result.plans++;
    } catch (err) {
      result.skipped.push(`예배 순서 '${plan.name}': ${err instanceof Error ? err.message : '저장 실패'}`);
    }
  }

  /*
   * ── 교독문 (점검 P-3) ────────────────────────────────────────
   *
   * 새·통 두 벌을 `book` 으로 갈라 넣는다. 번호가 곧 열쇠라 같은 번호는 덮어쓴다
   * (`upsertReadings` 의 규칙 — 파일을 고쳐 다시 넣는 것이 정상 흐름이다).
   *
   * **`replace` 여도 지우지 않는다.** 옛 판(v1) 번들에는 교독문 칸이 아예 없어서,
   * 지우고 넣는 방식이면 그 번들을 받은 순간 213편이 사라진다 — 되돌릴 방법도
   * 없다(`replace` 는 이미 스냅샷을 뜨지만, 없는 것을 되살리지는 못한다).
   * 자연 열쇠(찬송가+번호)가 있어 덮어쓰기만으로 충분하다.
   */
  const readingsByBook = new Map<ReadingBook, ResponsiveReading[]>();
  const readingSources = new Map<ReadingBook, string>();
  for (const reading of bundle.readings ?? []) {
    if (!readings.isReadingBook(reading?.book) || typeof reading.number !== 'number') {
      result.skipped.push(`교독문 '${String(reading?.title ?? '?')}': 형식 오류`);
      continue;
    }
    const list = readingsByBook.get(reading.book) ?? [];
    list.push({ number: reading.number, title: reading.title, lines: reading.lines ?? [] });
    readingsByBook.set(reading.book, list);
    // 출처를 그대로 옮긴다 — 잃으면 받은 PC 에서 그 자료만 걷어낼 수 없다
    if (typeof reading.source === 'string') readingSources.set(reading.book, reading.source);
  }
  for (const [book, list] of readingsByBook) {
    try {
      result.readings += readings.upsertReadings(list, readingSources.get(book) ?? 'bundle', book);
    } catch (err) {
      result.skipped.push(`교독문(${book}): ${err instanceof Error ? err.message : '저장 실패'}`);
    }
  }

  /*
   * ── 악보 상태 (점검 P-3) ─────────────────────────────────────
   *
   * **그림은 담기지 않는다** — 약 50MB 라 JSON 한 파일에 넣을 수 없다. 여기서
   * 옮기는 것은 단 경계와 **사람이 155장을 훑어 내린 판정**이다. 그림은
   * `data/sheets/` 폴더를 복사한다 (README 의 이전 절차).
   *
   * 곡이 아니라 (곡집, 번호)에 붙으므로 `songIdMap` 과 무관하다.
   */
  for (const sheet of bundle.sheets ?? []) {
    if (typeof sheet?.songbookId !== 'string' || typeof sheet.number !== 'number') {
      result.skipped.push(`악보 '${String(sheet?.songbookId ?? '?')} ${String(sheet?.number ?? '?')}': 형식 오류`);
      continue;
    }
    try {
      sheets.putSheet(songs.conn(), {
        songbookId: sheet.songbookId,
        number: sheet.number,
        width: sheet.width,
        height: sheet.height,
        systems: Array.isArray(sheet.systems) ? sheet.systems : [],
        needsReview: sheet.needsReview === true,
        ...(sheet.detectedAt ? { detectedAt: sheet.detectedAt } : {}),
      });
      // 사람이 정한 값은 `putSheet` 가 건드리지 않는다 — 따로 넣어야 한다
      sheets.setSheetLayout(songs.conn(), sheet.songbookId, sheet.number, sheet.layout);
      sheets.setSheetReview(songs.conn(), sheet.songbookId, sheet.number, sheet.reviewState);
      result.sheets++;
    } catch (err) {
      result.skipped.push(
        `악보 ${sheet.songbookId} ${sheet.number}: ${err instanceof Error ? err.message : '저장 실패'}`,
      );
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
      readings: bundle.readings?.length ?? 0,
      songbooks: bundle.songbooks?.length ?? 0,
      /** 악보 **상태** 개수. 그림은 담기지 않는다 — 폴더를 복사해야 한다 */
      sheets: bundle.sheets?.length ?? 0,
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
