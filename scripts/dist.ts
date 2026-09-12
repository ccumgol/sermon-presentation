/**
 * 설치 파일을 만든다 — **판 표기를 파일 이름에 넣으려고** 한 겹 감쌌다.
 *
 * ## 왜 npm 스크립트에서 바로 못 하나
 *
 * 파일 이름에 `1.04` 를 넣으려면 electron-builder 에 `DISPLAY_VERSION` 을 넘겨야 한다
 * (`electron-builder.yml` 의 `artifactName` 이 `${env.DISPLAY_VERSION}` 을 읽는다).
 *
 * 그런데 `DISPLAY_VERSION=$(node ...) electron-builder` 는 **POSIX 셸 문법**이다.
 * 윈도우 CI 는 `cmd` 로 npm 스크립트를 돌려서 그대로 깨진다. 그래서 노드로 감쌌다 —
 * 맥·윈도우가 같은 길을 쓴다.
 *
 * ## 출처는 package.json 하나다
 *
 * 표기(`1.04`)는 `version`(`1.4.0`)에서 **계산해서** 쓴다. 어딘가에 따로 적어 두면
 * 판을 올릴 때 한쪽만 고쳐 어긋난다.
 *
 * ```bash
 * node scripts/dist.ts --mac      # 맥만
 * node scripts/dist.ts --win      # 윈도우만
 * node scripts/dist.ts            # 이 PC 가 만들 수 있는 것
 * ```
 */

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { versionLabel } from '../lib/version-label.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as { version: string };
const label = versionLabel(pkg.version);

/*
 * **절대로 배포하지 않는다** (`--publish never`). 없으면 CI 에서 electron-builder 가
 * GitHub Releases 에 올리려 하고 토큰이 없어 마지막에 죽는다 — DMG·EXE 는 이미
 * 다 만들어진 뒤라 더 헷갈린다 (2026-09-10 에 겪었다).
 */
const args = [...process.argv.slice(2), '--publish', 'never'];

console.log(`판 ${pkg.version} → 파일 이름 표기 ${label}`);

const bin = path.join(root, 'node_modules', '.bin', 'electron-builder');
const result = spawnSync(bin, args, {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, DISPLAY_VERSION: label },
  // 윈도우의 `.bin` 항목은 `.cmd` 라 셸을 거쳐야 실행된다
  shell: process.platform === 'win32',
});

process.exit(result.status ?? 1);
