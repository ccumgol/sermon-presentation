/**
 * 성경 DB 가 없을 때의 안내.
 *
 * **할 수 있는 일을 말해야 한다.** 설치한 앱을 쓰는 사람에게 `npm run` 을 시키면
 * 터미널도 저장소도 없어 아무것도 못 한다 — 실제로 사용자가 파일을 제대로 넣고도
 * 이 문구 때문에 무엇을 더 해야 하는지 몰랐다 (2026-09-05).
 */

import { describe, expect, it } from 'vitest';

import { bibleMissingLine, bibleMissingMessage, isPackagedApp } from '../../lib/bible-missing.ts';

const PATH = '/Users/누구/Library/Application Support/sermon-presentation/data/bible.sqlite';

describe('어떻게 실행 중인가', () => {
  it('Electron 이 표시를 남겼으면 설치한 앱이다', () => {
    expect(isPackagedApp({ SERMON_PACKAGED: '1' })).toBe(true);
  });

  it('없거나 다른 값이면 저장소 실행으로 본다', () => {
    expect(isPackagedApp({})).toBe(false);
    expect(isPackagedApp({ SERMON_PACKAGED: '0' })).toBe(false);
    expect(isPackagedApp({ SERMON_PACKAGED: 'yes' })).toBe(false);
  });
});

describe('설치한 앱에게', () => {
  const message = bibleMissingMessage(PATH, true);

  /** 터미널이 없는 사람에게 명령을 시키지 않는다 */
  it('npm 명령을 시키지 않는다', () => {
    expect(message).not.toContain('npm');
    expect(bibleMissingLine(PATH, true)).not.toContain('npm');
  });

  it('무엇을 어디에 넣으라고 말한다', () => {
    expect(message).toContain('데이터 폴더 열기');
    expect(message).toContain('bible.sqlite');
  });

  /** 어디를 봤는지 알려 주지 않으면 엉뚱한 곳에 넣고 헤맨다 */
  it('찾은 자리를 함께 알려 준다', () => {
    expect(message).toContain(PATH);
    expect(bibleMissingLine(PATH, true)).toContain(PATH);
  });
});

describe('저장소에서 돌릴 때', () => {
  it('다시 만드는 명령을 알려 준다 — 여기서는 실제로 할 수 있다', () => {
    expect(bibleMissingMessage(PATH, false)).toContain('npm run bible:build');
    expect(bibleMissingLine(PATH, false)).toContain('npm run bible:build');
  });

  it('찾은 자리도 함께', () => {
    expect(bibleMissingMessage(PATH, false)).toContain(PATH);
  });
});
