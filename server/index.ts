/**
 * 실행 진입점. 앱 구성은 server/app.ts 가 담당하고 여기서는 바인딩과 종료만 다룬다.
 *
 * 실행: npm start (컨트롤 패널을 빌드한 뒤 기동) / npm run serve (빌드 없이)
 */

import { buildApp, lanInterfaces } from './app.ts';
import { hasPassword } from './auth.ts';
import { DEFAULT_PORT, PORT_SCAN_RANGE, isLanHost, resolveHost } from './config.ts';
import { closeAppDb } from './db/app.ts';
import { closeBibleDb } from './db/bible.ts';
import { closeSongsDb } from './db/songs.ts';
import { onSameDevice } from './db/snapshot.ts';
import { storedLanOpen } from './lan-setting.ts';
import { bibleMissingLine } from '../lib/bible-missing.ts';
import { listenWithFallback } from './listen.ts';
import { paths } from './paths.ts';
import { createWsHub, type WsHub } from './ws.ts';

/*
 * ── 처리되지 않은 오류 — **가장 먼저 등록한다** ─────────────────────
 *
 * **예배 중에 도는 서버다.** 전에는 이런 오류가 나면 Node 기본 동작으로 프로세스가
 * 사라졌다. 화면은 마지막 슬라이드로 멈춘 채 남지만(검은 화면은 아니다) 다음 장으로
 * 넘길 수 없고, 무엇이 죽였는지는 스택 추적만 남았다.
 *
 * **오류를 삼켜 살려 두지 않는다.** `uncaughtException` 뒤의 프로세스 상태는 믿을 수
 * 없다 — 반쯤 열린 트랜잭션이나 깨진 WebSocket 을 안고 예배를 계속하는 것이 더 나쁘다.
 * 대신 **사람이 읽을 수 있게 남기고** 곧바로 나간다. 되살리는 것은 `start.sh` 의
 * 감시 루프가 한다 (1초면 다시 뜬다).
 *
 * **파일 맨 위에 있어야 한다.** 처음에는 종료 처리 옆(아래쪽)에 두었는데, 이 파일은
 * 최상위 `await` 로 앱을 만들고 포트를 연다 — 그 사이에 나는 오류는 핸들러가 등록되기
 * **전**이라 걸리지 않았다. `PORT=1` 로 시험해 실제로 확인했다 (2026-08-28).
 * 그래서 `app` 이 아직 없을 수 있고, 로거 대신 `console.error` 를 쓴다.
 */
function dieLoudly(kind: string, err: unknown): void {
  const detail = err instanceof Error ? (err.stack ?? err.message) : String(err);
  console.error(`\n❌ ${kind} — 서버를 종료합니다. start.sh 가 곧 다시 띄웁니다.`);
  console.error(detail);
  process.exit(1);
}

process.on('uncaughtException', (err) => dieLoudly('처리되지 않은 예외', err));
process.on('unhandledRejection', (reason) => dieLoudly('처리되지 않은 거부(Promise)', reason));

let actualPort = DEFAULT_PORT;
let hub: WsHub | null = null;

const { app, bibleReady, stateRestored } = await buildApp({
  logger: {
    level: process.env.LOG_LEVEL ?? 'info',
    transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } },
  },
  getPort: () => actualPort,
  getConnections: () => hub?.counts() ?? { control: 0, output: 0 },
  // REST 로 템플릿을 고치면 송출 화면에 즉시 반영된다
  onTemplateChanged: (template) => hub?.pushTemplate(template),
});

if (stateRestored.corrupt) {
  app.log.warn('저장된 송출 상태를 읽을 수 없어 초기 상태로 시작합니다');
} else if (stateRestored.restored) {
  app.log.info('이전 송출 상태를 복구했습니다');
}

/*
 * 암호 없이 LAN 을 열지 않는다 (보안 감사 권고 4).
 *
 * 여는 순간 같은 WiFi 의 누구나 예배 화면을 바꾸고 찬양 가사를 지울 수 있게 된다.
 * 그래서 '경고만 하고 열기' 대신 **거부**한다 — 고치는 방법은 한 줄이고,
 * `./start.sh lan` 은 이 상황을 미리 잡아 그 자리에서 물어본다.
 */
/*
 * 바인딩 주소는 **환경 변수와 저장된 선택**을 함께 본다 (점검 P-1).
 * 환경 변수가 이기므로 `./start.sh lan` 과 격리 서버 검증은 그대로 동작한다.
 */
const host = resolveHost(storedLanOpen());
const lanOpen = isLanHost(host);

if (lanOpen && !hasPassword()) {
  app.log.error('LAN 에 열려면 접속 암호가 필요합니다. 아직 정해지지 않았습니다.');
  app.log.error("  이 PC 에서:  npm run password  (또는 앱의 설정 탭 → 태블릿에서 조작하기)");
  app.log.error('  암호 없이 이 PC 안에서만 쓰려면:  ./start.sh  (또는 npm start)');
  closeAppDb();
  process.exit(1);
}

actualPort = await listenWithFallback(app, {
  firstPort: DEFAULT_PORT,
  range: PORT_SCAN_RANGE,
  host,
  onBusy: (port) => app.log.warn(`포트 ${port} 사용 중 — 다음 포트를 시도합니다`),
});

// WebSocket 허브는 HTTP 서버가 뜬 뒤에 붙인다
hub = createWsHub(app.server, {
  info: (msg) => app.log.info(msg),
  warn: (msg) => app.log.warn(msg),
});

app.log.info(`컨트롤 패널      : http://localhost:${actualPort}/`);
app.log.info(`OBS 브라우저 소스: http://localhost:${actualPort}/output/?layer=main`);

// 어느 모드로 떠 있는지 반드시 알려 준다.
//
// 기본을 localhost 로 바꾸면서, 태블릿을 쓰던 사람에게는 '갑자기 안 되는' 상황이
// 된다. 원인과 여는 방법을 기동 때 바로 보여 주지 않으면 예배 직전에 헤맨다.
if (lanOpen) {
  const nics = lanInterfaces();
  for (const nic of nics) {
    app.log.info(`태블릿 접속      : http://${nic.address}:${actualPort}/   (${nic.iface})`);
  }
  if (nics.length > 1) {
    // 주소가 여러 개면 어느 것을 넣어야 하는지 알 수 없다. 고르는 기준을 알려 준다.
    app.log.info('주소가 여러 개면 태블릿과 같은 망의 것을 쓰세요 — 태블릿 IP 와 앞 세 자리가 같은 것');
  }
  app.log.info('태블릿은 접속 암호를 넣어야 합니다 (이 PC 는 묻지 않습니다)');
  app.log.warn('예배가 끝나면 닫으세요 (그냥 npm start 로 실행하면 이 PC 안에서만 열립니다)');
} else {
  app.log.info('접속 범위        : 이 PC 안에서만 (태블릿으로 조작하려면 ./start.sh lan)');
}
/*
 * 백업이 원본과 같은 디스크에 있으면 알린다.
 *
 * `songs.sqlite` 는 git 에 없어 되돌릴 방법이 백업뿐인데, 같은 디스크라면 디스크가
 * 죽을 때 둘을 함께 잃는다. **예배가 시작되기 전에** 보이도록 여기서 한 번 말한다 —
 * 스크립트를 돌릴 때만 말하면 정작 봐야 할 사람이 못 본다.
 */
if (onSameDevice(paths.songsDb, paths.backupsDir)) {
  app.log.warn(`백업이 원본과 같은 디스크에 있습니다 (${paths.backupsDir})`);
  app.log.warn('  디스크가 죽으면 가사와 백업을 함께 잃습니다. 다른 디스크를 가리키세요:');
  app.log.warn('  SERMON_BACKUP_DIR=~/Library/CloudStorage/Dropbox/sermon-backups ./start.sh');
}

if (!bibleReady) {
  app.log.warn(
    bibleMissingLine(paths.bibleDb),
  );
}

let shuttingDown = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info('종료합니다');
    hub?.close();
    void app.close().then(() => {
      closeBibleDb();
      closeAppDb();
      /*
       * **곡 DB 도 닫는다.** 닫아야 SQLite 가 WAL 을 본체에 합치고 `-wal`·`-shm` 을
       * 지운다.
       *
       * 빠뜨렸을 때 실측(2026-09-04): 정상 종료 뒤에도 `songs.sqlite` 4KB +
       * `-wal` 234KB 가 남고, 그 한 파일만 복사해 열면 `no such table: songs` —
       * **빈 DB** 였다. 평소에는 다음에 열 때 WAL 을 읽어 탈이 없지만,
       * 파일을 복사하거나 클라우드로 동기화하면 그대로 빈 DB 가 따라간다.
       */
      closeSongsDb();
      process.exit(0);
    });
  });
}
