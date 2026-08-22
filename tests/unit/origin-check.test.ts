import { describe, expect, it } from 'vitest';

import { isAllowedOrigin, parseAllowedOrigins } from '../../lib/origin-check.ts';

const HOST = 'localhost:7777';

describe('isAllowedOrigin — 허용해야 하는 것', () => {
  it('Origin 이 없으면 허용한다 (비브라우저·도구)', () => {
    // 막아도 얻는 것이 없다 — 비브라우저 클라이언트는 Origin 을 마음대로 정한다.
    // 대신 OBS·테스트가 끊기지 않는다.
    expect(isAllowedOrigin(undefined, HOST)).toBe(true);
    expect(isAllowedOrigin('', HOST)).toBe(true);
    expect(isAllowedOrigin(null, HOST)).toBe(true);
  });

  it('우리 서버가 내보낸 페이지를 허용한다 (컨트롤 패널·OBS 브라우저 소스)', () => {
    expect(isAllowedOrigin('http://localhost:7777', HOST)).toBe(true);
  });

  it('태블릿이 LAN 주소로 열어도 허용한다', () => {
    // 태블릿은 http://192.168.1.190:7777 로 접속하므로 Host 도 그 값이다
    expect(isAllowedOrigin('http://192.168.1.190:7777', '192.168.1.190:7777')).toBe(true);
  });

  it('포트가 바뀌어도 Host 와 같으면 허용한다 (7777 이 점유돼 옮겨간 경우)', () => {
    expect(isAllowedOrigin('http://localhost:7801', 'localhost:7801')).toBe(true);
  });

  it('허용 목록에 넣은 Origin 을 받는다 (리버스 프록시 등)', () => {
    expect(isAllowedOrigin('https://church.example', HOST, ['https://church.example'])).toBe(true);
  });
});

describe('isAllowedOrigin — 막아야 하는 것', () => {
  it('외부 웹페이지를 막는다', () => {
    // 예배 중 오퍼레이터가 연 사이트가 송출 화면을 바꾸는 경로
    expect(isAllowedOrigin('https://evil.example', HOST)).toBe(false);
  });

  it('같은 이름이라도 포트가 다르면 막는다', () => {
    expect(isAllowedOrigin('http://localhost:3000', HOST)).toBe(false);
  });

  it('localhost 와 127.0.0.1 은 서로 다른 출처다', () => {
    // 브라우저도 이 둘을 다른 출처로 본다 — 같게 취급하면 검사가 헐거워진다
    expect(isAllowedOrigin('http://127.0.0.1:7777', HOST)).toBe(false);
  });

  it("샌드박스 iframe·file:// 의 'null' 을 막는다", () => {
    expect(isAllowedOrigin('null', HOST)).toBe(false);
  });

  it('해석할 수 없는 값을 막는다', () => {
    expect(isAllowedOrigin('not-a-url', HOST)).toBe(false);
    expect(isAllowedOrigin('http://', HOST)).toBe(false);
  });

  it('Host 를 모르면 (Origin 이 있는 접속은) 막는다', () => {
    expect(isAllowedOrigin('http://localhost:7777', undefined)).toBe(false);
  });

  it('접두사가 같다고 통과시키지 않는다', () => {
    // 'localhost:7777.evil.example' 같은 이름으로 우회하지 못해야 한다
    expect(isAllowedOrigin('http://localhost:7777.evil.example', HOST)).toBe(false);
  });
});

describe('parseAllowedOrigins', () => {
  it('쉼표로 나누고 공백을 지운다', () => {
    expect(parseAllowedOrigins(' https://a.example , https://b.example ')).toEqual([
      'https://a.example',
      'https://b.example',
    ]);
  });

  it('비어 있으면 빈 배열', () => {
    expect(parseAllowedOrigins(undefined)).toEqual([]);
    expect(parseAllowedOrigins('')).toEqual([]);
    expect(parseAllowedOrigins(' , ')).toEqual([]);
  });
});

/**
 * R-1 (검토 2026-08-22) — Origin 을 Host 와 비교하는 것만으로는 부족하다.
 *
 * **Host 도 접속하는 쪽이 정하는 값**이라, 둘을 서로 맞춰 보내면 통과했다.
 * 실제 공격은 DNS 리바인딩 — 공격자가 `evil.test` 를 7777 포트로 서비스하다가
 * DNS 를 127.0.0.1 로 바꾸면, 오퍼레이터가 그 주소를 한 번 여는 것으로 끝난다.
 *
 * 그래서 Host 가 **우리가 실제로 서비스할 수 있는 주소**인지도 본다.
 */
describe('Host 위조 (DNS 리바인딩)', () => {
  it('Origin 과 Host 를 맞춰 보낸 외부 도메인을 막는다', () => {
    expect(isAllowedOrigin('http://evil.test:7777', 'evil.test:7777')).toBe(false);
    expect(isAllowedOrigin('https://church.example:7777', 'church.example:7777')).toBe(false);
  });

  it('공인 IP 도 막는다', () => {
    expect(isAllowedOrigin('http://203.0.113.5:7777', '203.0.113.5:7777')).toBe(false);
  });

  it('허용 목록에 넣으면 통과한다 (리버스 프록시)', () => {
    expect(
      isAllowedOrigin('https://church.example:7777', 'church.example:7777', [
        'https://church.example:7777',
      ]),
    ).toBe(true);
  });
});

describe('태블릿 접속 경로는 끊기지 않는다', () => {
  it('사설 IPv4 로 붙는 태블릿을 허용한다', () => {
    for (const host of ['192.168.1.190:7777', '10.0.0.5:7777', '172.20.1.9:7777']) {
      expect(isAllowedOrigin(`http://${host}`, host)).toBe(true);
    }
  });

  it('사설 범위가 아닌 172.32.x 는 막는다', () => {
    expect(isAllowedOrigin('http://172.32.0.1:7777', '172.32.0.1:7777')).toBe(false);
  });

  it('mDNS 이름(.local)을 허용한다 — 맥이 이 이름으로도 열린다', () => {
    expect(isAllowedOrigin('http://macbook.local:7777', 'macbook.local:7777')).toBe(true);
  });

  it('.local 을 흉내낸 외부 도메인은 막는다', () => {
    expect(isAllowedOrigin('http://evil.local.example:7777', 'evil.local.example:7777')).toBe(false);
  });

  it('IPv6 루프백을 허용한다', () => {
    expect(isAllowedOrigin('http://[::1]:7777', '[::1]:7777')).toBe(true);
  });
});
