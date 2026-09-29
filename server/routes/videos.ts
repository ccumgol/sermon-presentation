/**
 * 동영상 목록 — `데이터 폴더/videos/` (2026-09-29 사용자 요청).
 *
 * 파일을 **올려 받지 않는다.** 선교보고 영상은 수백 MB 라 브라우저로 올리면 그만한
 * 양이 메모리를 거쳐 가고, 중간에 끊기면 무엇이 들어갔는지 알 수 없다. 자료 꾸러미와
 * 같은 판단이다 — **사람이 폴더에 넣고 서버가 읽는다.**
 *
 * 재생 자체는 `/videos/` 정적 서빙이 맡는다 (바이트 범위 206 지원).
 */

import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

import type { FastifyInstance } from 'fastify';

import { isVideoFile, videoRisk, videoWarning, type VideoRisk } from '../../lib/video-files.ts';
import type { ApiResponse } from '../../shared/types.ts';
import { paths } from '../paths.ts';

function ok<T>(data: T): ApiResponse<T> {
  return { success: true, data, error: null };
}

export interface VideoFile {
  name: string;
  bytes: number;
  url: string;
  risk: VideoRisk;
  /** 왜 위험한지 — 안전하면 없다 */
  warning?: string;
}

/**
 * 폴더를 훑어 동영상만 고른다.
 *
 * 하위 폴더는 보지 않는다 — 한 겹이면 «넣고 고른다»로 끝나는데, 겹을 두면
 * 폴더를 만들고 고르는 화면이 또 필요해진다. 필요해지면 그때 넓힌다.
 */
export function listVideos(): VideoFile[] {
  const dir = paths.videosDir;
  if (!existsSync(dir)) return [];

  return readdirSync(dir)
    .filter((name) => !name.startsWith('.'))
    .flatMap((name) => {
      if (!isVideoFile(name)) return [];
      const full = path.join(dir, name);
      // 폴더나 읽을 수 없는 항목은 조용히 건너뛴다 — 목록이 통째로 죽으면 안 된다
      try {
        const stat = statSync(full);
        if (!stat.isFile()) return [];
        const warning = videoWarning(name);
        return [
          {
            name,
            bytes: stat.size,
            url: `/videos/${encodeURIComponent(name)}`,
            risk: videoRisk(name),
            ...(warning !== undefined ? { warning } : {}),
          },
        ];
      } catch {
        return [];
      }
    })
    // 1 · 2 · … · 10 순서로 (문자열 비교면 10 이 2 앞에 온다)
    .sort((a, b) => a.name.localeCompare(b.name, 'ko', { numeric: true }));
}

export async function registerVideoRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/videos', async () => ok({ files: listVideos(), dir: paths.videosDir }));
}
