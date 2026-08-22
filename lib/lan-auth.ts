/**
 * 태블릿 접속 암호의 **판단 규칙** — 순수 함수 (보안 감사 권고 4).
 *
 * ## 무엇을 지키고 무엇을 지키지 않는가
 *
 * 이 앱의 위협은 외부 해커가 아니라 **같은 WiFi 의 기기**다(감사 H-1). 그래서
 * **이 PC(루프백)에서 오는 요청은 그대로 통과시키고, LAN 에서 오는 요청만 암호를 묻는다.**
 *
 * 그렇게 나눈 이유는 안전 때문이 아니라 **예배가 멈추지 않게** 하기 위해서다:
 *
 * - **OBS 브라우저 소스는 암호를 입력할 수 없다.** URL 을 열 뿐이다. OBS 는 서버와 같은
 *   PC 에서 돌므로(설계상 `localhost:7777/output/`) 루프백 면제로 그대로 살아 있다.
 * - 강사 모니터(`/stage`)·프로젝터(`/projector`)도 이 PC 의 창이다.
 * - 오퍼레이터의 컨트롤 패널도 이 PC 다. 예배 직전에 암호를 묻지 않는다.
 *
 * 다른 PC 의 OBS 처럼 **암호를 입력할 수 없는 기기**가 LAN 에 있으면 `SERMON_TRUSTED_IPS`
 * 로 그 주소만 면제한다. URL 에 암호를 담는 방법은 만들지 않았다 — 주소는 기록에 남는다.
 *
 * ## 쿠키는 서버가 다시 떠도 살아 있어야 한다
 *
 * 이 서버는 코드를 고칠 때마다 재시작한다. 세션을 메모리에 두면 그때마다 태블릿이
 * 로그아웃된다. 그래서 쿠키에 **만료 시각 + 서명**만 담고 서버는 아무것도 기억하지 않는다.
 * 서명 열쇠는 `app.sqlite` 에 있고, **암호를 바꾸면 열쇠도 바뀐다**(= 모든 기기 로그아웃).
 */

/** 쿠키 이름 */
export const SESSION_COOKIE = 'sermon_lan';

/** 쿠키 유효 기간 — 태블릿을 매주 쓰는 사람이 매번 입력하지 않을 만큼 */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * 이 PC 에서 온 요청인가.
 *
 * IPv4-mapped IPv6(`::ffff:127.0.0.1`)로 오는 경우가 있어 함께 본다.
 */
export function isLoopbackAddress(address: string | undefined | null): boolean {
  if (!address) return false;
  const addr = address.trim().toLowerCase();
  if (addr === '::1' || addr === 'localhost') return true;
  if (addr.startsWith('::ffff:')) return isLoopbackAddress(addr.slice(7));
  // 127.0.0.0/8 전체가 루프백이다
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(addr);
}

/** `SERMON_TRUSTED_IPS="192.168.1.50, 192.168.1.51"` → 배열 */
export function parseTrustedIps(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

/** 암호를 입력할 수 없는 기기로 사용자가 지정한 주소인가 */
export function isTrustedAddress(
  address: string | undefined | null,
  trusted: readonly string[],
): boolean {
  if (!address || trusted.length === 0) return false;
  const addr = address.trim().toLowerCase();
  const bare = addr.startsWith('::ffff:') ? addr.slice(7) : addr;
  return trusted.some((entry) => entry.trim().toLowerCase() === bare);
}

/**
 * 암호 없이 통과시켜야 하는 경로.
 *
 * 로그인 화면 자체와 그 제출 경로다. 이것을 막으면 암호를 넣을 방법이 없어진다.
 * `/api/info` 는 넣지 않는다 — 절대 경로와 LAN 주소를 알려 주기 때문이다(감사 M-3).
 */
export function isAuthExemptPath(pathname: string): boolean {
  const path = pathname.split('?')[0] ?? '';
  return (
    path === '/login' ||
    path === '/login/' ||
    path === '/api/login' ||
    path === '/api/logout' ||
    path === '/favicon.ico'
  );
}

/** `a=1; b=2` 에서 이름으로 하나를 꺼낸다 */
export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    const value = part.slice(eq + 1).trim();
    return value.length > 0 ? value : undefined;
  }
  return undefined;
}

/** 쿠키 값 `<만료ms>.<서명>` 을 나눈다 (형식이 아니면 undefined) */
export function splitSessionValue(
  value: string | undefined,
): { expiresAt: number; signature: string; signedPart: string } | undefined {
  if (!value) return undefined;
  const dot = value.indexOf('.');
  if (dot <= 0 || dot === value.length - 1) return undefined;
  const signedPart = value.slice(0, dot);
  if (!/^\d+$/.test(signedPart)) return undefined;
  return { expiresAt: Number(signedPart), signature: value.slice(dot + 1), signedPart };
}

/**
 * HTML 을 기대하는 요청인가 — 그러면 401 대신 로그인 화면으로 보낸다.
 *
 * API·WebSocket 에 리다이렉트를 주면 클라이언트가 로그인 HTML 을 JSON 으로 읽으려 한다.
 */
export function wantsHtml(accept: string | undefined): boolean {
  return (accept ?? '').includes('text/html');
}
