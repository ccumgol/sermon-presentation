/**
 * Electron 에서 서버를 띄우는 진입점.
 *
 * `server/index.ts` 는 터미널용이다 — 최상위 `await` 로 곧바로 실행되고, 로그를
 * 예쁘게 찍고, 끝날 때 `process.exit` 를 부른다. Electron 은 **함수로 부르고
 * 함수로 끝낼 수 있어야** 하므로 진입점을 따로 둔다.
 *
 * 앱 구성(`buildApp`)과 포트 탐색(`listenWithFallback`)은 그대로 나눠 쓴다 —
 * 한쪽만 고치면 '터미널로는 되는데 앱으로는 안 된다' 가 된다.
 *
 * ## 로그를 꾸미지 않는다
 *
 * `pino-pretty` 는 별도 프로세스(worker)를 띄운다. 포장한 앱 안에서는 그 경로를
 * 찾지 못해 시작이 통째로 실패할 수 있다. 창이 있는 앱에서는 예쁜 로그가 볼 사람도
 * 없으므로 기본 출력을 쓴다.
 */

import { buildApp } from './app.ts';
import { DEFAULT_PORT, PORT_SCAN_RANGE, isLanHost, resolveHost } from './config.ts';
import { closeAppDb } from './db/app.ts';
import { closeBibleDb } from './db/bible.ts';
import { closeSongsDb } from './db/songs.ts';
import { hasPassword } from './auth.ts';
import { listenWithFallback } from './listen.ts';
import { storedLanOpen } from './lan-setting.ts';
import { createWsHub, type WsHub } from './ws.ts';

export interface RunningServer {
  /** 조작 화면 주소 — 창이 이걸 연다 */
  url: string;
  port: number;
  /** 앱을 끝낼 때 부른다. **DB 를 닫는 것이 요점이다** */
  close: () => void;
}

export async function startServer(): Promise<RunningServer> {
  let actualPort = DEFAULT_PORT;
  let hub: WsHub | null = null;

  const { app } = await buildApp({
    getPort: () => actualPort,
    getConnections: () => hub?.counts() ?? { control: 0, output: 0 },
    onTemplateChanged: (template) => hub?.pushTemplate(template),
  });

  /*
   * 바인딩 주소 — 설정 탭에서 켠 '태블릿에 열기' 를 여기서 반영한다 (점검 P-1).
   *
   * **암호가 없으면 열지 않고 이 PC 안으로 되돌린다.** 터미널판은 이 상황에서
   * 종료하지만(사람이 곧바로 고칠 수 있다), **창이 있는 앱은 그러면 안 된다** —
   * 예배 준비 중에 앱이 아예 안 뜨는 것이 더 나쁘다. 열지 않고 알린다.
   */
  const wantsLan = isLanHost(resolveHost(storedLanOpen()));
  const host = wantsLan && !hasPassword() ? '127.0.0.1' : resolveHost(storedLanOpen());
  if (wantsLan && !hasPassword()) {
    app.log.error('태블릿에 열도록 되어 있지만 접속 암호가 없어 이 PC 안에서만 열었습니다.');
    app.log.error('  설정 탭 → 태블릿에서 조작하기 → 접속 암호를 정한 뒤 앱을 다시 시작하세요.');
  }

  actualPort = await listenWithFallback(app, {
    firstPort: DEFAULT_PORT,
    range: PORT_SCAN_RANGE,
    host,
    onBusy: (port) => app.log.warn(`포트 ${port} 사용 중 — 다음 포트를 시도합니다`),
  });

  hub = createWsHub(app.server, {
    info: (msg) => app.log.info(msg),
    warn: (msg) => app.log.warn(msg),
  });

  return {
    url: `http://localhost:${actualPort}/`,
    port: actualPort,
    /*
     * **DB 를 닫는 것이 이 함수의 요점이다.**
     *
     * 닫아야 SQLite 가 WAL 을 본체에 합친다. 안 닫으면 `songs.sqlite` 만 복사했을 때
     * 빈 DB 가 된다 — 데이터 폴더를 통째로 옮기는 것이 이 앱의 이사 방법이라
     * 그냥 넘길 수 없다 (2026-09-04 실측).
     *
     * 닫다 실패해도 종료는 되어야 하므로 하나씩 감싼다.
     */
    close: () => {
      for (const closeOne of [() => hub?.close(), () => void app.close(), closeBibleDb, closeAppDb, closeSongsDb]) {
        try {
          closeOne();
        } catch {
          /* 하나가 실패해도 나머지는 닫는다 */
        }
      }
    },
  };
}
