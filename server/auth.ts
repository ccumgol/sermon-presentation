/**
 * 태블릿 접속 암호 — 저장·검증 (보안 감사 권고 4).
 *
 * 판단 규칙(무엇을 면제하는가)은 `lib/lan-auth.ts` 에 있다. 여기는 **암호를 안전하게
 * 보관하고 확인하는 부분**이다. 암호 자체는 어디에도 평문으로 남지 않는다.
 *
 * ## 왜 scrypt 인가
 *
 * 교회에서 쓰는 암호는 짧고 외우기 쉬운 것이 된다. SHA-256 한 번으로는 사전 공격에
 * 몇 초면 뚫린다. scrypt 는 **일부러 느리고 메모리를 많이 쓰는** 함수라 그 공격이
 * 실용적이지 않다. Node 에 내장돼 있어 의존성이 늘지 않는다.
 *
 * ## 왜 쿠키에 서버 상태를 두지 않는가
 *
 * 이 서버는 코드를 고칠 때마다 재시작한다. 세션 목록을 메모리에 두면 재시작마다
 * 태블릿이 로그아웃된다. 그래서 쿠키에 `<만료시각>.<서명>` 만 담고 서버는 서명 열쇠만
 * 안다. 열쇠는 `app.sqlite` 에 있고 **암호를 바꾸면 함께 바뀐다** — 그것이 곧
 * '모든 기기 로그아웃' 이다.
 */

import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

import { SESSION_TTL_MS, splitSessionValue } from '../lib/lan-auth.ts';
import { getSetting, setSetting } from './db/app.ts';

const PASSWORD_KEY = 'lan_password';
const SECRET_KEY = 'lan_session_secret';

/**
 * **번들(내보내기)에 담아서는 안 되는 설정 키.**
 *
 * 여기가 이 두 키의 주인이므로 목록도 여기서 낸다 — `server/routes/backup.ts` 가
 * 이것을 가져다 제외한다. 이름을 바꿀 때 한 곳만 고치면 되고, 새 비밀을 설정에
 * 넣는 사람이 **이 목록을 보고** 함께 넣게 된다.
 *
 * ## 왜 담으면 안 되나 (2026-09-07 실측)
 *
 * 번들은 **다른 PC 로 자료를 옮기려고 사람이 손으로 나르는 파일**이다. 그런데
 * `lan_session_secret` 은 세션 쿠키의 **서명 열쇠**다 — 쿠키에는 만료 시각과
 * 서명만 들어 있고 서버는 이 열쇠만 안다(`issueSession`). 열쇠를 아는 사람은
 * **암호를 몰라도 유효한 쿠키를 만들 수 있다.** 격리 서버에서 실제로 통했다.
 *
 * `lan_password` 는 scrypt 해시라 곧바로 암호가 되지는 않지만, 교회에서 쓰는
 * 암호는 짧고 외우기 쉬운 것이 되므로 사전 공격의 표적이 된다.
 *
 * 가져오기도 같은 목록으로 막는다. 안 막으면 번들을 받은 PC 의 암호가 **남의
 * 암호로 조용히 바뀌고** 붙어 있던 태블릿이 전부 로그아웃된다.
 */
export const SECRET_SETTING_KEYS: readonly string[] = [PASSWORD_KEY, SECRET_KEY];

/** scrypt 매개변수 — 대화형 로그인에 알맞은 세기 (약 100ms) */
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 } as const;

/** 암호가 정해져 있는가 */
export function hasPassword(): boolean {
  const stored = getSetting(PASSWORD_KEY);
  return stored !== undefined && stored.length > 0;
}

/**
 * 암호를 정한다. 저장 형식은 `scrypt$<소금>$<해시>` 다.
 *
 * 서명 열쇠도 함께 새로 만든다 → **이미 접속해 있던 기기가 모두 로그아웃된다.**
 * 암호를 바꾸는 이유는 대개 '누가 알아 버렸다' 이므로 그것이 맞는 동작이다.
 */
export function setPassword(plain: string): void {
  if (plain.length < 4) throw new Error('암호는 4자 이상이어야 합니다.');
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(plain, salt, SCRYPT.keylen, SCRYPT).toString('hex');
  setSetting(PASSWORD_KEY, `scrypt$${salt}$${hash}`);
  setSetting(SECRET_KEY, randomBytes(32).toString('hex'));
}

/** 암호를 없앤다 (LAN 을 다시 쓰려면 새로 정해야 한다) */
export function clearPassword(): void {
  setSetting(PASSWORD_KEY, '');
  setSetting(SECRET_KEY, '');
}

/**
 * 입력한 암호가 맞는가.
 *
 * 길이 비교로 새는 정보를 막기 위해 `timingSafeEqual` 을 쓴다.
 */
export function verifyPassword(plain: string): boolean {
  const stored = getSetting(PASSWORD_KEY);
  if (!stored) return false;
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const [, salt, expected] = parts as [string, string, string];
  let actual: Buffer;
  try {
    actual = scryptSync(plain, salt, SCRYPT.keylen, SCRYPT);
  } catch {
    return false;
  }
  const expectedBuf = Buffer.from(expected, 'hex');
  if (expectedBuf.length !== actual.length) return false;
  return timingSafeEqual(expectedBuf, actual);
}

/** 서명 열쇠 — 없으면 만든다 */
function sessionSecret(): string {
  const existing = getSetting(SECRET_KEY);
  if (existing && existing.length > 0) return existing;
  const created = randomBytes(32).toString('hex');
  setSetting(SECRET_KEY, created);
  return created;
}

function sign(signedPart: string): string {
  return createHmac('sha256', sessionSecret()).update(signedPart).digest('hex');
}

/** 로그인 성공 → 쿠키에 담을 값 */
export function issueSession(now = Date.now()): { value: string; maxAgeSec: number } {
  const expiresAt = now + SESSION_TTL_MS;
  const signedPart = String(expiresAt);
  return {
    value: `${signedPart}.${sign(signedPart)}`,
    maxAgeSec: Math.floor(SESSION_TTL_MS / 1000),
  };
}

/** 쿠키 값이 우리가 낸 것이고 아직 살아 있는가 */
export function verifySession(value: string | undefined, now = Date.now()): boolean {
  const parsed = splitSessionValue(value);
  if (!parsed) return false;
  if (parsed.expiresAt <= now) return false;
  const expected = Buffer.from(sign(parsed.signedPart), 'hex');
  let actual: Buffer;
  try {
    actual = Buffer.from(parsed.signature, 'hex');
  } catch {
    return false;
  }
  if (expected.length === 0 || expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

/**
 * 로그인 시도 제한 — 짧은 암호를 무한히 찔러 보는 것을 막는다.
 *
 * 메모리에만 둔다. 재시작하면 풀리지만, 재시작은 사람이 하는 일이고 자동 공격의
 * 속도를 떨어뜨리는 것이 목적이다.
 */
const FAIL_LIMIT = 8;
const FAIL_WINDOW_MS = 5 * 60 * 1000;
const attempts = new Map<string, { count: number; first: number }>();

/**
 * 이 표가 무한히 자라지 않게 한다 (점검 S-5).
 *
 * 전에는 **그 주소로 다시 시도할 때만** 정리됐다. 주소를 바꿔 가며 찔러 보면
 * 항목이 계속 쌓인다 — LAN 안이라 실질 위험은 낮지만, 예배 중에 도는 프로세스가
 * 며칠씩 켜져 있으므로 새는 곳을 두지 않는다.
 *
 * 시간이 지난 것을 먼저 버리고, 그래도 너무 많으면 **가장 오래된 것부터** 버린다.
 * 상한을 두는 쪽이 안전하다 — 잠금이 풀리는 것이 표가 무한히 자라는 것보다 낫다.
 */
const MAX_TRACKED = 1024;

function prune(now: number): void {
  for (const [address, entry] of attempts) {
    if (now - entry.first > FAIL_WINDOW_MS) attempts.delete(address);
  }
  if (attempts.size <= MAX_TRACKED) return;

  // Map 은 넣은 순서를 지키므로 앞쪽이 오래된 것이다
  const excess = attempts.size - MAX_TRACKED;
  let dropped = 0;
  for (const address of attempts.keys()) {
    if (dropped >= excess) break;
    attempts.delete(address);
    dropped += 1;
  }
}

/** 이 주소가 지금 잠겨 있는가 → 남은 초 (아니면 0) */
export function lockedFor(address: string, now = Date.now()): number {
  const entry = attempts.get(address);
  if (!entry) return 0;
  if (now - entry.first > FAIL_WINDOW_MS) {
    attempts.delete(address);
    return 0;
  }
  if (entry.count < FAIL_LIMIT) return 0;
  return Math.ceil((FAIL_WINDOW_MS - (now - entry.first)) / 1000);
}

export function noteFailure(address: string, now = Date.now()): void {
  const entry = attempts.get(address);
  if (!entry || now - entry.first > FAIL_WINDOW_MS) {
    /*
     * **넣은 뒤에 걷어낸다.** 먼저 걷어내면 상한까지 줄인 다음 하나를 더해
     * `MAX_TRACKED + 1` 이 된다 — 검사에서 1,025 로 걸렸다. 새 항목은 넣은
     * 순서상 맨 뒤라 정리에 밀려나지 않는다.
     */
    attempts.set(address, { count: 1, first: now });
    prune(now);
    return;
  }
  entry.count += 1;
}

/** 지금 몇 주소를 지켜보고 있나 — 검사용 (표가 자라지 않는 것을 확인한다) */
export function trackedFailureCount(): number {
  return attempts.size;
}

export function clearFailures(address: string): void {
  attempts.delete(address);
}
