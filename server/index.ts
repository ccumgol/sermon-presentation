/**
 * 실행 진입점. 앱 구성은 server/app.ts 가 담당하고 여기서는 바인딩과 종료만 다룬다.
 *
 * 실행: npm start (컨트롤 패널을 빌드한 뒤 기동) / npm run serve (빌드 없이)
 */

import { buildApp, lanInterfaces } from './app.ts';
import { hasPassword } from './auth.ts';
import { DEFAULT_PORT, HOST, IS_LAN_OPEN, PORT_SCAN_RANGE } from './config.ts';
import { closeAppDb } from './db/app.ts';
import { closeBibleDb } from './db/bible.ts';
import { paths } from './paths.ts';
import { createWsHub, type WsHub } from './ws.ts';

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
if (IS_LAN_OPEN && !hasPassword()) {
  app.log.error('LAN 에 열려면 접속 암호가 필요합니다. 아직 정해지지 않았습니다.');
  app.log.error("  이 PC 에서:  npm run password");
  app.log.error('  암호 없이 이 PC 안에서만 쓰려면:  ./start.sh  (또는 npm start)');
  closeAppDb();
  process.exit(1);
}

/**
 * 포트를 순차 탐색해 바인딩한다.
 * 다른 PC 에서 7777 이 이미 쓰이고 있어도 앱이 죽지 않아야 한다 (계획서 D1 제약 2).
 */
async function listenWithFallback(): Promise<number> {
  let lastError: unknown;
  for (let port = DEFAULT_PORT; port < DEFAULT_PORT + PORT_SCAN_RANGE; port++) {
    try {
      await app.listen({ port, host: HOST });
      return port;
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code !== 'EADDRINUSE') throw err;
      lastError = err;
      app.log.warn(`포트 ${port} 사용 중 — 다음 포트를 시도합니다`);
    }
  }
  throw lastError ?? new Error('사용 가능한 포트를 찾지 못했습니다');
}

actualPort = await listenWithFallback();

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
if (IS_LAN_OPEN) {
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
if (!bibleReady) {
  app.log.warn(
    `성경 DB 가 없어 조회 기능이 비활성입니다 (${paths.bibleDb}) — 'npm run bible:build' 실행 후 재시작하세요`,
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
      process.exit(0);
    });
  });
}
