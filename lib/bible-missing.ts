/**
 * **성경 DB 가 없을 때 무슨 말을 해 줄 것인가.**
 *
 * 같은 상황인데 사람이 할 수 있는 일이 다르다:
 *
 * - **저장소에서 돌릴 때** — 터미널이 있고 원본 자료도 있다. 다시 만들면 된다.
 * - **설치한 앱을 쓸 때** — 터미널도 저장소도 원본 자료도 없다. `npm run` 을
 *   시키는 것은 **할 수 없는 일을 시키는 것**이다. 파일을 어디에 넣으라고
 *   말해 줘야 한다 (2026-09-05 사용자 보고: 파일을 제대로 넣고도 이 문구 때문에
 *   무엇을 더 해야 하는지 몰랐다).
 *
 * 문구를 한 곳에 모아 두는 이유: 같은 안내가 서버 로그·조작 화면·설정 탭
 * 세 군데에 있었다. 한 곳만 고치면 나머지가 옛말을 한다.
 */

/** 지금 어떻게 실행 중인가 */
export function isPackagedApp(env: Record<string, string | undefined> = process.env): boolean {
  return env.SERMON_PACKAGED === '1';
}

/**
 * 성경 DB 가 없을 때의 안내. `dbPath` 는 **찾던 자리**다 —
 * 어디를 봤는지 알려 주지 않으면 엉뚱한 곳에 파일을 넣고 헤맨다.
 */
export function bibleMissingMessage(dbPath: string, packaged = isPackagedApp()): string {
  if (packaged) {
    return (
      `성경 DB 가 없습니다. 설정 탭의 '데이터 폴더 열기' 를 누르고, 그 폴더 안에 ` +
      `bible.sqlite 파일을 넣은 뒤 앱을 다시 시작하세요.\n찾은 자리: ${dbPath}`
    );
  }
  return `성경 DB 가 없습니다 (${dbPath}). 터미널에서 'npm run bible:build' 를 실행한 뒤 서버를 재시작하세요.`;
}

/** 한 줄짜리 (서버 로그용) */
export function bibleMissingLine(dbPath: string, packaged = isPackagedApp()): string {
  return packaged
    ? `성경 DB 가 없어 조회 기능이 비활성입니다 — 데이터 폴더에 bible.sqlite 를 넣고 다시 시작하세요 (${dbPath})`
    : `성경 DB 가 없어 조회 기능이 비활성입니다 (${dbPath}) — 'npm run bible:build' 실행 후 재시작하세요`;
}
