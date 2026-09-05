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

const path = require('node:path');
const { app, BrowserWindow, shell, dialog, Menu } = require('electron');

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
// 성경 DB 는 앱과 함께 배포된다 (있을 때만)
if (!process.env.SERMON_BIBLE_DB) process.env.SERMON_BIBLE_DB = path.join(APP_ROOT, 'data', 'bible.sqlite');

/** 두 번 켜지 않는다 — 두 번째 창은 첫 번째를 앞으로 불러오고 끝낸다 */
if (!app.requestSingleInstanceLock()) {
  app.quit();
  return;
}

let mainWindow = null;
let stopServer = null;

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
