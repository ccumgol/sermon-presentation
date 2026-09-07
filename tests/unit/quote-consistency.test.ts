/**
 * 네 화면이 인용구를 **같은 글**로 보여야 한다.
 *
 * 관리자 목록·OBS·강사 모니터·프로젝터는 서로 다른 렌더러를 쓴다. 참조·절 번호 규칙이
 * 제각각이라 같은 절이 네 가지로 나왔다 (사용자 지적 2026-08-20).
 *
 * ```
 * 관리자     고전 1:3 하나님 우리 아버지와…
 * OBS        고전 1:3 ⏎ 3 하나님 우리 아버지와…
 * 강사 모니터  3 하나님 우리 아버지와… ⏎ 고전 1:3
 * 프로젝터    하나님 우리 아버지와…
 * ```
 *
 * 해결은 **참조를 본문 글자에 넣는 것**이다(`quoteSlides`). 그러면 네 화면이 그것을
 * '본문' 으로 받아 저절로 같아진다. 다만 두 가지가 남는다 —
 *
 * 1. 절 번호를 렌더러가 **제 마음대로 붙이면** 안 된다 (`3 고전 1:3 하나님…`)
 * 2. 참조 줄을 렌더러가 **또 그리면** 안 된다 (같은 것이 두 번)
 *
 * 강사 모니터와 출력 페이지는 의존성 0 이라 import 할 수 없다. 그래서 이 테스트가
 * **파일을 읽어** 두 규칙을 두 곳에 묶어 둔다.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { describeItem } from '../../lib/plan-deck.ts';
import { quoteSlides } from '../../lib/verse-quotes.ts';
import type { CueItem, SlidePayload } from '../../shared/types.ts';

const ROOT = path.join(import.meta.dirname, '../..');
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');

const REF = '고전 1:3';
const TEXT = '하나님 우리 아버지와 주 예수 그리스도로부터';

const ITEM: CueItem = {
  id: 'q1',
  type: 'bible',
  ref: REF,
  primary: 'nkrv',
  secondary: [],
  quote: true,
  preview: TEXT,
};

const SLIDE: SlidePayload = {
  kind: 'bible',
  reference: '고린도전서 1:3',
  blocks: [
    {
      translationId: 'nkrv',
      translationName: '개역개정',
      lang: 'ko',
      direction: 'ltr',
      verses: [{ book: 46, chapter: 1, verse: 3, text: TEXT }],
    },
  ],
};

describe('네 화면이 같은 글을 보인다', () => {
  const [out] = quoteSlides([SLIDE], ITEM.type === 'bible' ? ITEM.ref : '');
  if (out?.kind !== 'bible') throw new Error('bible 이어야 한다');
  const body = out.blocks[0]?.verses[0]?.text;

  it('관리자 목록과 화면의 글자가 같은 접두사로 시작한다', () => {
    expect(describeItem(ITEM).startsWith(`${REF} `)).toBe(true);
    expect(body?.startsWith(`${REF} `)).toBe(true);
  });

  it('본문에 참조가 한 번만 들어간다', () => {
    expect((body ?? '').split(REF).length - 1).toBe(1);
    expect(out.reference, '별도 참조 줄이 남아 있으면 두 번 나간다').toBe('');
  });

  it('절 번호가 꺼져 있다 — 참조에 이미 절이 있다', () => {
    expect(out.display?.verseNumbers).toBe(false);
  });
});

describe('렌더러가 규칙을 지킨다 (파일을 읽어 고정)', () => {
  const STAGE = read('public/stage/stage.js');
  const OUTPUT = read('public/output/output.js');

  it('강사 모니터가 절 번호 설정을 따른다', () => {
    expect(STAGE, "예전에는 verse.verse 를 늘 붙였다 — 그래서 '3 고전 1:3 …' 이 됐다").toContain(
      'slide.display.verseNumbers === false',
    );
  });

  it('강사 모니터는 참조가 비어 있으면 그 줄을 그리지 않는다', () => {
    expect(STAGE).toContain('if (slide.reference)');
  });

  it('출력 페이지가 절 번호 설정을 따른다', () => {
    expect(OUTPUT).toContain('d.verseNumbers !== undefined ? d.verseNumbers');
  });

  it('출력 페이지는 참조가 꺼지면 그 줄을 비운다', () => {
    expect(OUTPUT).toContain("show.reference === 'none' ? null : payload.reference");
  });
});

describe('본문 낭독(📖 성경)은 바뀌지 않는다', () => {
  const passage: CueItem = { id: 'b1', type: 'bible', ref: '고전 1:1-9', primary: 'nkrv', secondary: [] };

  it('목록 줄은 참조 그대로다', () => {
    expect(describeItem(passage)).toBe('고전 1:1-9');
  });

  it('quote 표시가 없으면 슬라이드를 손대지 않는다 — 부르는 쪽이 이 함수를 건너뛴다', () => {
    // resolveItem 이 item.quote 일 때만 quoteSlides 를 부른다. 그 조건을 파일로 고정한다.
    // 2026-09-07: resolveItem 이 PlanPanel 에서 usePlanPreview 로 나갔다 —
    // 이제 훅을 직접 부를 수 있으니 이 글자 검사는 동작 검사로 갈아탈 자리다
    // (tests/unit/plan-preview.test.tsx 가 그 일을 한다).
    const hook = read('src/control/hooks/usePlanPreview.ts');
    expect(hook).toContain('item.quote ? quoteSlides(');
  });
});
