/**
 * 포장 직후 손보기 — **없는 asar 을 가리키는 무결성 항목을 지운다.**
 *
 * ## 무엇이 문제였나
 *
 * `asar: false` 로 포장하면 electron-builder 가 `default_app.asar` 을 지우면서도
 * `Info.plist` 의 `ElectronAsarIntegrity` 에는 그 파일의 해시를 남긴다. Electron 은
 * 뜰 때 그 항목을 검사하는데, 파일이 없으니 **`app.whenReady()` 에서 SIGTRAP 으로
 * 죽는다.** 창도 로그도 없이 종료 코드 133 만 남아 원인을 찾기 어려웠다
 * (2026-09-05, 크래시 리포트를 읽고 알아냈다).
 *
 * ## 왜 asar 을 안 쓰는가
 *
 * 서버가 `public/` 을 정적으로 서빙하고 `dist-server/` 를 `import()` 로 불러온다.
 * asar 안은 가상 파일시스템이라 이 둘이 온전히 동작한다는 보장이 없다. 압축을
 * 포기하는 대신 구조가 단순해지고, 문제가 생겼을 때 앱 안을 열어 볼 수 있다.
 *
 * ## 윈도우는?
 *
 * 이 항목은 macOS 의 `Info.plist` 에만 있다. 윈도우 빌드에서는 할 일이 없다.
 */

const { existsSync, readFileSync, writeFileSync } = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;

  const appName = context.packager.appInfo.productFilename;
  const plist = path.join(context.appOutDir, `${appName}.app`, 'Contents', 'Info.plist');
  if (!existsSync(plist)) return;

  // 바이너리 plist 일 수 있으므로 PlistBuddy 로 다룬다. 없으면 조용히 넘어간다
  try {
    execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Delete :ElectronAsarIntegrity', plist], {
      stdio: 'pipe',
    });
    console.log(`  • ElectronAsarIntegrity 제거 (asar 을 쓰지 않으므로)  ${appName}`);
  } catch {
    // 항목이 애초에 없으면 PlistBuddy 가 실패한다 — 그것이 정상이다
  }

  // 지워졌는지 확인한다. 남아 있으면 앱이 뜨지 않으므로 **빌드를 실패시킨다** —
  // 조용히 넘기면 '설치했는데 안 켜진다' 를 사용자가 겪는다
  const raw = readFileSync(plist);
  if (raw.includes('ElectronAsarIntegrity')) {
    throw new Error('ElectronAsarIntegrity 를 지우지 못했습니다 — 이대로는 앱이 뜨지 않습니다');
  }
  void writeFileSync;
};
