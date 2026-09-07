/**
 * 이 앱이 **어느 판인가** (점검 P-7, 2026-09-07).
 *
 * ## 왜 필요한가
 *
 * 설치 파일을 받은 사람은 **자기 판이 옛것인지 알 방법이 없었다.** 갱신 장치
 * (autoUpdater)가 없으므로 고칠 것이 생기면 DMG·EXE 를 다시 나눠 줘야 하는데,
 * 받은 사람도 준 사람도 "그거 새 판으로 깔았나?" 를 확인할 수가 없었다.
 * 실제로 2026-09-07 에 사용자가 09-05 빌드를 쓰고 있었고, 그것을 프로세스를
 * 뒤져 보고서야 알았다.
 *
 * ## 판 번호만으로는 부족하다
 *
 * `package.json` 의 `0.1.0` 은 **빌드마다 바뀌지 않는다.** 그래서 함께
 * **프로그램 파일이 만들어진 시각**을 낸다 — 이것이 실제로 두 빌드를 가른다.
 *
 * 따로 빌드 단계를 두지 않는다(스탬프 파일·환경 변수). 지금 돌고 있는 이 파일의
 * 수정 시각을 그대로 쓴다:
 *
 * | 어떻게 실행하나 | `builtAt` 이 뜻하는 것 |
 * |---|---|
 * | 소스 (`node server/index.ts`) | 이 `.ts` 파일을 마지막으로 고친 시각 |
 * | 설치판 (`dist-server/…/version.js`) | **포장할 때 `tsc` 가 뽑은 시각** = 빌드 시각 |
 *
 * 읽지 못해도 서버는 떠야 한다 — 판 번호 표시가 예배를 막을 이유가 없다.
 */

import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { paths } from './paths.ts';

export interface AppVersion {
  /** `package.json` 의 판 번호. 읽지 못하면 `'?'` */
  version: string;
  /** 프로그램 파일이 만들어진 시각(ISO). 읽지 못하면 `undefined` */
  builtAt?: string;
}

function readVersion(): string {
  try {
    const raw = readFileSync(path.join(paths.appRoot, 'package.json'), 'utf8');
    const parsed = JSON.parse(raw) as { version?: unknown };
    return typeof parsed.version === 'string' ? parsed.version : '?';
  } catch {
    return '?';
  }
}

function readBuiltAt(): string | undefined {
  try {
    return statSync(fileURLToPath(import.meta.url)).mtime.toISOString();
  } catch {
    return undefined;
  }
}

/** 한 번만 읽는다 — 도는 중에 바뀔 값이 아니다 */
const cached: AppVersion = (() => {
  const builtAt = readBuiltAt();
  return { version: readVersion(), ...(builtAt ? { builtAt } : {}) };
})();

export function appVersion(): AppVersion {
  return cached;
}
