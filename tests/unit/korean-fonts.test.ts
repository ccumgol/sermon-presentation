/**
 * 한국어 폰트 체인 — 두 곳에 적힌 값이 어긋나지 않게 못박는다.
 *
 * `public/output/output.js` 는 **의존성 0** 이 원칙이라 `lib/` 를 import 할 수 없다.
 * 그래서 같은 문자열이 두 곳에 있다. 한쪽만 고치면 '명조를 골랐는데 고딕이 나온다'
 * 같은 증상이 되고, 화면은 멀쩡해 보여 예배 중에야 드러난다.
 *
 * 이 테스트는 실제 파일을 읽어 글자 단위로 비교한다.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  FONT_KO_SANS,
  FONT_KO_SERIF,
  ITEM_FONT_CHAINS,
  RECOMMENDED_FONTS,
} from '../../lib/korean-fonts.ts';

const ROOT = path.resolve(import.meta.dirname, '../..');
const OUTPUT_JS = readFileSync(path.join(ROOT, 'public/output/output.js'), 'utf8');
const PRESETS_TS = readFileSync(path.join(ROOT, 'lib/template-presets.ts'), 'utf8');

/** `output.js` 의 `ITEM_FONTS` 에서 한 갈래의 문자열을 뽑는다 */
function itemFontFromOutputJs(kind: 'sans' | 'serif'): string {
  const block = /var ITEM_FONTS = \{([\s\S]*?)\};/.exec(OUTPUT_JS);
  expect(block, 'output.js 에서 ITEM_FONTS 를 찾지 못했습니다').not.toBeNull();

  // sans: '...' 또는 serif: '...' — 여러 줄로 이어 붙인 경우도 받는다
  const line = new RegExp(`${kind}:\\s*((?:'[^']*'\\s*\\+?\\s*)+),`).exec(block![1]!);
  expect(line, `output.js 의 ITEM_FONTS 에 ${kind} 가 없습니다`).not.toBeNull();

  return line![1]!
    .split('+')
    .map((part) => part.trim().replace(/^'|'$/g, ''))
    .join('');
}

describe('두 곳의 값이 같다', () => {
  it('고딕 체인이 output.js 와 일치한다', () => {
    expect(itemFontFromOutputJs('sans')).toBe(FONT_KO_SANS);
  });

  it('명조 체인이 output.js 와 일치한다', () => {
    expect(itemFontFromOutputJs('serif')).toBe(FONT_KO_SERIF);
  });

  it('프리셋도 같은 상수를 쓴다 (문자열을 다시 적지 않는다)', () => {
    // 프리셋 파일이 체인을 직접 적어 두면 또 어긋난다 — import 해서 쓰게 못박는다
    expect(PRESETS_TS).toContain("from './korean-fonts.ts'");
    expect(PRESETS_TS).not.toContain('"Noto Serif CJK KR"');
  });
});

describe('고딕과 명조가 섞이지 않는다', () => {
  /** 이름에 고딕/Sans 가 들어간 것 — 명조 체인에 있으면 안 된다 */
  const GOTHIC_NAMES = ['Gothic', 'Sans', 'Pretendard', 'Malgun'];

  it('명조 체인에 고딕 이름이 없다', () => {
    // 이것이 실제 버그였다: 명조 2순위가 Apple SD Gothic Neo 라
    // 나눔명조가 없는 PC 에서 '명조' 를 골라도 고딕이 나왔다
    for (const name of GOTHIC_NAMES) {
      expect(FONT_KO_SERIF, `명조 체인에 '${name}' 이 있습니다`).not.toContain(name);
    }
  });

  it('고딕 체인에 명조 이름이 없다', () => {
    for (const name of ['Serif', 'Myeongjo', 'Myungjo', 'Batang']) {
      expect(FONT_KO_SANS, `고딕 체인에 '${name}' 이 있습니다`).not.toContain(name);
    }
  });

  it('두 체인은 서로 다른 총칭으로 끝난다', () => {
    expect(FONT_KO_SANS.endsWith('sans-serif')).toBe(true);
    expect(FONT_KO_SERIF.endsWith('serif')).toBe(true);
    expect(FONT_KO_SERIF.endsWith('sans-serif')).toBe(false);
  });
});

describe('Noto 가 대표 폰트다', () => {
  it('두 체인 모두 Noto 로 시작한다', () => {
    expect(FONT_KO_SANS.startsWith('"Noto Sans KR"')).toBe(true);
    expect(FONT_KO_SERIF.startsWith('"Noto Serif KR"')).toBe(true);
  });

  it('설치 안내가 그 두 개만 권한다 — 받을 것이 많아 보이면 아무것도 안 받는다', () => {
    expect(RECOMMENDED_FONTS.map((f) => f.family)).toEqual(['Noto Sans KR', 'Noto Serif KR']);
  });

  it('권하는 폰트가 실제로 그 갈래 체인의 맨 앞이다', () => {
    for (const font of RECOMMENDED_FONTS) {
      expect(ITEM_FONT_CHAINS[font.kind].startsWith(`"${font.family}"`)).toBe(true);
    }
  });
});

describe('총칭까지 내려가지 않게 사다리를 둔다', () => {
  it('두 체인 모두 이름이 넉넉하다 — 하나 없다고 총칭으로 떨어지지 않게', () => {
    const count = (css: string): number => (css.match(/"/g)?.length ?? 0) / 2;
    expect(count(FONT_KO_SANS)).toBeGreaterThanOrEqual(3);
    expect(count(FONT_KO_SERIF)).toBeGreaterThanOrEqual(5);
  });
});
