/**
 * 접속의 Origin·Host 검사 — 순수 로직 (SECURITY-AUDIT H-3 · 검토 R-1 · 점검 S-2).
 *
 * **WebSocket 과 HTTP 가 같은 규칙을 씁니다.** WS 는 `server/ws.ts` 의
 * `verifyClient`, HTTP 는 `server/app.ts` 의 `onRequest` 훅에서 부릅니다.
 *
 * ## 왜 필요한가
 *
 * **브라우저의 CORS 는 WebSocket 에 적용되지 않습니다.** 오퍼레이터가 예배 중 아무
 * 웹사이트나 열어도, 그 페이지의 스크립트가 `new WebSocket('ws://localhost:7777/ws')`
 * 로 붙어 송출 화면을 바꿀 수 있습니다.
 *
 * ## HTTP 도 안전하지 않았습니다 (점검 S-2, 2026-09-07)
 *
 * 여기 "REST 는 JSON 본문이라 프리플라이트가 걸려 상대적으로 안전하다" 고 적어
 * 두었는데, **두 경우에 그 전제가 깨집니다.** 격리 서버에서 실증했습니다:
 *
 * 1. **본문이 필요 없는 POST** 는 프리플라이트가 걸리지 않습니다.
 *    `Content-Type: text/plain` 으로 보내면 바깥 페이지가 그대로 호출합니다 —
 *    `POST /api/songs/1/confirm` 이 통해 `lines_source` 가 `auto` → `manual` 로
 *    바뀌었습니다(사람이 승인한 표시입니다). 즐겨찾기도 같았습니다.
 * 2. **DNS 리바인딩** 된 페이지는 같은 출처가 되어 JSON 본문도 프리플라이트 없이
 *    보냅니다. `GET /api/backup/export` 로 곡 전체를 읽고
 *    `POST /api/backup/import` `mode:replace` 로 데이터를 지우는 것까지 됐습니다.
 *
 * 그래서 이 검사는 이제 **HTTP 에도** 붙습니다.
 *
 * ## 규칙
 *
 * | Origin | 판정 | 이유 |
 * |---|---|---|
 * | 없음 | **허용** | 비브라우저 접속(스크립트·네이티브 클라이언트). 브라우저는 반드시 보낸다 |
 * | Host 와 같고, 그 Host 가 이 PC·사설망·`.local` | **허용** | 우리 서버가 내보낸 페이지 |
 * | 허용 목록에 있음 | 허용 | 리버스 프록시 등 (`SERMON_ALLOWED_ORIGINS`) |
 * | 그 밖 | **차단** | 외부 웹페이지 |
 *
 * `Origin` 이 없을 때 허용하는 것은 약점처럼 보이지만, **막아도 얻는 것이 없습니다** —
 * 브라우저가 아닌 클라이언트는 Origin 을 마음대로 정할 수 있으므로, 이 검사는 애초에
 * *브라우저에 갇힌 스크립트*만 막는 장치입니다. 대신 OBS·도구·테스트가 끊기지 않습니다.
 * 비브라우저 접근을 막는 것은 접근 통제(H-1·접속 암호)의 몫입니다.
 *
 * ## Host 도 믿을 수 없다 (R-1, 검토 2026-08-22)
 *
 * Origin 을 Host 와 비교하는 것만으로는 부족합니다. **Host 도 접속하는 쪽이 정하는
 * 값**이라, 둘을 서로 맞춰 보내면 통과했습니다(실증됨).
 *
 * 실제 공격은 **DNS 리바인딩** — 공격자가 `evil.test` 를 7777 포트로 서비스하다가 DNS 를
 * `127.0.0.1` 로 바꿉니다. 오퍼레이터가 그 주소를 한 번 열면 그 페이지가 우리 서버에
 * 붙습니다. 그래서 Host 가 **우리가 실제로 서비스할 수 있는 주소인지**도 봅니다
 * (`isServedHost`).
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

/** `a.b:7777` → `a.b` · `[::1]:7777` → `::1` (판단 불가면 undefined) */
function hostnameOf(host: string): string | undefined {
  try {
    // 스킴을 붙여야 URL 이 host:port 를 해석한다.
    const name = new URL(`http://${host}`).hostname;
    // IPv6 는 `[::1]` 처럼 대괄호가 붙어 나온다 — 비교하기 쉽게 벗긴다.
    return name.startsWith('[') && name.endsWith(']') ? name.slice(1, -1) : name || undefined;
  } catch {
    return undefined;
  }
}

/** 이 PC 를 가리키는 이름들 */
const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0']);

/**
 * 사설 IPv4 인가 — RFC1918 과 링크 로컬.
 *
 * 태블릿은 `http://192.168.1.190:7777` 같은 주소로 붙습니다. 그 경로를 살리면서
 * 임의의 도메인 이름은 막으려면 **주소의 모양**으로 가르는 것이 가장 확실합니다.
 */
function isPrivateIpv4(hostname: string): boolean {
  const parts = hostname.split('.');
  if (parts.length !== 4) return false;
  const n = parts.map((p) => (/^\d{1,3}$/.test(p) ? Number(p) : NaN));
  if (n.some((v) => Number.isNaN(v) || v > 255)) return false;
  const [a, b] = n as [number, number, number, number];
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true; // 링크 로컬
  return false;
}

/**
 * 이 Host 로 우리 서버가 서비스될 수 있는가.
 *
 * 통과하는 것은 **이 PC(루프백)·사설망 IP·mDNS 이름(`.local`)** 뿐입니다.
 * `evil.test` 처럼 공인 DNS 에 올릴 수 있는 이름은 여기서 걸립니다 — 그것이 DNS
 * 리바인딩의 전제이기 때문입니다.
 *
 * 그래도 막히는 정당한 주소가 있으면(리버스 프록시 등) `SERMON_ALLOWED_ORIGINS` 에
 * 넣습니다. 거부할 때 그렇게 로그를 남깁니다.
 */
export function isServedHost(host: string | undefined): boolean {
  if (!host) return false;
  const hostname = hostnameOf(host);
  if (!hostname) return false;
  const lower = hostname.toLowerCase();
  if (LOOPBACK.has(lower)) return true;
  if (lower === 'local' || lower.endsWith('.local')) return true;
  return isPrivateIpv4(lower);
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

  // 우리 서버가 내보낸 페이지인가 — 컨트롤 패널·출력 페이지가 여기에 해당한다.
  // Host 도 접속하는 쪽이 정하는 값이므로 그것까지 확인한다 (R-1).
  return host !== undefined && originHost === host && isServedHost(host);
}

/**
 * 이 `Host` 로 온 요청을 받아도 되는가 — **`Origin` 이 없는 요청까지 막기 위한 것.**
 *
 * `isAllowedOrigin` 만으로는 DNS 리바인딩을 못 막는다. 리바인딩된 페이지는 브라우저
 * 눈에 **같은 출처**라서, `fetch('/api/backup/export')` 같은 GET 에는 `Origin` 을
 * 아예 붙이지 않는다. 그래서 Host 는 **Origin 이 있든 없든** 따로 본다.
 *
 * 허용 목록의 Origin 이 가리키는 Host 도 함께 받아 준다 — 리버스 프록시 뒤에 두면
 * Host 가 프록시 이름이 되므로, `SERMON_ALLOWED_ORIGINS` 하나만 정하면 양쪽이 풀린다.
 */
export function isAllowedHost(host: string | undefined, allowed: readonly string[] = []): boolean {
  if (isServedHost(host)) return true;
  if (host === undefined) return false;
  return allowed.some((entry) => hostOf(entry) === host);
}

/** `SERMON_ALLOWED_ORIGINS="https://a.example, https://b.example"` → 배열 */
export function parseAllowedOrigins(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}
