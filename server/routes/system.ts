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

import { isPackagedApp } from '../../lib/bible-missing.ts';
import {
  checkEnv,
  folderOpenCommand,
  isAllowedCommand,
  pickToolPath,
  platformOf,
} from '../../lib/env-check.ts';
import { isLoopbackAddress } from '../../lib/lan-auth.ts';
import type { ApiResponse } from '../../shared/types.ts';
import { clearPassword, hasPassword, setPassword } from '../auth.ts';
import { setStoredLanOpen, storedLanOpen } from '../lan-setting.ts';
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

/**
 * 설치 도구를 찾는다 — **절대 경로**를 돌려준다 (점검 P-5).
 *
 * `which` 만으로는 부족하다. **Finder·독으로 띄운 맥 앱의 `PATH` 는
 * `/usr/bin:/bin:/usr/sbin:/sbin` 뿐이다** (2026-09-07, 사용자가 띄워 둔 앱의
 * 프로세스 환경을 읽어 실측). Homebrew 가 `/opt/homebrew/bin/brew` 에 있어도
 * 그 목록에 없어서 못 찾는다 — 터미널로 돌릴 때는 셸의 `PATH` 를 물려받아
 * 문제가 없으니 **설치판에서만** 나타난다.
 *
 * 그래서 `which` 를 먼저 보고(사용자가 다른 자리에 두었을 수 있다), 실패하면
 * 알려진 자리를 본다 (`lib/env-check.ts` 의 `toolCandidates`).
 *
 * @returns 실행할 수 있는 절대 경로, 없으면 `undefined`
 */
async function findTool(tool: string): Promise<string | undefined> {
  const probe = process.platform === 'win32' ? 'where' : 'which';
  const found = await run(probe, [tool], 3000);
  return pickToolPath(
    tool,
    platformOf(process.platform),
    found.ok ? found.output : undefined,
    existsSync,
    process.env,
  );
}

/**
 * 폴더를 파일 탐색기에서 연다.
 *
 * 플랫폼마다 명령이 다르다. **어느 명령인지 고르는 것은 `lib/env-check.ts` 가 한다** —
 * 여기 두면 지금 도는 PC 의 분기만 밟혀서 윈도우 줄이 한 번도 확인되지 않는다.
 *
 * **인자로 경로를 넘긴다** — 셸 문자열을 조립하면 공백이나 따옴표가 든 경로에서
 * 깨지고, 그 자리가 곧 명령 주입 구멍이 된다.
 */
async function openFolder(target: string): Promise<{ ok: boolean; output: string }> {
  return run(folderOpenCommand(platformOf(process.platform)), [target]);
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
    for (const tool of ['brew', 'winget']) tools.set(tool, (await findTool(tool)) !== undefined);

    return ok({
      platform,
      dataDir: paths.dataDir,
      items: checkEnv(platform, existsSync, (tool) => tools.get(tool) === true),
    });
  });

  /**
   * ── 접속 암호 정하기·없애기 (점검 P-1) ──────────────────────
   *
   * **설치판에는 터미널도 저장소도 없다.** 그런데 화면은 `npm run password` 를
   * 시키고 있었다 — 할 수 없는 일이다. 그래서 앱에서 정할 수 있게 한다.
   *
   * **이 PC 에서만** 받는다. 태블릿이 암호를 바꿀 수 있으면, 한 번 들어온 기기가
   * 주인을 잠글 수 있다. 폴더 열기·설치와 같은 규칙이다.
   *
   * 암호를 바꾸면 서명 열쇠도 새로 발급되어(`setPassword`) **이미 붙어 있던 기기가
   * 모두 로그아웃된다.** 바꾸는 이유가 대개 '누가 알아 버렸다' 이므로 그것이 맞다.
   */
  app.post<{ Body: { password?: unknown } }>('/api/system/password', async (request, reply) => {
    if (!isLocal(request)) return reply.code(403).send(fail('이 PC 에서만 정할 수 있습니다'));

    const password = request.body?.password;
    if (typeof password !== 'string') return reply.code(400).send(fail('암호를 입력하세요'));
    try {
      setPassword(password);
    } catch (err) {
      // `setPassword` 가 길이를 판정한다 — 규칙을 두 곳에 적지 않는다
      return reply.code(400).send(fail(err instanceof Error ? err.message : '암호를 정하지 못했습니다'));
    }
    app.log.info('접속 암호를 새로 정했습니다 (이미 접속해 있던 기기는 모두 로그아웃됩니다)');
    return ok({ passwordSet: true });
  });

  /**
   * 암호를 없앤다.
   *
   * **태블릿에 열려 있는 상태에서는 거부한다.** 없애는 순간 같은 WiFi 의 누구나
   * 예배 화면을 바꾸고 가사를 지울 수 있다 (감사 H-1·H-2 에서 실증된 상태로
   * 되돌아간다). 먼저 닫으라고 말해 주는 편이 낫다.
   */
  app.delete('/api/system/password', async (request, reply) => {
    if (!isLocal(request)) return reply.code(403).send(fail('이 PC 에서만 없앨 수 있습니다'));
    if (storedLanOpen()) {
      return reply
        .code(409)
        .send(fail('태블릿에 열려 있는 동안에는 암호를 없앨 수 없습니다. 먼저 태블릿 접속을 닫으세요.'));
    }
    clearPassword();
    app.log.info('접속 암호를 없앴습니다 (태블릿으로는 열 수 없습니다)');
    return ok({ passwordSet: false });
  });

  /**
   * ── 태블릿에 열기·닫기 (점검 P-1) ───────────────────────────
   *
   * 값만 저장하고 **다시 시작할 때** 반영한다. 바인딩 주소는 서버가 뜰 때 한 번
   * 정해지고, 도는 중에 리스너를 더 여는 장치를 **예배 중에 도는 서버**에 넣는 것은
   * 위험이 이득보다 크다. 그래서 `restartRequired` 를 돌려주고 화면이 안내한다.
   *
   * **암호 없이 열지 않는다.** 터미널판은 이 상황에서 기동을 거부하고(`server/index.ts`),
   * 설치판은 열지 않고 이 PC 안으로 되돌린다(`server/electron-entry.ts`) — 어느
   * 쪽이든 '열었다고 생각했는데 아니다' 가 되므로 여기서 미리 막는다.
   */
  app.put<{ Body: { open?: unknown } }>('/api/system/lan', async (request, reply) => {
    if (!isLocal(request)) return reply.code(403).send(fail('이 PC 에서만 바꿀 수 있습니다'));

    const open = request.body?.open;
    if (typeof open !== 'boolean') return reply.code(400).send(fail('open 은 true 또는 false 여야 합니다'));
    if (open && !hasPassword()) {
      return reply.code(409).send(fail('먼저 접속 암호를 정하세요. 암호 없이 태블릿에 열지 않습니다.'));
    }

    setStoredLanOpen(open);
    app.log.warn(
      open
        ? '태블릿 접속을 켰습니다 — 다시 시작하면 같은 WiFi 의 기기가 접속할 수 있습니다 (암호 필요)'
        : '태블릿 접속을 껐습니다 — 다시 시작하면 이 PC 안에서만 열립니다',
    );
    return ok({ lanOpen: open, restartRequired: true, packaged: isPackagedApp() });
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

    /*
     * **이름이 아니라 절대 경로로 돌린다** (점검 P-5).
     *
     * 설치판의 `PATH` 에는 `/opt/homebrew/bin` 이 없다. 이름으로 돌리면
     * '허용된 명령인데 실행이 안 된다' 가 된다 — 화면은 눌렀는데 실패만 남는다.
     */
    const binary = await findTool(file);
    if (binary === undefined) {
      return reply
        .code(409)
        .send(fail(`${file} 을 찾지 못했습니다. 공식 페이지에서 직접 받아 주세요.`));
    }

    // 설치는 오래 걸린다 (내려받기 포함). 10분을 넘기면 무언가 잘못된 것이다
    const result = await run(binary, args, 10 * 60 * 1000);
    if (!result.ok) {
      return reply.code(500).send(fail(`설치에 실패했습니다. 공식 페이지에서 직접 받아 주세요.\n${result.output.slice(0, 500)}`));
    }
    return ok({ command, output: result.output.slice(0, 1000) });
  });
}
