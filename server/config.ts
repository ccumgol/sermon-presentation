/** 앱 전역 상수. 하드코딩된 값을 코드에 흩뿌리지 않기 위한 단일 위치. */

/**
 * 시작 포트. PORT 환경변수가 있으면 그 값을 우선한다
 * (Electron 메인 프로세스·개발 도구가 포트를 지정할 수 있어야 함).
 */
export const DEFAULT_PORT = Number(process.env.PORT) || 7777;

/** 포트가 점유되어 있으면 이만큼 위로 올려가며 재시도한다 (다른 PC 설치 대비). */
export const PORT_SCAN_RANGE = 20;

export const DEFAULT_CANVAS = { width: 1920, height: 1080 } as const;

/** 기본 주 역본 (계획서 D2) */
export const DEFAULT_PRIMARY_TRANSLATION = 'nkrv';

/**
 * 바인딩 주소. **기본은 이 PC 안에서만** 열린다.
 *
 * 예전 기본값은 `0.0.0.0`(태블릿 접속용, 계획서 D5)이었는데, 그때는 인증이 없어
 * **같은 WiFi 의 누구나 예배 중 화면을 바꾸거나 찬양 가사를 통째로 지울 수 있었다**
 * (SECURITY-AUDIT H-1·H-2 — 격리 서버에서 실증됨).
 *
 * **지금은 접속 암호가 있다**(감사 권고 4). LAN 요청만 암호를 묻고 이 PC 는 묻지
 * 않는다 — OBS 브라우저 소스가 암호를 입력할 수 없기 때문이다(`lib/lan-auth.ts`).
 * 암호가 정해지지 않은 채로는 LAN 에 열리지 않는다(`server/index.ts` 가 거부한다).
 *
 * 태블릿으로 조작하려면 그때만 연다:
 *
 *   ./start.sh lan             (암호가 없으면 그 자리에서 정하게 한다)
 *   npm run start:lan          (SERMON_HOST=0.0.0.0 npm start 와 같다)
 *   설치판은 설정 탭 → 태블릿에서 조작하기 → 열기 (다시 시작하면 반영된다)
 *
 * 그래도 교회 공용망에 여는 것이므로 예배가 끝나면 닫는다.
 */
/**
 * 환경 변수로 준 주소 — **모듈을 읽는 시점에 한 번** 잡는다.
 *
 * `HOST` 와 `resolveHost` 가 같은 값을 봐야 한다. 한쪽이 부를 때마다 `process.env` 를
 * 다시 읽으면 도는 중에 값이 갈라져, 기동 로그와 실제 바인딩이 어긋날 수 있다.
 */
const ENV_HOST = process.env.SERMON_HOST;

export const HOST = ENV_HOST ?? '127.0.0.1';

/** 이 주소는 이 PC 밖으로 열리는가 */
export function isLanHost(host: string): boolean {
  return host !== '127.0.0.1' && host !== 'localhost';
}

/** LAN 에 열려 있는가 — **환경 변수만** 본다 (H-1 회귀 테스트가 고정하는 값) */
export const IS_LAN_OPEN = isLanHost(HOST);

/**
 * 실제로 바인딩할 주소.
 *
 * ## 왜 저장된 설정이 필요한가 (점검 P-1, 2026-09-07)
 *
 * `SERMON_HOST` 를 정하는 곳은 `start.sh` 하나뿐이었다. **설치판(Electron)에는
 * 터미널도 저장소도 없어서 태블릿을 열 방법이 아예 없었다** — 그런데 화면은
 * `presentation lan` 을 입력하라고 안내했다. 할 수 없는 일을 시킨 것이다.
 *
 * 그래서 앱에서 켜고 끌 수 있게 설정에 담고, 여기서 그 값을 본다.
 *
 * **환경 변수가 이긴다.** `start.sh lan` 과 격리 서버 검증이 지금처럼 동작해야 하고,
 * 설정이 환경 변수를 덮으면 "명령으로 닫았는데 열려 있다" 가 된다.
 *
 * 기본값은 여전히 `127.0.0.1` 이다 (감사 H-1). 저장된 값이 없으면 닫혀 있다.
 */
export function resolveHost(storedLanOpen: boolean): string {
  if (ENV_HOST !== undefined && ENV_HOST.length > 0) return ENV_HOST;
  return storedLanOpen ? '0.0.0.0' : '127.0.0.1';
}
