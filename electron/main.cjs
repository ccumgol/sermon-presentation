/**
 * Electron 메인 프로세스 — 서버를 이 프로세스 안에서 띄우고 창을 연다.
 *
 * ## 왜 별도 프로세스로 띄우지 않는가
 *
 * 서버를 자식 프로세스로 돌리면 앱을 닫을 때 그것이 살아남아 포트를 붙들고,
 * 다음에 켤 때 '이미 쓰는 중' 이 된다. 한 프로세스 안에 두면 앱이 죽을 때 함께 죽는다.
 * DB 도 이쪽이 안전하다 — 종료 신호를 우리가 직접 다룰 수 있다.
 *
 * ## 경로를 여기서 정한다
 *
 * `server/paths.ts` 는 환경 변수 하나만 보면 되도록 만들어져 있다.
 *   · `SERMON_DATA_DIR`  → 쓰기 가능한 자리 (Application Support · AppData)
 *   · `SERMON_APP_ROOT`  → `public/` 이 있는 자리 (앱 안, 읽기 전용)
 *
 * 앱 번들 안에는 쓸 수 없다 — 맥의 `.app` 은 서명돼 읽기 전용이고, 윈도우의
 * `Program Files` 는 관리자 권한이 필요하다. 그래서 둘을 반드시 나눈다.
 *
 * ## 확장자가 `.cjs` 인 이유
 *
 * 이 저장소는 `"type": "module"` 이라 `.js` 는 ESM 으로 읽힌다. Electron 메인은
 * CJS 로 두는 편이 시작이 단순한데(최상위 `return` 으로 두 번 켜짐을 막는 등),
 * 그러려면 확장자가 `.cjs` 여야 한다. `.js` 로 두었다가 실제로
 * `Illegal return statement` 로 앱이 뜨지 않았다.
 *
 * 서버 본체는 ESM 이므로 `import()` 로 불러온다.
 */

const { appendFileSync, mkdirSync } = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow, shell, dialog, Menu } = require('electron');

const { argsWithAttempt, decideRestart, readAttempt } = require('./restart-policy.cjs');

/** 포장했으면 `resources/app` 안, 개발 중이면 저장소 루트 */
const APP_ROOT = app.isPackaged ? path.join(process.resourcesPath, 'app') : path.join(__dirname, '..');

process.env.SERMON_APP_ROOT = APP_ROOT;
/*
 * 사용자 자료는 `userData` **아래 한 칸 더** 둔다.
 *
 * `userData` 자체에는 Electron 이 Cookies·Cache·GPUCache 같은 자기 파일을 잔뜩
 * 만든다. 거기에 가사와 순서표를 섞으면 '데이터 폴더 열기' 가 크로뮴 내부를
 * 보여 주게 되고, **'이 폴더만 복사하면 이사가 됩니다' 라는 안내가 거짓이 된다.**
 *
 * 이미 정해 둔 것이 있으면 존중한다 (검증·이전용).
 */
if (!process.env.SERMON_DATA_DIR) process.env.SERMON_DATA_DIR = path.join(app.getPath('userData'), 'data');
/*
 * 성경 DB 는 **건드리지 않는다.**
 *
 * `server/paths.ts` 의 기본값이 이미 `<데이터 폴더>/bible.sqlite` 로 맞다.
 *
 * 처음에는 여기서 `APP_ROOT/data/bible.sqlite` 로 덮어썼는데, 그 자리는 **앱
 * 번들 안**이고 거기엔 `data/` 가 없다 — 저작권 자료라 일부러 넣지 않기 때문이다.
 * 그래서 사용자가 성경 DB 를 데이터 폴더에 제대로 넣어도 '성경 DB 가 없습니다'
 * 가 떴다 (2026-09-05 사용자 보고).
 *
 * 다른 자리를 쓰고 싶으면 `SERMON_BIBLE_DB` 로 지정한다 — 여러 계정이 한 파일을
 * 나눠 쓰는 경우다.
 */

/** 서버가 안내 문구를 가려 쓰도록 알려 준다 — 포장한 앱에는 터미널도 저장소도 없다 */
process.env.SERMON_PACKAGED = '1';

/** 두 번 켜지 않는다 — 두 번째 창은 첫 번째를 앞으로 불러오고 끝낸다 */
if (!app.requestSingleInstanceLock()) {
  app.quit();
  return;
}

let mainWindow = null;
let stopServer = null;

/*
 * ── 처리되지 않은 오류 — **가장 먼저 등록한다** (점검 P-4) ──────────
 *
 * 터미널로 돌릴 때는 `server/index.ts` 가 오류를 크게 남기고 죽고, `start.sh` 의
 * 감시 루프가 1초 뒤 다시 띄운다. **설치판에는 둘 다 없었다** — 서버가 이 프로세스
 * 안에서 도는데 처리되지 않은 오류가 나면 앱이 그냥 사라진다. 예배 중이면 화면은
 * 마지막 슬라이드로 멈추고, 다시 켜 줄 사람은 봉사자다.
 *
 * **오류를 삼켜 살려 두지 않는다** — `server/index.ts` 와 같은 판단이다. 그 뒤
 * 프로세스 상태를 믿을 수 없으므로(반쯤 열린 트랜잭션·깨진 소켓) **빨리 죽고 빨리
 * 살아나는 편**이 안전하다. 여기서는 `app.relaunch()` 가 감시 루프 노릇을 한다.
 *
 * 세 가지를 반드시 지킨다:
 *   ① **터미널이 없다** → 무슨 일이었는지 데이터 폴더의 `crash.log` 에 적는다
 *   ② **DB 를 닫는다** → `app.exit()` 는 `before-quit` 를 건너뛴다. 안 닫으면 WAL 이
 *      남아 데이터 폴더를 복사했을 때 빈 DB 가 된다 (2026-09-04 실측)
 *   ③ **거듭 죽으면 멈춘다** → 무한 재시작은 원인을 가린다 (`restart-policy.cjs`)
 */
const startedAt = Date.now();
const restartAttempt = readAttempt(process.argv);
let handlingCrash = false;

/** 데이터 폴더에 남긴다 — 설치판을 쓰는 사람이 찾아갈 수 있는 유일한 자리다 */
function writeCrashLog(kind, detail) {
  try {
    const dir = process.env.SERMON_DATA_DIR;
    mkdirSync(dir, { recursive: true });
    const line = `\n[${new Date().toISOString()}] ${kind} (다시 시작 ${restartAttempt}회 뒤)\n${detail}\n`;
    appendFileSync(path.join(dir, 'crash.log'), line, 'utf8');
    return path.join(dir, 'crash.log');
  } catch {
    // 로그를 못 남겨도 되살리기는 해야 한다
    return null;
  }
}

/** DB 를 닫는다. `app.exit()` 전에 반드시 — 안 닫으면 WAL 이 남는다 */
function closeServerQuietly() {
  if (!stopServer) return;
  const close = stopServer;
  stopServer = null;
  try {
    close();
  } catch {
    /* 닫다 실패해도 종료는 해야 한다 */
  }
}

function onFatal(kind, error) {
  // 종료 중에 또 나는 오류로 되살리기가 꼬이지 않게 한 번만 다룬다
  if (handlingCrash) return;
  handlingCrash = true;

  const detail = error && error.stack ? error.stack : String(error);
  const logPath = writeCrashLog(kind, detail);
  const verdict = decideRestart({ livedMs: Date.now() - startedAt, attempt: restartAttempt });

  closeServerQuietly();

  if (verdict.restart) {
    app.relaunch({ args: argsWithAttempt(process.argv.slice(1), verdict.nextAttempt) });
    app.exit(1);
    return;
  }

  /*
   * 포기할 때는 **말없이 사라지지 않는다.** 무엇이 일어났고 어디를 봐야 하는지
   * 알려 준다 — 그러지 않으면 '눌렀는데 안 켜진다' 만 남는다.
   */
  try {
    dialog.showErrorBox(
      '예배 프레젠테이션이 계속 종료됩니다',
      `${verdict.reason}\n\n${kind}\n${detail.split('\n').slice(0, 6).join('\n')}` +
        (logPath ? `\n\n자세한 기록: ${logPath}` : ''),
    );
  } catch {
    /* 창을 띄울 수 없는 시점일 수 있다 */
  }
  app.exit(1);
}

process.on('uncaughtException', (error) => onFatal('처리되지 않은 예외', error));
process.on('unhandledRejection', (reason) => onFatal('처리되지 않은 거부(Promise)', reason));

function createWindow(url) {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    title: '예배 프레젠테이션',
    backgroundColor: '#0e1116',
    // 조작 화면은 우리 서버의 페이지다. 렌더러에 Node 를 열어 줄 이유가 없다
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  });

  void mainWindow.loadURL(url);

  /*
   * 새 창(프로젝터·강사 모니터)은 **Electron 창으로** 연다.
   *
   * 기본 동작대로 두면 바깥 브라우저가 뜨는데, 그러면 전체 화면·번인 대책 등
   * 프로젝터 창이 하는 일이 딴 데서 돌아 손이 두 곳으로 갈린다.
   */
  mainWindow.webContents.setWindowOpenHandler(({ url: target }) => {
    if (target.startsWith(url.replace(/\/$/, ''))) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: { width: 1280, height: 720, backgroundColor: '#000000' },
      };
    }
    // 바깥 주소(설치 안내의 공식 페이지 등)는 기본 브라우저로 — 앱 안에 가두지 않는다
    void shell.openExternal(target);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

async function start() {
  const { startServer } = await import(path.join(APP_ROOT, 'dist-server', 'server', 'electron-entry.js'));
  const { url, close } = await startServer();
  stopServer = close;
  createWindow(url);
}

app.whenReady().then(
  () => {
    Menu.setApplicationMenu(Menu.getApplicationMenu());
    return start();
  },
  () => undefined,
).catch((error) => {
  /*
   * 서버가 못 뜨면 **빈 창을 띄우지 않는다.** 무슨 일인지 적어 보여 주고 끝낸다 —
   * 예배 준비 중에 검은 창만 보면 손쓸 방법이 없다.
   */
  dialog.showErrorBox(
    '시작하지 못했습니다',
    `${error && error.message ? error.message : String(error)}\n\n` +
      `데이터 폴더: ${process.env.SERMON_DATA_DIR}`,
  );
  app.quit();
});

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

app.on('activate', () => {
  // 맥에서 독 아이콘을 누르면 창이 다시 떠야 한다
  if (BrowserWindow.getAllWindows().length === 0 && stopServer) void start();
});

app.on('window-all-closed', () => {
  app.quit();
});

/** 끝낼 때 DB 를 닫는다 — 안 닫으면 WAL 이 남아 복사한 파일이 빈 DB 가 된다 */
app.on('before-quit', () => {
  if (stopServer) {
    const close = stopServer;
    stopServer = null;
    try {
      close();
    } catch {
      /* 닫다 실패해도 종료는 해야 한다 */
    }
  }
});
