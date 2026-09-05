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
 * ## 그리고 — **애드혹 서명**
 *
 * 서명하지 않은 앱을 다른 맥으로 옮기면 macOS 가
 * **'손상되었기 때문에 열 수 없습니다'** 라고 말한다 (2026-09-05 사용자 보고).
 * 실제로 깨진 것이 아니라, 옮길 때 붙는 격리 표시(`com.apple.quarantine`)를 보고
 * Gatekeeper 가 서명을 검사했는데 **번들 서명이 아예 없어서** 나오는 말이다.
 * 만든 맥에서는 격리 표시가 없어 그냥 열린다 — 그래서 눈치채기 어렵다.
 *
 * 애드혹 서명을 제대로 해 두면 그 문구가 '확인할 수 없습니다' 로 바뀌고,
 * **시스템 설정 → 개인 정보 보호 및 보안 → 그래도 열기** 로 열 수 있다.
 * (완전히 없애려면 Apple 개발자 계정으로 공증해야 한다 — docs/PACKAGING.md)
 *
 * `--deep` 은 쓰지 않는다. Electron 에서 깨진다고 알려져 있고, Apple 도 권하지
 * 않는다. **안쪽(프레임워크·헬퍼)부터 바깥(앱)으로** 하나씩 서명한다.
 *
 * ## 윈도우는?
 *
 * 여기서 하는 일은 전부 macOS 것이다. 윈도우 빌드에서는 할 일이 없다.
 */

const { existsSync, readFileSync, statSync } = require('node:fs');
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

  // Info.plist 를 **고친 뒤에** 서명한다. 순서가 반대면 서명이 곧바로 깨진다
  adhocSign(path.join(context.appOutDir, `${appName}.app`), appName);
};

/** `find` 로 경로를 모은다. 없으면 빈 배열 — 구조가 달라져도 빌드가 멈추지 않게 */
function findPaths(root, args) {
  try {
    return execFileSync('find', [root, ...args], { encoding: 'utf8' })
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  } catch {
    return [];
  }
}

/**
 * 애드혹 서명 — **깊은 곳부터 바깥으로.**
 *
 * `--deep` 은 쓰지 않는다 (Electron 에서 깨지고 Apple 도 권하지 않는다). 대신
 * 순서를 직접 정한다. 순서를 지키지 않으면 바깥을 서명할 때
 * `code object is not signed at all / In subcomponent: .../chrome_crashpad_handler`
 * 로 실패한다 — 실제로 x64 빌드에서 그렇게 막혔다 (2026-09-05).
 */
function adhocSign(appPath, appName) {
  const sign = (target) => {
    execFileSync('codesign', ['--force', '--sign', '-', '--timestamp=none', target], { stdio: 'pipe' });
  };

  // ① 라이브러리·네이티브 모듈
  for (const file of findPaths(appPath, [
    '-type', 'f', '(', '-name', '*.dylib', '-o', '-name', '*.so', '-o', '-name', '*.node', ')',
  ])) sign(file);

  // ② 프레임워크 안의 도우미 실행 파일 (chrome_crashpad_handler 등)
  for (const file of findPaths(appPath, ['-type', 'f', '-path', '*/Helpers/*', '-perm', '+111'])) {
    // 번들 안의 실행 파일은 그 번들을 서명할 때 함께 봉인된다 — 여기서는 낱개만
    if (!file.includes('.app/Contents/MacOS/')) sign(file);
  }

  // ③ 안에 든 번들 — **깊은 것부터**. 경로가 길수록 안쪽이다
  const bundles = findPaths(appPath, ['(', '-name', '*.framework', '-o', '-name', '*.app', ')'])
    .filter((one) => path.resolve(one) !== path.resolve(appPath))
    .sort((a, b) => b.split(path.sep).length - a.split(path.sep).length);
  for (const bundle of bundles) sign(bundle);

  // ④ 마지막으로 앱 자신
  sign(appPath);
  void statSync;

  /*
   * **서명이 유효한지 확인하고, 아니면 빌드를 실패시킨다.**
   *
   * 조용히 넘기면 '다른 맥에서만 안 켜진다' 를 받는 사람이 겪는다 — 만든 사람은
   * 격리 표시가 없어 끝까지 모른다. 그것이 이번에 실제로 일어난 일이다.
   */
  try {
    execFileSync('codesign', ['--verify', '--strict', '--deep', appPath], { stdio: 'pipe' });
  } catch (error) {
    const detail = error && error.stderr ? String(error.stderr) : String(error);
    throw new Error(`애드혹 서명이 유효하지 않습니다 — 다른 맥에서 '손상됨' 으로 막힙니다\n${detail}`);
  }
  console.log(`  • 애드혹 서명 완료 (검증 통과)  ${appName}`);
}
