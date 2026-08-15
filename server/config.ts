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

export const HOST = '0.0.0.0'; // 태블릿에서 접속 가능하도록 (계획서 D5)
