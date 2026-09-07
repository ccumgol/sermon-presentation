/**
 * `restart-policy.cjs` 의 타입 선언.
 *
 * 본체를 `.cjs` 로 둔 이유는 그 파일 머리말에 있다 — **크래시 경로에서 부르는
 * 코드는 가장 튼튼해야 해서** `electron/main.cjs`(CJS)가 그대로 `require` 한다.
 * 그래도 검사에서는 타입이 잡혀야 하므로 선언만 따로 둔다.
 */

export interface RestartInput {
  /** 이번에 얼마나 살아 있었나 (밀리초) */
  livedMs: number;
  /** 여태 빨리 죽은 횟수 (첫 실행은 0) */
  attempt: number;
  quickDeathMs?: number;
  limit?: number;
}

export interface RestartVerdict {
  restart: boolean;
  /** 다시 띄울 때 넘겨 줄 횟수 */
  nextAttempt: number;
  /** 포기할 때 사람에게 보여 줄 이유 */
  reason: string;
}

export declare function decideRestart(input: RestartInput): RestartVerdict;
export declare function readAttempt(argv: readonly string[] | undefined): number;
export declare function argsWithAttempt(argv: readonly string[] | undefined, attempt: number): string[];
export declare const QUICK_DEATH_MS: number;
export declare const RESTART_LIMIT: number;
