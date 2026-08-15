/**
 * 출력 페이지가 **옛 판인지** 판정한다.
 *
 * 왜 필요한가 — 2026-08-15 에 실제로 겪은 문제다.
 * 서버를 재시작해도 OBS 안의 페이지는 **WebSocket 만 다시 붙고 JS 는 메모리에 있던
 * 옛 판 그대로**다. 권장 설정상 '장면 활성화 시 새로고침'도 꺼져 있어 저절로 갱신되지
 * 않는다. 그 상태에서 새로 만든 슬라이드 종류를 보내면, 출력 페이지는 모르는 내용을
 * 받았을 때 **화면을 비우지 않고 이전 내용을 유지**하도록 되어 있어(예배 중 검은 화면
 * 방지) 검은 화면이 아니라 **"아무 일도 안 일어남"** 으로 나타난다. 원인을 찾기 어렵다.
 *
 * 그래서 출력 페이지가 접속할 때 **자기가 로드된 시각**을 함께 보내고, 서버가 출력 파일의
 * 수정 시각과 비교해 컨트롤 패널에 알린다. 같은 PC 에서 도는 앱이라 시계가 같다.
 */

import { existsSync, statSync } from 'node:fs';
import path from 'node:path';

import { paths } from './paths.ts';

/** 출력 페이지를 이루는 파일들 — 이 중 하나라도 바뀌면 새로고침이 필요하다 */
const OUTPUT_FILES = ['index.html', 'output.js', 'output.css'] as const;

/**
 * 출력 페이지가 마지막으로 바뀐 시각(ms). 파일을 못 읽으면 0 —
 * **판정을 포기하는 쪽이 맞다.** 잘못된 경고로 예배 직전에 불안하게 만들지 않는다.
 */
export function outputBuildMs(): number {
  let latest = 0;
  for (const name of OUTPUT_FILES) {
    const full = path.join(paths.outputDir, name);
    if (!existsSync(full)) continue;
    try {
      latest = Math.max(latest, statSync(full).mtimeMs);
    } catch {
      // 한 파일을 못 읽어도 나머지로 판정한다
    }
  }
  return latest;
}

/**
 * 로드 시각이 파일 수정 시각보다 이르면 옛 판이다.
 *
 * 여유(2초)를 두는 이유: 페이지를 읽는 도중에 파일이 바뀌는 순간과, 파일 시스템
 * 시각의 정밀도 차이 때문이다. 여유가 없으면 방금 새로고침한 페이지에도 경고가 뜬다.
 */
export const STALE_GRACE_MS = 2000;

export function isOutputStale(loadedAt: unknown, buildMs: number): boolean {
  if (typeof loadedAt !== 'number' || !Number.isFinite(loadedAt)) return false; // 모르면 경고하지 않는다
  if (buildMs <= 0) return false;
  return loadedAt + STALE_GRACE_MS < buildMs;
}
