/**
 * 항목별 표시 옵션 — 참조 표기·소제목·절 번호를 항목에서 켜고 끈다.
 *
 * ## 나누는 기준
 *
 * **모양은 템플릿, 표시 여부는 항목.** 크기·색·테두리는 매주 같지만 '이 본문에는
 * 소제목을 띄우자' 는 그 주에 정하는 일이다. 전에는 둘이 템플릿에 함께 있어,
 * 소제목을 한 번 끄려면 템플릿을 고치거나 사본을 만들어야 했다.
 *
 * ## 세 갈래 값
 *
 * 항목 값은 `undefined`(템플릿 따름) · `true` · `false` 세 갈래다. `false` 기본값으로
 * 두면 **이미 저장된 순서표가 모두 '끔' 이 되어** 다음 예배에 소제목·절 번호가
 * 사라진다. 지정하지 않은 것은 지금까지와 똑같이 동작해야 한다.
 */

import { describe, expect, it } from 'vitest';

import { resolveDisplay } from '../../lib/item-display.ts';
import type { TemplateBehavior } from '../../shared/types.ts';

/** 템플릿 기본값 — 성경 프리셋이 쓰는 조합 */
const BIBLE: Pick<TemplateBehavior, 'showVerseNumbers' | 'showHeadings' | 'showReference'> = {
  showVerseNumbers: true,
  showHeadings: false,
  showReference: 'top',
};

/** 찬양 프리셋 — 셋 다 끔 */
const SONG: Pick<TemplateBehavior, 'showVerseNumbers' | 'showHeadings' | 'showReference'> = {
  showVerseNumbers: false,
  showHeadings: false,
  showReference: 'none',
};

describe('지정하지 않으면 템플릿을 따른다', () => {
  it('항목 값이 없으면 템플릿 그대로', () => {
    expect(resolveDisplay(BIBLE, undefined)).toEqual({
      verseNumbers: true,
      headings: false,
      reference: 'top',
      overridden: false,
    });
  });

  it('빈 객체도 템플릿 그대로 — 저장된 순서표가 조용히 바뀌지 않게', () => {
    expect(resolveDisplay(BIBLE, {})).toEqual({
      verseNumbers: true,
      headings: false,
      reference: 'top',
      overridden: false,
    });
  });

  it('찬양 프리셋도 그대로', () => {
    expect(resolveDisplay(SONG, undefined)).toEqual({
      verseNumbers: false,
      headings: false,
      reference: 'none',
      overridden: false,
    });
  });

  it('템플릿 값이 아예 없으면 안전한 쪽으로 — 절 번호는 켜고 나머지는 끈다', () => {
    // showVerseNumbers 는 '없으면 켬' 이 기존 동작이다 (renderBible 의 !== false)
    expect(resolveDisplay({}, undefined)).toEqual({
      verseNumbers: true,
      headings: false,
      reference: 'none',
      overridden: false,
    });
  });
});

describe('항목이 지정하면 항목이 이긴다', () => {
  it('소제목을 켠다', () => {
    expect(resolveDisplay(BIBLE, { headings: true }).headings).toBe(true);
  });

  it('절 번호를 끈다', () => {
    expect(resolveDisplay(BIBLE, { verseNumbers: false }).verseNumbers).toBe(false);
  });

  it('한 가지만 지정해도 나머지는 템플릿을 따른다', () => {
    const result = resolveDisplay(BIBLE, { headings: true });
    expect(result.verseNumbers).toBe(true);
    expect(result.reference).toBe('top');
  });
});

describe('참조 표기는 위치까지 정해야 한다', () => {
  it('끄면 표시하지 않는다', () => {
    expect(resolveDisplay(BIBLE, { reference: false }).reference).toBe('none');
  });

  it('켜면 템플릿이 정한 자리에 놓는다', () => {
    expect(resolveDisplay({ ...BIBLE, showReference: 'bottom' }, { reference: true }).reference).toBe(
      'bottom',
    );
  });

  it('템플릿이 표시 안 함이면 아래에 놓는다 — 켰는데 안 보이면 고장으로 읽힌다', () => {
    expect(resolveDisplay(SONG, { reference: true }).reference).toBe('bottom');
  });
});

describe('항목이 템플릿과 다른지 알려 준다', () => {
  it('같으면 다르지 않다고 한다 — 화면에 군더더기 표시를 하지 않게', () => {
    expect(resolveDisplay(BIBLE, { verseNumbers: true }).overridden).toBe(false);
  });

  it('다르면 다르다고 한다', () => {
    expect(resolveDisplay(BIBLE, { headings: true }).overridden).toBe(true);
  });

  it('지정이 없으면 다르지 않다', () => {
    expect(resolveDisplay(BIBLE, undefined).overridden).toBe(false);
  });
});

describe('찬양 절 번호는 템플릿을 보지 않는다', () => {
  /*
   * 찬양은 원래부터 템플릿의 showVerseNumbers 를 보지 않고 늘 절 번호를 붙였다.
   * 이제 와서 보게 하면 '찬양 — 전체' 프리셋(false)에서 절 번호가 조용히 사라진다 —
   * 사용자가 요청하지 않은 변화다. 실측으로 확인해 되돌렸다(2026-08-19).
   *
   * `resolveDisplay` 는 성경용이고, 찬양 렌더러는 항목 값만 본다. 이 테스트는 그
   * 규칙이 출력 페이지에 남아 있는지 확인한다.
   */
  it('output.js 의 찬양 렌더러가 항목 값만 본다', async () => {
    const { readFileSync } = await import('node:fs');
    const path = await import('node:path');
    const src = readFileSync(
      path.join(import.meta.dirname, '../../public/output/output.js'),
      'utf8',
    );
    const renderSong = src.slice(src.indexOf('function renderSong'), src.indexOf('function renderOrder'));

    // 항목 값만 본다
    expect(renderSong).toContain('songDisplay.verseNumbers !== false');
    // 템플릿 값을 보면 '전체' 프리셋에서 절 번호가 사라진다
    expect(renderSong).not.toContain('behavior.showVerseNumbers');
  });
});
