/**
 * 설치판이 죽었을 때 **다시 띄울지** 정하는 규칙 — 순수 함수 (점검 P-4).
 *
 * ## 왜 필요한가
 *
 * 터미널로 돌릴 때는 두 겹의 보호가 있다:
 *
 *  1. `server/index.ts` 가 `uncaughtException` 을 잡아 **크게 남기고 곧바로 죽는다**
 *     (오류를 삼켜 살려 두지 않는다 — 그 뒤 프로세스 상태를 믿을 수 없다)
 *  2. `start.sh` 의 감시 루프가 1초 뒤 다시 띄운다
 *
 * **설치판에는 둘 다 없었다.** 서버가 Electron 메인 프로세스 안에서 도는데
 * 처리되지 않은 오류가 나면 앱이 그냥 사라진다 — 예배 중이면 화면은 마지막
 * 슬라이드로 멈추고, 다시 켜 줄 사람은 봉사자다.
 *
 * ## 규칙은 `start.sh` 와 같다
 *
 * 뜬 지 얼마 안 되어 죽으면 '빨리 죽었다' 로 세고, 그것이 거듭되면 **되살리기를
 * 멈춘다** — 무한 재시작은 원인을 가리고 로그만 불린다. 한참 돌다 죽은 것은
 * 처음부터 다시 센다(그때는 일시적인 사고일 가능성이 높다).
 *
 * `.cjs` 인 이유: `electron/main.cjs` 가 CJS 이고, **크래시 경로에서 부르는 코드는
 * 가장 튼튼해야 한다.** 여기서 `.ts` 를 동적으로 불러오면 그 로딩이 실패할 때
 * 되살리기 자체가 안 된다. 대신 순수 함수로 떼어 두어 검사할 수 있게 했다.
 */

/** 뜬 지 이 시간 안에 죽으면 '빨리 죽었다' (start.sh 의 QUICK_DEATH 와 같은 값) */
const QUICK_DEATH_MS = 20_000;

/** 빨리 죽기를 이만큼 거듭하면 포기한다 (start.sh 의 RESTART_LIMIT 과 같은 값) */
const RESTART_LIMIT = 5;

/**
 * 다시 띄울까?
 *
 * @param {object} input
 * @param {number} input.livedMs   이번에 얼마나 살아 있었나
 * @param {number} input.attempt   여태 빨리 죽은 횟수 (첫 실행은 0)
 * @param {number} [input.quickDeathMs]
 * @param {number} [input.limit]
 * @returns {{ restart: boolean, nextAttempt: number, reason: string }}
 *   `nextAttempt` 는 다시 띄울 때 넘겨 줄 횟수다. 포기하면 `reason` 을 사람에게 보여 준다.
 */
function decideRestart(input) {
  const quick = input.quickDeathMs ?? QUICK_DEATH_MS;
  const limit = input.limit ?? RESTART_LIMIT;

  // 한참 돌다 죽었다 — 일시적인 사고로 보고 횟수를 처음부터 센다
  const nextAttempt = input.livedMs >= quick ? 1 : input.attempt + 1;

  if (nextAttempt >= limit) {
    return {
      restart: false,
      nextAttempt,
      reason:
        `앱이 ${Math.round(quick / 1000)}초 안에 ${nextAttempt}번 거듭 종료됐습니다. ` +
        '다시 띄우기를 멈춥니다 — 같은 원인이 계속 있는 상태입니다.',
    };
  }

  return {
    restart: true,
    nextAttempt,
    reason: `다시 시작합니다 (${nextAttempt}/${limit}). 화면은 마지막 내용을 그대로 두고 스스로 다시 붙습니다.`,
  };
}

/** 명령줄에서 여태 빨리 죽은 횟수를 읽는다 (다시 띄울 때 우리가 붙여 넘긴다) */
function readAttempt(argv) {
  for (const arg of argv ?? []) {
    const match = /^--sermon-restart=(\d+)$/.exec(String(arg));
    if (match) return Number(match[1]);
  }
  return 0;
}

/** 다음 실행에 넘길 명령줄 — 우리가 붙인 옛 표시를 지우고 새 값을 붙인다 */
function argsWithAttempt(argv, attempt) {
  return (argv ?? [])
    .filter((arg) => !/^--sermon-restart=/.test(String(arg)))
    .concat([`--sermon-restart=${attempt}`]);
}

module.exports = { decideRestart, readAttempt, argsWithAttempt, QUICK_DEATH_MS, RESTART_LIMIT };
