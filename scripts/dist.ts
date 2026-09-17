/**
 * 설치 파일을 만든다 — **`_core`(프로그램만)** 와 **`_full`(자료까지)** 두 벌
 * (2026-09-17 사용자 요청).
 *
 * ```bash
 * npm run dist:core          # 이 PC 가 만들 수 있는 것 전부 (맥에서는 맥용)
 * npm run dist:full          # 자료를 담아서
 * npm run dist:core -- --win # 대상을 콕 집을 때
 * ```
 *
 * ## 왜 스크립트가 끼는가
 *
 * electron-builder 설정 하나로 두 벌을 만들려면 **갈래가 필요한 곳이 두 군데**다 —
 * 파일 이름과, 자료를 담느냐 마느냐. 설정 파일을 둘로 나누면 나머지 200줄이
 * 복사돼 따로 늙는다. 그래서 설정은 하나로 두고, 갈리는 것만 여기서 준비한다.
 *
 *   1. `SERMON_VARIANT` 를 넣는다 → `artifactName` 의 `${env.SERMON_VARIANT}`
 *   2. `build-data/` 를 채우거나 비운다 → `extraResources` 가 그대로 담는다
 *
 * ## ⚠️ 윈도우 `_full` 은 맥에서 만들 수 없다
 *
 * NSIS 설치 파일은 윈도우나 Wine 이 있어야 만들어진다. 그리고 CI 도 답이 아니다 —
 * **자료가 git 에 없고, 올리는 순간 그것이 저작권 문제다.** 윈도우에 자료를 넣는
 * 길은 `_core` + 자료 꾸러미(설정 탭에서 설치)다. 이 스크립트는 그 경우
 * **왜 안 되는지 말하고 멈춘다** — 조용히 빈 `_full` 을 만들지 않는다.
 */

import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { platform } from 'node:process';

import { DATA_PACK_VERSION } from '../lib/data-pack.ts';
import { paths } from '../server/paths.ts';

type Variant = 'core' | 'full';

const stageDir = path.join(paths.appRoot, 'build-data');
const packDir = path.join(paths.appRoot, 'release', `sermon-data-${DATA_PACK_VERSION}`);
const README = 'README.txt';

function fail(message: string): never {
  console.error(`\n✖ ${message}\n`);
  process.exit(1);
}

/** 안내문만 남기고 비운다 — 지난번 `_full` 의 자료가 `_core` 에 섞이지 않게 */
function clearStage(): void {
  mkdirSync(stageDir, { recursive: true });
  for (const name of readdirSync(stageDir)) {
    if (name === README) continue;
    rmSync(path.join(stageDir, name), { recursive: true, force: true });
  }
}

function stageSizeBytes(): number {
  let bytes = 0;
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      const stat = statSync(full);
      if (stat.isDirectory()) walk(full);
      else bytes += stat.size;
    }
  };
  walk(stageDir);
  return bytes;
}

/**
 * `_full` 준비 — 자료 꾸러미를 `build-data/` 로 옮긴다.
 *
 * 꾸러미가 없으면 **여기서 만들지 않는다.** `npm run data:pack` 은 사용자 DB 를
 * 읽는 일이고, 빌드 명령이 말없이 그걸 하는 것보다 시키는 편이 낫다.
 */
function stageFull(): void {
  if (!existsSync(path.join(packDir, 'manifest.json'))) {
    fail(
      `자료 꾸러미가 없습니다: ${packDir}\n` +
        `  먼저 만드세요:  npm run data:pack`,
    );
  }

  clearStage();
  for (const name of readdirSync(packDir)) {
    cpSync(path.join(packDir, name), path.join(stageDir, name), { recursive: true });
  }

  const mb = Math.round(stageSizeBytes() / 1024 / 1024);
  console.log(`· 자료 ${mb}MB 를 설치판에 담습니다 (${packDir})`);
}

function main(): void {
  const args = process.argv.slice(2);
  const variant: Variant = args.includes('--full') ? 'full' : 'core';

  // 대상을 안 주면 electron-builder 가 이 PC 가 만들 수 있는 것을 고른다
  const targets = args.filter((arg) => arg === '--mac' || arg === '--win' || arg === '--linux');
  const wantsWin = targets.includes('--win');

  if (variant === 'full' && wantsWin && platform !== 'win32') {
    fail(
      '윈도우 _full 설치 파일은 이 PC 에서 만들 수 없습니다.\n' +
        '  NSIS 는 윈도우나 Wine 이 있어야 하고, CI 로도 못 합니다 —\n' +
        '  자료가 git 에 없고 올리면 그것이 곧 저작권 문제입니다.\n\n' +
        '  대신: 윈도우는 _core 로 설치한 뒤, 설정 탭 → 자료 꾸러미로 넣으세요.\n' +
        '        꾸러미는  npm run data:pack  으로 만듭니다.',
    );
  }

  if (variant === 'full') stageFull();
  else {
    clearStage();
    console.log('· 자료를 담지 않습니다 (_core)');
  }

  const argv = ['electron-builder', ...targets, '--publish', 'never'];

  /*
   * **윈도우에서는 `npx.cmd` 다** (2026-09-17 CI 에서 겪었다 — 맥은 멀쩡했다).
   *
   * `execFileSync` 는 셸을 거치지 않고 파일을 그대로 찾는다. 윈도우에 `npx` 라는
   * 이름의 파일은 없고 `npx.cmd` 만 있어서 `spawnSync npx ENOENT` 로 죽는다.
   * `shell: true` 로 넘기는 길도 있지만, 그러면 인자가 셸 해석을 한 번 더 거친다.
   */
  const runner = platform === 'win32' ? 'npx.cmd' : 'npx';
  console.log(`· ${variant} 설치 파일을 만듭니다 — ${runner} ${argv.join(' ')}\n`);

  execFileSync(runner, argv, {
    stdio: 'inherit',
    env: { ...process.env, SERMON_VARIANT: variant },
  });

  // 만든 뒤에는 비워 둔다 — 자료가 `build-data/` 에 남아 있으면 다음 `_core` 빌드가
  // 실수로 담을 수 있고, 저장소 폴더에 100MB 가 잠들어 있게 된다
  if (variant === 'full') clearStage();

  console.log(`\n✓ release/ 를 확인하세요 (이름에 _${variant} 가 붙습니다).`);
}

main();
