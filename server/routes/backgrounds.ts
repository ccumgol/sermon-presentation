/**
 * 배경 그림·동영상 라우트.
 *
 * 카메라 영상이 없을 때 배경으로 깔 파일을 다룬다. 두 경로를 모두 받는다
 * (2026-08-15 사용자 결정):
 *  - `data/backgrounds/` 에 **직접 넣기** — 큰 동영상은 이 편이 빠르고 확실하다
 *  - 앱에서 **올리기** — 다른 봉사자 PC 에서 터미널 없이 넣을 수 있어야 한다
 *
 * 파일 이름만 다루고 경로는 절대 받지 않는다. `../` 로 상위 폴더를 가리키거나
 * 실행 파일을 올리는 길을 막기 위해, 이름은 `basename` 으로 자르고 확장자는
 * 허용 목록으로만 통과시킨다.
 */

import { existsSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type { FastifyInstance } from 'fastify';

import type { ApiResponse } from '../../shared/types.ts';
import { listTemplates } from '../db/templates.ts';
import { ensureDataDirs, paths } from '../paths.ts';

function ok<T>(data: T): ApiResponse<T> {
  return { success: true, data, error: null };
}

function fail(error: string): ApiResponse<null> {
  return { success: false, data: null, error };
}

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif']);
const VIDEO_EXTENSIONS = new Set(['.mp4', '.webm', '.mov', '.m4v']);

/**
 * 올리기 용량 한도 (64MB).
 *
 * base64 로 담으면 33% 늘어나므로 본문 한도는 그보다 넉넉해야 한다.
 * 이보다 큰 동영상은 폴더에 직접 넣는 편이 낫다 — 브라우저 메모리에 통째로
 * 올렸다가 서버로 보내는 것이 예배 직전에 할 일은 아니다.
 */
export const MAX_UPLOAD_BYTES = 64 * 1024 * 1024;
const BODY_LIMIT = Math.ceil(MAX_UPLOAD_BYTES * 1.4);

/**
 * 배경 폴더 전체 용량 한도 (기본 2GB).
 *
 * 파일당 한도만으로는 **개수를 막지 못한다.** 이 앱에는 인증이 없어(H-1 로 LAN 은
 * 닫았지만) 반복 업로드로 디스크를 채울 수 있고, 디스크가 차면 같은 볼륨의
 * `data/songs.sqlite` 쓰기가 실패해 **직접 손본 가사가 저장되지 않는다.**
 * 메모리 고갈은 재시작하면 끝이지만 이건 데이터가 걸린다.
 *
 * 2GB 는 실사용(그림 여러 장 + 반복 동영상 몇 개)에는 넉넉하고, 최대 크기 파일로도
 * 32개면 닿는 값이다. 더 필요하면 `SERMON_MAX_BACKGROUND_BYTES` 로 올린다.
 */
export const MAX_TOTAL_BYTES = Number(process.env.SERMON_MAX_BACKGROUND_BYTES) || 2 * 1024 * 1024 * 1024;

export type BackgroundKind = 'image' | 'video';

export interface BackgroundFile {
  name: string;
  kind: BackgroundKind;
  bytes: number;
  /** 출력 페이지가 그대로 쓰는 주소 */
  url: string;
}

/** 배경으로 쓸 수 있는 파일인지 — 아니면 undefined */
export function backgroundKindOf(name: string): BackgroundKind | undefined {
  const ext = path.extname(name).toLowerCase();
  if (IMAGE_EXTENSIONS.has(ext)) return 'image';
  if (VIDEO_EXTENSIONS.has(ext)) return 'video';
  return undefined;
}

/**
 * 이름을 안전한 파일 이름으로 만든다.
 *
 * 경로 구분자를 지우고(basename), 허용 확장자만 통과시킨다.
 * 숨김 파일(`.DS_Store`)과 빈 이름도 막는다.
 */
export function safeBackgroundName(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const name = path.basename(raw.trim());
  if (name.length === 0 || name.startsWith('.')) return undefined;
  return backgroundKindOf(name) ? name : undefined;
}

/**
 * 사람이 읽는 용량. 단위를 MB 로 고정하면 작은 값이 전부 '0MB' 가 되어
 * "한도(0MB)를 넘습니다. 지금 0MB 를 쓰고 있습니다" 같은 문구가 나온다.
 */
export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(1)}GB`;
  if (bytes >= 1024 * 1024) return `${Math.round(bytes / 1024 / 1024)}MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${bytes}B`;
}

/** 배경 폴더가 지금 쓰고 있는 총 바이트 */
export function totalBackgroundBytes(): number {
  return listBackgrounds().reduce((sum, file) => sum + file.bytes, 0);
}

/**
 * 이 배경을 쓰고 있는 템플릿 이름들.
 *
 * 배경은 템플릿의 `canvas.background.src` 가 **이름으로** 참조한다. 그냥 지우면
 * 템플릿이 조용히 깨져 예배 중에 발견하게 된다.
 */
export function templatesUsing(name: string): string[] {
  return listTemplates()
    .filter((template) => {
      const background = template.canvas.background;
      return (background.mode === 'image' || background.mode === 'video') && background.src === name;
    })
    .map((template) => template.name);
}

/** 폴더 하나를 훑어 배경으로 쓸 수 있는 파일만 고른다 */
function scanFolder(dir: string, urlPrefix: string): BackgroundFile[] {
  if (!existsSync(dir)) return [];

  return readdirSync(dir)
    .filter((name) => !name.startsWith('.'))
    .flatMap((name) => {
      const kind = backgroundKindOf(name);
      if (!kind) return [];
      const full = path.join(dir, name);
      // 폴더나 읽을 수 없는 항목은 조용히 건너뛴다 — 목록이 통째로 죽으면 안 된다
      try {
        const stat = statSync(full);
        if (!stat.isFile()) return [];
        return [{ name, kind, bytes: stat.size, url: `${urlPrefix}${encodeURIComponent(name)}` }];
      } catch {
        return [];
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'ko', { numeric: true }));
}

/** 앱이 관리하는 배경 (`data/backgrounds/`) — 올리기·삭제·총량 상한이 걸린다 */
export function listBackgrounds(): BackgroundFile[] {
  return scanFolder(paths.backgroundsDir, '/backgrounds/');
}

/**
 * 사용자가 모아 둔 배경 (`~/Desktop/Data/Background`) — **읽기만 한다.**
 *
 * 여기 있는 파일은 지우거나 덮어쓰지 않고 총량 계산에도 넣지 않는다.
 * 사용자 폴더이므로 앱이 손댈 물건이 아니다.
 */
export function listLibraryBackgrounds(): BackgroundFile[] {
  return scanFolder(paths.backgroundSourceDir, '/background-library/');
}

export async function registerBackgroundRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/backgrounds', async () =>
    ok({
      files: listBackgrounds(),
      // 사용자 폴더의 그림들 — 전례문·교독문 배경을 여기서 고른다
      library: listLibraryBackgrounds(),
      libraryDir: paths.backgroundSourceDir,
      maxUploadBytes: MAX_UPLOAD_BYTES,
      totalBytes: totalBackgroundBytes(),
      maxTotalBytes: MAX_TOTAL_BYTES,
    }),
  );

  app.post<{ Body: { name?: unknown; base64?: unknown } }>(
    '/api/backgrounds',
    { bodyLimit: BODY_LIMIT },
    async (request, reply) => {
      const name = safeBackgroundName(request.body?.name);
      if (!name) {
        return reply
          .code(400)
          .send(fail('그림(jpg·png·webp·gif·avif)이나 동영상(mp4·webm·mov·m4v) 파일만 올릴 수 있습니다'));
      }

      const base64 = request.body?.base64;
      if (typeof base64 !== 'string' || base64.length === 0) {
        return reply.code(400).send(fail('파일 내용이 비었습니다'));
      }

      let buffer: Buffer;
      try {
        buffer = Buffer.from(base64, 'base64');
      } catch {
        return reply.code(400).send(fail('파일 내용을 읽지 못했습니다'));
      }

      if (buffer.byteLength === 0) return reply.code(400).send(fail('파일 내용이 비었습니다'));
      if (buffer.byteLength > MAX_UPLOAD_BYTES) {
        return reply
          .code(413)
          .send(
            fail(
              `${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)}MB 까지 올릴 수 있습니다. ` +
                `더 크면 ${paths.backgroundsDir} 폴더에 직접 넣으세요.`,
            ),
          );
      }

      // 폴더 전체 한도 — 파일당 한도만으로는 개수를 막지 못한다.
      // 같은 이름을 덮어쓰는 경우 그 파일의 크기는 빠지므로 미리 뺀다.
      const target = path.join(paths.backgroundsDir, name);
      const replacing = listBackgrounds().find((file) => file.name === name);
      const projected = totalBackgroundBytes() - (replacing?.bytes ?? 0) + buffer.byteLength;

      if (projected > MAX_TOTAL_BYTES) {
        return reply
          .code(507)
          .send(
            fail(
              `배경 폴더 한도(${formatBytes(MAX_TOTAL_BYTES)})를 넘습니다. ` +
                `지금 ${formatBytes(totalBackgroundBytes())} 를 쓰고 있고, ` +
                `이 파일은 ${formatBytes(buffer.byteLength)} 입니다. ` +
                '쓰지 않는 배경을 지우거나, 더 필요하면 SERMON_MAX_BACKGROUND_BYTES 로 한도를 올리세요.',
            ),
          );
      }

      try {
        ensureDataDirs();
        writeFileSync(target, buffer);
      } catch (err) {
        app.log.error(err);
        return reply.code(500).send(fail('파일을 저장하지 못했습니다'));
      }

      // 같은 이름이면 덮어쓴다 — 조용히 바뀌면 '왜 다른 그림이 나오지' 가 되므로 알린다
      return ok({
        file: listBackgrounds().find((f) => f.name === name) ?? null,
        replaced: replacing !== undefined,
        totalBytes: totalBackgroundBytes(),
        maxTotalBytes: MAX_TOTAL_BYTES,
      });
    },
  );

  /**
   * 배경을 지운다.
   *
   * 쓰고 있는 템플릿이 있으면 **막고 목록을 알려 준다.** 배경은 이름으로만 참조되므로
   * 그냥 지우면 템플릿이 조용히 깨지고, 그걸 예배 중에 발견하게 된다.
   * 그래도 지우려면 `?force=true`.
   */
  app.delete<{ Params: { name: string }; Querystring: { force?: string } }>(
    '/api/backgrounds/:name',
    async (request, reply) => {
      const name = safeBackgroundName(decodeURIComponent(request.params.name));
      if (!name) return reply.code(400).send(fail('배경 파일 이름이 올바르지 않습니다'));

      const target = path.join(paths.backgroundsDir, name);
      if (!existsSync(target)) return reply.code(404).send(fail('그런 배경이 없습니다'));

      const inUse = templatesUsing(name);
      if (inUse.length > 0 && request.query.force !== 'true') {
        return reply.code(409).send(
          fail(
            `'${name}' 을(를) ${inUse.length}개 템플릿이 쓰고 있습니다: ${inUse.join(', ')}. ` +
              '먼저 그 템플릿의 배경을 바꾸거나, 그래도 지우려면 강제 삭제를 쓰세요.',
          ),
        );
      }

      try {
        unlinkSync(target);
      } catch (err) {
        app.log.error(err);
        return reply.code(500).send(fail('파일을 지우지 못했습니다'));
      }

      return ok({ name, wasInUse: inUse, totalBytes: totalBackgroundBytes() });
    },
  );
}
