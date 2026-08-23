/**
 * 태블릿에게 알려 줄 주소를 고르는 규칙.
 *
 * 실제로 Tailscale 의 `utun8`(100.101.71.64)이 태블릿 주소 목록에 섞여 나왔다.
 * **찍어도 열리지 않는 QR** 이 하나 더 생기면 예배 직전에 헤매게 된다.
 */
import { describe, expect, it } from 'vitest';

import { isLanCandidate } from '../../server/lan.ts';

describe('공유기가 나눠 준 주소는 쓴다', () => {
  it('사설 대역 (RFC1918)', () => {
    expect(isLanCandidate('en0', '192.168.1.190')).toBe(true);
    expect(isLanCandidate('en7', '192.168.1.151')).toBe(true);
    expect(isLanCandidate('en1', '10.0.0.5')).toBe(true);
    expect(isLanCandidate('en1', '172.20.1.9')).toBe(true);
  });

  it('인터넷 공유(bridge)도 쓴다 — 태블릿을 맥에 직접 붙이는 정당한 방법', () => {
    expect(isLanCandidate('bridge0', '192.168.2.1')).toBe(true);
  });
});

describe('열리지 않는 주소는 뺀다', () => {
  it('VPN 터널 장치', () => {
    for (const iface of ['utun8', 'tun0', 'tap0', 'ppp0', 'ipsec0']) {
      expect(isLanCandidate(iface, '10.0.0.5'), iface).toBe(false);
    }
  });

  it('Tailscale 의 CGNAT 대역 (100.64/10)', () => {
    expect(isLanCandidate('en0', '100.101.71.64')).toBe(false);
  });

  it('공인 주소', () => {
    expect(isLanCandidate('en0', '203.0.113.9')).toBe(false);
  });

  it('AirDrop·링크 로컬 장치', () => {
    expect(isLanCandidate('awdl0', '169.254.1.2')).toBe(false);
    expect(isLanCandidate('llw0', '169.254.1.3')).toBe(false);
  });

  it('사설 대역이 아닌 링크 로컬', () => {
    expect(isLanCandidate('en0', '169.254.5.5')).toBe(false);
  });

  it('주소 모양이 아니면 뺀다', () => {
    for (const bad of ['192.168.1', '192.168.1.999', 'abc', '']) {
      expect(isLanCandidate('en0', bad), bad).toBe(false);
    }
  });

  it('사설 대역과 헷갈리는 172.32.x 는 뺀다', () => {
    expect(isLanCandidate('en0', '172.32.0.1')).toBe(false);
    expect(isLanCandidate('en0', '172.15.0.1')).toBe(false);
  });
});
