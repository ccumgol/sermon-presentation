/**
 * WebSocket 접속의 Origin 검사 — 순수 로직 (SECURITY-AUDIT H-3).
 *
 * ## 왜 필요한가
 *
 * **브라우저의 CORS 는 WebSocket 에 적용되지 않습니다.** 오퍼레이터가 예배 중 아무
 * 웹사이트나 열어도, 그 페이지의 스크립트가 `new WebSocket('ws://localhost:7777/ws')`
 * 로 붙어 송출 화면을 바꿀 수 있습니다. REST 는 JSON 본문이라 프리플라이트가 걸려
 * 상대적으로 안전하지만 WS 에는 그 보호가 없습니다.
 *
 * ## 규칙
 *
 * | Origin | 판정 | 이유 |
 * |---|---|---|
 * | 없음 | **허용** | 비브라우저 접속(스크립트·네이티브 클라이언트). 브라우저는 반드시 보낸다 |
 * | Host 와 같음 | **허용** | 우리 서버가 내보낸 페이지 — 컨트롤 패널·OBS 브라우저 소스 |
 * | 허용 목록에 있음 | 허용 | 리버스 프록시 등 (`SERMON_ALLOWED_ORIGINS`) |
 * | 그 밖 | **차단** | 외부 웹페이지 |
 *
 * `Origin` 이 없을 때 허용하는 것은 약점처럼 보이지만, **막아도 얻는 것이 없습니다** —
 * 브라우저가 아닌 클라이언트는 Origin 을 마음대로 정할 수 있으므로, 이 검사는 애초에
 * *브라우저에 갇힌 스크립트*만 막는 장치입니다. 대신 OBS·도구·테스트가 끊기지 않습니다.
 * 비브라우저 접근을 막는 것은 접근 통제(H-1·접속 암호)의 몫입니다.
 */

/** `http://a.b:7777` → `a.b:7777` (판단 불가면 undefined) */
function hostOf(origin: string): string | undefined {
  try {
    const url = new URL(origin);
    return url.host || undefined;
  } catch {
    return undefined;
  }
}

/**
 * 이 Origin 의 접속을 받아도 되는가.
 *
 * @param origin 업그레이드 요청의 `Origin` 헤더 (없으면 undefined)
 * @param host   같은 요청의 `Host` 헤더 — 클라이언트가 실제로 접속한 주소
 * @param allowed 추가로 허용할 Origin 문자열 목록
 */
export function isAllowedOrigin(
  origin: string | undefined | null,
  host: string | undefined,
  allowed: readonly string[] = [],
): boolean {
  // 비브라우저 접속 — OBS 스크립트·개발 도구·테스트
  if (origin === undefined || origin === null || origin === '') return true;

  // 샌드박스 iframe·file:// 은 'null' 문자열을 보낸다. 브라우저 맥락인데
  // 같은 출처가 아니므로 막는다.
  if (origin === 'null') return false;

  if (allowed.includes(origin)) return true;

  const originHost = hostOf(origin);
  if (!originHost) return false; // 해석할 수 없는 값

  // 우리 서버가 내보낸 페이지인가 — 컨트롤 패널·출력 페이지가 여기에 해당한다
  return host !== undefined && originHost === host;
}

/** `SERMON_ALLOWED_ORIGINS="https://a.example, https://b.example"` → 배열 */
export function parseAllowedOrigins(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}
