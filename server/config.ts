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
 * 예전 기본값은 `0.0.0.0`(태블릿 접속용, 계획서 D5)이었는데, 이 앱에는 인증이 없어
 * **같은 WiFi 의 누구나 예배 중 화면을 바꾸거나 찬양 가사를 통째로 지울 수 있었다**
 * (SECURITY-AUDIT H-1·H-2 — 격리 서버에서 실증됨).
 *
 * 태블릿으로 조작하려면 그때만 연다:
 *
 *   npm run start:lan          (SERMON_HOST=0.0.0.0 npm start 와 같다)
 *
 * 여는 순간 인증 없이 노출되므로, 신뢰할 수 있는 망에서만 쓰고 예배가 끝나면 닫는다.
 */
export const HOST = process.env.SERMON_HOST ?? '127.0.0.1';

/** LAN 에 열려 있는가 — 기동 로그와 `/api/info` 가 이 값으로 안내한다 */
export const IS_LAN_OPEN = HOST !== '127.0.0.1' && HOST !== 'localhost';
