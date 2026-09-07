/**
 * 설치판이 죽었을 때 다시 띄우는 규칙 (점검 P-4).
 *
 * 터미널로 돌릴 때는 `server/index.ts`(크게 남기고 죽는다) + `start.sh` 의 감시
 * 루프(1초 뒤 다시 띄운다)가 지켜 준다. **설치판에는 둘 다 없어서** 서버가 죽으면
 * 앱이 그냥 사라졌다 — 예배 중이면 화면이 멈추고 다시 켜 줄 사람은 봉사자다.
 *
 * 여기서 고정하는 것은 `start.sh` 와 **같은 규칙**이다:
 *  - 빨리 죽기를 거듭하면 **멈춘다** (무한 재시작은 원인을 가린다)
 *  - 한참 돌다 죽은 것은 처음부터 다시 센다 (일시적인 사고일 가능성이 높다)
 *
 * 횟수는 명령줄로 다음 실행에 넘긴다 — 프로세스가 바뀌므로 메모리로는 셀 수 없다.
 */

import { describe, expect, it } from 'vitest';

import {
  argsWithAttempt,
  decideRestart,
  readAttempt,
  QUICK_DEATH_MS,
  RESTART_LIMIT,
} from '../../electron/restart-policy.cjs';

describe('다시 띄울까', () => {
  it('처음 빨리 죽으면 다시 띄운다', () => {
    const verdict = decideRestart({ livedMs: 1_000, attempt: 0 });
    expect(verdict.restart).toBe(true);
    expect(verdict.nextAttempt).toBe(1);
  });

  it('빨리 죽기를 거듭하면 멈춘다 — 무한 재시작은 원인을 가린다', () => {
    let attempt = 0;
    const seen: boolean[] = [];
    for (let i = 0; i < RESTART_LIMIT + 2; i++) {
      const verdict = decideRestart({ livedMs: 500, attempt });
      seen.push(verdict.restart);
      attempt = verdict.nextAttempt;
      if (!verdict.restart) break;
    }
    expect(seen.filter(Boolean).length).toBe(RESTART_LIMIT - 1);
    expect(seen.at(-1)).toBe(false);
  });

  it('한참 돌다 죽으면 횟수를 처음부터 센다', () => {
    // 네 번 빨리 죽은 뒤라도, 오래 돌다 죽었으면 다시 띄운다
    const verdict = decideRestart({ livedMs: QUICK_DEATH_MS + 1, attempt: RESTART_LIMIT - 2 });
    expect(verdict.restart).toBe(true);
    expect(verdict.nextAttempt).toBe(1);
  });

  it('경계값에서 오래 산 것으로 본다', () => {
    expect(decideRestart({ livedMs: QUICK_DEATH_MS, attempt: 3 }).nextAttempt).toBe(1);
    expect(decideRestart({ livedMs: QUICK_DEATH_MS - 1, attempt: 3 }).nextAttempt).toBe(4);
  });

  it('포기할 때는 사람에게 보여 줄 이유가 있다 — 말없이 사라지지 않는다', () => {
    const verdict = decideRestart({ livedMs: 100, attempt: RESTART_LIMIT });
    expect(verdict.restart).toBe(false);
    expect(verdict.reason).toContain('멈춥니다');
    expect(verdict.reason.length).toBeGreaterThan(20);
  });
});

describe('횟수를 명령줄로 넘긴다 — 프로세스가 바뀌므로 메모리로는 셀 수 없다', () => {
  it('없으면 0', () => {
    expect(readAttempt([])).toBe(0);
    expect(readAttempt(['--other'])).toBe(0);
    expect(readAttempt(undefined)).toBe(0);
  });

  it('붙여 둔 값을 읽는다', () => {
    expect(readAttempt(['/app/x', '--sermon-restart=3'])).toBe(3);
  });

  it('숫자가 아니면 무시한다', () => {
    expect(readAttempt(['--sermon-restart=abc'])).toBe(0);
    expect(readAttempt(['--sermon-restart='])).toBe(0);
  });

  it('옛 표시를 지우고 새 값을 붙인다 — 넘길 때마다 늘어나면 안 된다', () => {
    const once = argsWithAttempt(['--sermon-restart=1', '--flag'], 2);
    expect(once).toEqual(['--flag', '--sermon-restart=2']);

    const twice = argsWithAttempt(once, 3);
    expect(twice.filter((a) => a.startsWith('--sermon-restart='))).toEqual(['--sermon-restart=3']);
  });

  it('사용자가 준 다른 인자는 지키다', () => {
    expect(argsWithAttempt(['--user-data-dir=/tmp/x'], 1)).toEqual([
      '--user-data-dir=/tmp/x',
      '--sermon-restart=1',
    ]);
  });
});
