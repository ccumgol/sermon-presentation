/**
 * 태블릿 접속 암호의 판단 규칙 (보안 감사 권고 4).
 *
 * **이 테스트가 지키는 것은 안전만이 아니다.** 루프백 면제가 깨지면 OBS 브라우저
 * 소스가 401 을 받고 **예배 중 화면이 멈춘다.** OBS 는 암호를 입력할 수 없다.
 */
import { describe, expect, it } from 'vitest';

import {
  SESSION_COOKIE, isAuthExemptPath, isLoopbackAddress, isTrustedAddress, parseTrustedIps,
  readCookie, splitSessionValue, wantsHtml,
} from '../../lib/lan-auth.ts';

describe('isLoopbackAddress — 이 PC 는 암호를 묻지 않는다', () => {
  it('루프백을 알아본다', () => {
    for (const addr of ['127.0.0.1', '127.1.2.3', '::1', '::ffff:127.0.0.1', 'localhost']) {
      expect(isLoopbackAddress(addr), addr).toBe(true);
    }
  });

  it('LAN·외부 주소는 아니다', () => {
    for (const addr of ['192.168.1.50', '10.0.0.5', '203.0.113.9', '::', '', undefined, null]) {
      expect(isLoopbackAddress(addr), String(addr)).toBe(false);
    }
  });

  it('127 로 시작하는 다른 주소를 루프백으로 착각하지 않는다', () => {
    expect(isLoopbackAddress('127.0.0.1.evil.example')).toBe(false);
    expect(isLoopbackAddress('1270.0.0.1')).toBe(false);
  });
});

describe('SERMON_TRUSTED_IPS — 암호를 넣을 수 없는 기기', () => {
  it('목록을 읽는다', () => {
    expect(parseTrustedIps('192.168.1.50, 192.168.1.51')).toEqual(['192.168.1.50', '192.168.1.51']);
    expect(parseTrustedIps(undefined)).toEqual([]);
    expect(parseTrustedIps('  ')).toEqual([]);
  });

  it('목록에 있는 주소만 면제한다', () => {
    const trusted = ['192.168.1.50'];
    expect(isTrustedAddress('192.168.1.50', trusted)).toBe(true);
    expect(isTrustedAddress('::ffff:192.168.1.50', trusted)).toBe(true);
    expect(isTrustedAddress('192.168.1.51', trusted)).toBe(false);
    expect(isTrustedAddress('192.168.1.50', [])).toBe(false);
  });
});

describe('isAuthExemptPath — 막으면 암호를 넣을 방법이 없어지는 경로', () => {
  it('로그인 경로는 열려 있다', () => {
    for (const path of ['/login', '/login/', '/login?next=%2F', '/api/login', '/api/logout']) {
      expect(isAuthExemptPath(path), path).toBe(true);
    }
  });

  it('그 밖은 모두 막는다 — /api/info 도 (절대 경로를 알려 준다)', () => {
    for (const path of ['/', '/api/info', '/output/', '/api/songs', '/app/index.html', '/loginx']) {
      expect(isAuthExemptPath(path), path).toBe(false);
    }
  });
});

describe('readCookie', () => {
  it('여러 쿠키 중에서 골라낸다', () => {
    expect(readCookie(`a=1; ${SESSION_COOKIE}=abc.def; b=2`, SESSION_COOKIE)).toBe('abc.def');
    expect(readCookie(`${SESSION_COOKIE}=xyz`, SESSION_COOKIE)).toBe('xyz');
  });

  it('없거나 비어 있으면 undefined', () => {
    expect(readCookie(undefined, SESSION_COOKIE)).toBeUndefined();
    expect(readCookie('a=1', SESSION_COOKIE)).toBeUndefined();
    expect(readCookie(`${SESSION_COOKIE}=`, SESSION_COOKIE)).toBeUndefined();
  });

  it('이름이 접두사로만 겹치는 쿠키를 집지 않는다', () => {
    expect(readCookie(`${SESSION_COOKIE}_other=zzz`, SESSION_COOKIE)).toBeUndefined();
  });
});

describe('splitSessionValue', () => {
  it('만료시각과 서명을 나눈다', () => {
    expect(splitSessionValue('1700000000000.deadbeef')).toEqual({
      expiresAt: 1700000000000, signature: 'deadbeef', signedPart: '1700000000000',
    });
  });

  it('형식이 아니면 undefined', () => {
    for (const bad of [undefined, '', 'nodot', '.sig', '123.', 'abc.sig', '12.34.56'.replace('.', 'x')]) {
      expect(splitSessionValue(bad as string | undefined), String(bad)).toBeUndefined();
    }
  });
});

describe('wantsHtml — 사람은 로그인 화면으로, 기계는 401 로', () => {
  it('브라우저 페이지 요청', () => {
    expect(wantsHtml('text/html,application/xhtml+xml')).toBe(true);
  });

  it('API·WebSocket', () => {
    expect(wantsHtml('application/json')).toBe(false);
    expect(wantsHtml(undefined)).toBe(false);
  });
});
