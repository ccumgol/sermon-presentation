/**
 * 이 PC 와 관련된 일 — 데이터 폴더 열기, 환경 점검, 사전 설치.
 *
 * ## 왜 서버가 하는가
 *
 * 조작 화면은 브라우저다. 브라우저는 파일 탐색기를 열 수도, 다른 프로그램을
 * 설치할 수도 없다. 서버는 이 PC 에서 도는 프로세스라 할 수 있다.
 *
 * ## 이 PC 에서 온 요청만 받는다
 *
 * 폴더를 열고 명령을 돌리는 일이다. 태블릿에서 눌러 봐야 **서버 PC 의 화면**에
 * 창이 뜨므로 쓸모가 없고, 남의 기기가 이 PC 에서 프로그램을 설치하게 둘 이유도
 * 없다. `lib/lan-auth.ts` 의 루프백 판정을 그대로 쓴다.
 */

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';

import type { FastifyInstance, FastifyRequest } from 'fastify';

import { checkEnv, isAllowedCommand, platformOf } from '../../lib/env-check.ts';
import { isLoopbackAddress } from '../../lib/lan-auth.ts';
import type { ApiResponse } from '../../shared/types.ts';
import { paths } from '../paths.ts';

function ok<T>(data: T): ApiResponse<T> {
  return { success: true, data, error: null };
}

function fail(error: string): ApiResponse<null> {
  return { success: false, data: null, error };
}

/** 명령 하나를 돌리고 결과를 기다린다. 얼어붙지 않도록 시간 제한을 둔다 */
function run(file: string, args: string[], timeout = 5000): Promise<{ ok: boolean; output: string }> {
  return new Promise((resolve) => {
    execFile(file, args, { timeout, windowsHide: true }, (error, stdout, stderr) => {
      resolve({ ok: !error, output: `${stdout}${stderr}`.trim() });
    });
  });
}

/** 설치 도구가 이 PC 에 있는가 (`brew`·`winget`) */
async function hasTool(tool: string): Promise<boolean> {
  const probe = process.platform === 'win32' ? 'where' : 'which';
  return (await run(probe, [tool], 3000)).ok;
}

/**
 * 폴더를 파일 탐색기에서 연다.
 *
 * 플랫폼마다 명령이 다르다. **인자로 경로를 넘긴다** — 셸 문자열을 조립하면
 * 공백이나 따옴표가 든 경로에서 깨지고, 그 자리가 곧 명령 주입 구멍이 된다.
 */
async function openFolder(target: string): Promise<{ ok: boolean; output: string }> {
  if (process.platform === 'darwin') return run('open', [target]);
  if (process.platform === 'win32') return run('explorer', [target]);
  return run('xdg-open', [target]);
}

/** 이 PC 에서 온 요청인가 */
function isLocal(request: FastifyRequest): boolean {
  return isLoopbackAddress(request.ip);
}

export function registerSystemRoutes(app: FastifyInstance): void {
  /**
   * 데이터 폴더를 파일 탐색기에서 연다.
   *
   * 포장한 앱에서는 데이터가 `Application Support`·`AppData` 안에 있어 **사람이
   * 찾아갈 수 없는 자리**다. 백업을 챙기거나 배경 그림을 넣으려면 그 폴더를 열
   * 방법이 있어야 한다.
   */
  app.post('/api/system/open-data-dir', async (request, reply) => {
    if (!isLocal(request)) {
      return reply.code(403).send(fail('이 PC 에서만 열 수 있습니다 (태블릿에서는 서버 PC 의 창이 열립니다)'));
    }
    const result = await openFolder(paths.dataDir);
    if (!result.ok) return reply.code(500).send(fail(`폴더를 열지 못했습니다: ${result.output || '알 수 없는 오류'}`));
    return ok({ path: paths.dataDir });
  });

  /** 예배를 진행하려면 이 PC 에 무엇이 더 있어야 하는가 */
  app.get('/api/system/env', async () => {
    const platform = platformOf(process.platform);
    const tools = new Map<string, boolean>();
    for (const tool of ['brew', 'winget']) tools.set(tool, await hasTool(tool));

    return ok({
      platform,
      dataDir: paths.dataDir,
      items: checkEnv(platform, existsSync, (tool) => tools.get(tool) === true),
    });
  });

  /**
   * 빠진 프로그램을 설치한다.
   *
   * **목록에 적힌 명령과 글자까지 같을 때만** 돌린다. 화면이 보낸 문자열을 그대로
   * 실행하면 이 라우트가 '무엇이든 실행하는 구멍' 이 된다 — 이 앱은 LAN 에도 열린다.
   *
   * 설치는 몇 분이 걸릴 수 있어 시간 제한을 길게 둔다. 실패하면 그대로 알려 주고
   * 공식 페이지로 안내한다 — 조용히 넘기면 '눌렀는데 아무 일도 없다' 가 된다.
   */
  app.post<{ Body: { command?: unknown } }>('/api/system/install', async (request, reply) => {
    if (!isLocal(request)) return reply.code(403).send(fail('이 PC 에서만 설치할 수 있습니다'));

    const command = request.body?.command;
    if (typeof command !== 'string' || !isAllowedCommand(command)) {
      return reply.code(400).send(fail('허용된 설치 명령이 아닙니다'));
    }

    const [file, ...args] = command.split(' ');
    if (!file) return reply.code(400).send(fail('허용된 설치 명령이 아닙니다'));

    // 설치는 오래 걸린다 (내려받기 포함). 10분을 넘기면 무언가 잘못된 것이다
    const result = await run(file, args, 10 * 60 * 1000);
    if (!result.ok) {
      return reply.code(500).send(fail(`설치에 실패했습니다. 공식 페이지에서 직접 받아 주세요.\n${result.output.slice(0, 500)}`));
    }
    return ok({ command, output: result.output.slice(0, 1000) });
  });
}
