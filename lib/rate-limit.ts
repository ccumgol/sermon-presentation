/**
 * 요청 수 제한 — 순수 로직 (보안 감사 L-2 · M-2).
 *
 * ## 무엇을 막는가
 *
 * 로그인에는 시도 제한이 있었지만(권고 4) **나머지 라우트에는 아무것도 없었다.**
 * LAN 을 열어 두면 같은 WiFi 의 기기가 `/api/backup/export`(곡 전체) 나
 * 256MB 한도의 `/api/backup/import` 를 쉼 없이 부를 수 있다 — 암호가 있어야
 * 하지만, 한 번 들어온 기기나 잘못 만든 스크립트 하나로도 **예배 중에 서버가
 * 느려진다.** 그것이 이 프로젝트가 막으려는 결과다.
 *
 * ## 이 PC 는 세지 않는다
 *
 * 부르는 쪽이 루프백을 걸러 준다. OBS·컨트롤 패널·프로젝터·강사 모니터가 모두
 * 이 PC 이고, 그들의 요청을 세는 것은 **예배를 막을 위험만 있고 얻는 것이 없다**
 * (`lib/lan-auth.ts` 의 면제와 같은 판단이다).
 *
 * ## 왜 고정 창인가
 *
 * 슬라이딩 창·토큰 버킷이 더 매끄럽지만, 여기 필요한 것은 '폭주를 멈추는 것'
 * 하나다. 고정 창은 상태가 숫자 둘이라 읽기 쉽고, 창이 바뀌는 순간 두 배까지
 * 통과하는 약점도 이 목적에는 상관이 없다.
 */

export interface RateLimitVerdict {
  ok: boolean;
  /** 막혔을 때 몇 초 뒤에 다시 오라고 할지 */
  retryAfterSec: number;
}

export interface RateLimiter {
  hit(key: string, now?: number): RateLimitVerdict;
  /** 지켜보는 주소 수 — 표가 자라지 않는 것을 확인하는 데 쓴다 */
  size(): number;
}

export interface RateLimitOptions {
  /** 창 하나에서 허용할 요청 수 */
  limit: number;
  windowMs: number;
  /**
   * 지켜볼 주소 수 상한.
   *
   * 상한이 없으면 주소를 바꿔 가며 두드리는 것만으로 표가 자란다
   * (`server/auth.ts` 의 시도 기록에서 겪은 것과 같다).
   */
  maxKeys?: number;
}

export function createRateLimiter(options: RateLimitOptions): RateLimiter {
  const maxKeys = options.maxKeys ?? 4096;
  const windows = new Map<string, { count: number; startedAt: number }>();

  function prune(now: number): void {
    for (const [key, entry] of windows) {
      if (now - entry.startedAt >= options.windowMs) windows.delete(key);
    }
    if (windows.size <= maxKeys) return;
    // Map 은 넣은 순서를 지킨다 — 앞쪽이 오래된 것이다
    let excess = windows.size - maxKeys;
    for (const key of windows.keys()) {
      if (excess <= 0) break;
      windows.delete(key);
      excess -= 1;
    }
  }

  return {
    hit(key, now = Date.now()) {
      const entry = windows.get(key);
      if (!entry || now - entry.startedAt >= options.windowMs) {
        windows.set(key, { count: 1, startedAt: now });
        prune(now);
        return { ok: true, retryAfterSec: 0 };
      }

      entry.count += 1;
      if (entry.count <= options.limit) return { ok: true, retryAfterSec: 0 };

      const remaining = options.windowMs - (now - entry.startedAt);
      return { ok: false, retryAfterSec: Math.max(1, Math.ceil(remaining / 1000)) };
    },
    size() {
      return windows.size;
    },
  };
}
