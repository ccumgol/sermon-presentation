/**
 * 배경 그림 **목록만** 내주는 라우트.
 *
 * ## 왜 목록만인가 (2026-08-18, D-B 결정)
 *
 * 기획서 §1.3 은 처음부터 「영상/이미지 배경 재생」을 **범위에서 제외**했다 —
 * "OBS가 이미 잘 함, 우리는 텍스트 레이어만 담당". 중간에 업로드·삭제·총량 상한·
 * 동영상 재생까지 만들었다가, 검수(`docs/REVIEW-2026-08-18.md`) 뒤 원래 판단으로
 * 되돌렸다.
 *
 * 덜어내면서 **보안 위험 S-1 도 함께 사라졌다** — 무인증 업로드가 쌓여 디스크가 차면
 * `songs.sqlite` 쓰기가 실패해 가사가 손실될 수 있었다. 업로드가 없으면 그 위험이 없다.
 *
 * ## 그러면 배경은 누가 깔나
 *
 * | 무엇 | 누가 |
 * |---|---|
 * | 정적 배경 그림·반복 동영상 | **OBS** (소스·필터·전환을 이미 갖고 있다) |
 * | 순서 항목마다 바뀌는 배경 (교독문·전례문) | **우리** — 여기서 고르기만 한다 |
 *
 * 항목별 배경을 OBS 로 하려면 씬을 항목 수만큼 만들어야 하므로 이것만 남겼다.
 *
 * ## 파일은 어디서 오나
 *
 * 두 폴더를 나열한다. **어느 쪽에도 쓰지 않는다.**
 *
 * | 폴더 | 성격 |
 * |---|---|
 * | `~/Desktop/Data/Background` | 사용자가 모아 둔 것. 읽기 전용 |
 * | `data/backgrounds/` | 직접 넣어 둔 것 (앱은 넣지 않는다) |
 */

import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

import type { FastifyInstance } from 'fastify';

import type { ApiResponse } from '../../shared/types.ts';
import { paths } from '../paths.ts';

function ok<T>(data: T): ApiResponse<T> {
  return { success: true, data, error: null };
}

/**
 * 배경으로 쓸 수 있는 확장자.
 *
 * **동영상은 없다.** 반복 동영상 배경은 OBS 미디어 소스가 한다 — 자동 재생이 막히는
 * 문제도, 코덱 문제도 거기서는 없다. 목록에 넣으면 고를 수 있게 되므로 아예 뺀다.
 */
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif']);

export interface BackgroundFile {
  name: string;
  bytes: number;
  /** 출력 페이지가 그대로 쓰는 주소 */
  url: string;
}

/** 배경으로 쓸 수 있는 그림인가 */
export function isBackgroundImage(name: string): boolean {
  return IMAGE_EXTENSIONS.has(path.extname(name).toLowerCase());
}

/**
 * 이름을 안전한 파일 이름으로 만든다.
 *
 * 경로 구분자를 지우고(basename) 허용 확장자만 통과시킨다.
 * 숨김 파일(`.DS_Store`)과 빈 이름도 막는다.
 *
 * 순서표에 담긴 배경 이름도 이 함수로 검증한다 — 두 곳에서 따로 막으면 한쪽이 뒤처진다.
 */
export function safeBackgroundName(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const name = path.basename(raw.trim());
  if (name.length === 0 || name.startsWith('.')) return undefined;
  return isBackgroundImage(name) ? name : undefined;
}

/** 폴더 하나를 훑어 배경으로 쓸 수 있는 그림만 고른다 */
function scanFolder(dir: string, urlPrefix: string): BackgroundFile[] {
  if (!existsSync(dir)) return [];

  return readdirSync(dir)
    .filter((name) => !name.startsWith('.'))
    .flatMap((name) => {
      if (!isBackgroundImage(name)) return [];
      const full = path.join(dir, name);
      // 폴더나 읽을 수 없는 항목은 조용히 건너뛴다 — 목록이 통째로 죽으면 안 된다
      try {
        const stat = statSync(full);
        if (!stat.isFile()) return [];
        return [{ name, bytes: stat.size, url: `${urlPrefix}${encodeURIComponent(name)}` }];
      } catch {
        return [];
      }
    })
    // bg_1 · bg_2 · … · bg_10 순서로 (문자열 비교면 bg_10 이 bg_2 앞에 온다)
    .sort((a, b) => a.name.localeCompare(b.name, 'ko', { numeric: true }));
}

/** `data/backgrounds/` — 사용자가 직접 넣어 둔 것 */
export function listBackgrounds(): BackgroundFile[] {
  return scanFolder(paths.backgroundsDir, '/backgrounds/');
}

/** `~/Desktop/Data/Background` — 사용자가 모아 둔 것. 읽기만 한다 */
export function listLibraryBackgrounds(): BackgroundFile[] {
  return scanFolder(paths.backgroundSourceDir, '/background-library/');
}

export async function registerBackgroundRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/backgrounds', async () =>
    ok({
      files: listBackgrounds(),
      library: listLibraryBackgrounds(),
      libraryDir: paths.backgroundSourceDir,
      dataDir: paths.backgroundsDir,
    }),
  );
}
