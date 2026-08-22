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
    attempts.set(address, { count: 1, first: now });
    return;
  }
  entry.count += 1;
}

export function clearFailures(address: string): void {
  attempts.delete(address);
}
