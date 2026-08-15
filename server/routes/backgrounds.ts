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

import { existsSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type { FastifyInstance } from 'fastify';

import type { ApiResponse } from '../../shared/types.ts';
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

export function listBackgrounds(): BackgroundFile[] {
  if (!existsSync(paths.backgroundsDir)) return [];

  return readdirSync(paths.backgroundsDir)
    .filter((name) => !name.startsWith('.'))
    .flatMap((name) => {
      const kind = backgroundKindOf(name);
      if (!kind) return [];
      const full = path.join(paths.backgroundsDir, name);
      // 폴더나 읽을 수 없는 항목은 조용히 건너뛴다 — 목록이 통째로 죽으면 안 된다
      try {
        const stat = statSync(full);
        if (!stat.isFile()) return [];
        return [{ name, kind, bytes: stat.size, url: `/backgrounds/${encodeURIComponent(name)}` }];
      } catch {
        return [];
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'ko'));
}

export async function registerBackgroundRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/backgrounds', async () => ok({ files: listBackgrounds(), maxUploadBytes: MAX_UPLOAD_BYTES }));

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

      try {
        ensureDataDirs();
        writeFileSync(path.join(paths.backgroundsDir, name), buffer);
      } catch (err) {
        app.log.error(err);
        return reply.code(500).send(fail('파일을 저장하지 못했습니다'));
      }

      // 같은 이름이면 덮어쓴다 — 컨트롤 패널이 먼저 확인을 받는다
      return ok({ file: listBackgrounds().find((f) => f.name === name) ?? null });
    },
  );
}
