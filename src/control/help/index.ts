/**
 * 사용설명서의 차례 — **읽는 순서대로** 모은다.
 *
 * 시작하기 → 탭별 사용법 → 자료 넣기 → 문제가 생겼을 때.
 * 처음 쓰는 사람은 위에서 아래로, 막힌 사람은 검색으로 들어온다.
 */

import { CHAPTER_START } from './start.ts';
import { CHAPTER_TABS } from './tabs.ts';
import { CHAPTER_DATA } from './data.ts';
import { CHAPTER_TROUBLE } from './trouble.ts';
import type { HelpChapter, HelpSection } from './types.ts';

export const HELP_CHAPTERS: readonly HelpChapter[] = [
  CHAPTER_START,
  CHAPTER_TABS,
  CHAPTER_DATA,
  CHAPTER_TROUBLE,
];

export const HELP_SECTIONS: readonly HelpSection[] = HELP_CHAPTERS.flatMap((c) => c.sections);

export * from './types.ts';
export * from './inline.ts';
