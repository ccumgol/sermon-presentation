/**
 * 새 창을 우리 것으로 열지, 바깥 브라우저로 넘길지 (점검 S-6).
 *
 * `electron/main.cjs` 는 Electron 안에서만 돌아 import 할 수 없다. 그래서
 * **파일을 읽어** 규칙이 깨지지 않았는지 본다 (`projector-page.test.ts` 와 같은 방법).
 *
 * ## 무엇이 문제였나
 *
 * 전에는 `target.startsWith('http://localhost:7777')` 였다. 그러면
 * `http://localhost:77777.evil.example` 이 그 접두사를 만족해 **우리 창으로 열린다.**
 * 지금은 우리 페이지만 창을 열어 도달 경로가 없지만, URL 접두사 비교는 검토
 * R-1(Origin/Host 위조)에서 이미 한 번 물린 방식이다.
 *
 * 아래 `sameOrigin` 은 `main.cjs` 가 쓰는 것과 **같은 판정**을 옮겨 적은 것이다 —
 * 판정 자체가 옳은지는 여기서 검사하고, 그 판정을 쓰고 있는지는 파일을 읽어 본다.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const MAIN_CJS = readFileSync(
  path.join(import.meta.dirname, '../../electron/main.cjs'),
  'utf8',
);

/**
 * 주석을 뗀 **코드만** — 주석에는 '전에는 이랬다' 는 설명이 들어 있어서,
 * 글자만 찾으면 고쳐 놓고도 걸린다 (실제로 그렇게 한 번 틀렸다).
 */
const CODE = MAIN_CJS.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

/** `main.cjs` 의 판정과 같은 것 */
function sameOrigin(target: string, ourUrl: string): boolean {
  try {
    return new URL(target).origin === new URL(ourUrl).origin;
  } catch {
    return false;
  }
}

const OURS = 'http://localhost:7777/';

describe('출처 비교가 접두사 비교보다 옳다', () => {
  it('우리 페이지는 우리 창으로 연다', () => {
    for (const target of [
      'http://localhost:7777/projector/',
      'http://localhost:7777/stage/',
      'http://localhost:7777/output/?layer=main',
    ]) {
      expect(sameOrigin(target, OURS), target).toBe(true);
    }
  });

  it('★ 접두사만 같은 남의 주소는 막는다 (전에는 통했다)', () => {
    expect(sameOrigin('http://localhost:77777.evil.example/', OURS)).toBe(false);
    expect('http://localhost:77777.evil.example/'.startsWith('http://localhost:7777')).toBe(true);
  });

  it('포트·스킴·호스트가 다르면 남의 것이다', () => {
    for (const target of [
      'http://localhost:7778/',
      'https://localhost:7777/',
      'http://127.0.0.1:7777/',
      'http://evil.example/',
    ]) {
      expect(sameOrigin(target, OURS), target).toBe(false);
    }
  });

  it('해석할 수 없는 주소는 우리 것이 아니다', () => {
    for (const target of ['not-a-url', '', 'javascript:alert(1)']) {
      expect(sameOrigin(target, OURS), target).toBe(false);
    }
  });
});

describe('main.cjs 가 실제로 그 판정을 쓴다', () => {
  it('접두사 비교(startsWith)가 남아 있지 않다', () => {
    expect(CODE).not.toContain('target.startsWith(');
  });

  it('출처를 견준다', () => {
    expect(CODE).toContain('new URL(target).origin === ourOrigin');
  });

  it('바깥으로 넘기는 것은 http(s) 뿐이다 — openExternal 은 file: 도 연다', () => {
    expect(CODE).toMatch(/https\?:\$.*safeProtocol\(target\)/s);
    // 판정을 거치지 않고 곧바로 여는 자리가 없어야 한다
    const calls = CODE.match(/shell\.openExternal\(/g) ?? [];
    expect(calls).toHaveLength(1);
  });

  it('독 아이콘으로는 창만 다시 만든다 — 서버를 두 번 띄우지 않는다', () => {
    const activate = CODE.slice(
      CODE.indexOf("app.on('activate'"),
      CODE.indexOf("app.on('window-all-closed'"),
    );
    expect(activate).toContain('createWindow(serverUrl)');
    expect(activate).not.toContain('start()');
  });
});
