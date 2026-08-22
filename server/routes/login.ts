/**
 * 로그인 — 태블릿에서 암호를 넣는 경로 (보안 감사 권고 4).
 *
 * 이 세 경로만 암호 없이 열려 있다(`lib/lan-auth.ts` 의 `isAuthExemptPath`).
 * 막으면 암호를 넣을 방법이 없어진다.
 */

import type { FastifyInstance } from 'fastify';

import { SESSION_COOKIE, isLoopbackAddress } from '../../lib/lan-auth.ts';
import {
  clearFailures,
  hasPassword,
  issueSession,
  lockedFor,
  noteFailure,
  verifyPassword,
} from '../auth.ts';

/** 쿠키를 붙인다. `@fastify/cookie` 를 쓰지 않으려고 헤더를 직접 만든다(의존성 0). */
function sessionCookie(value: string, maxAgeSec: number): string {
  return [
    `${SESSION_COOKIE}=${value}`,
    'Path=/',
    `Max-Age=${maxAgeSec}`,
    'HttpOnly', // JS 가 읽지 못하게 — XSS 로 새는 것을 막는다
    'SameSite=Lax', // 다른 사이트가 우리 요청에 쿠키를 얹지 못하게
  ].join('; ');
  // Secure 는 붙이지 않는다 — 교회 LAN 은 http 다. 붙이면 태블릿이 로그인할 수 없다.
}

export function registerLoginRoutes(app: FastifyInstance): void {
  app.get('/login', async (_request, reply) => reply.sendFile('login/index.html'));

  app.post<{ Body: unknown }>('/api/login', async (request, reply) => {
    const address = request.ip;

    if (!hasPassword()) {
      return reply.code(503).send({
        success: false,
        data: null,
        error: '이 서버에는 암호가 정해져 있지 않습니다. PC 에서 npm run password 로 정하세요.',
      });
    }

    const locked = lockedFor(address);
    if (locked > 0) {
      app.log.warn(`로그인 시도 제한 — ${address} (${locked}초 남음)`);
      return reply.code(429).send({
        success: false,
        data: null,
        error: `시도가 너무 많습니다. ${Math.ceil(locked / 60)}분 뒤에 다시 해 보세요.`,
      });
    }

    const body = request.body;
    const password =
      typeof body === 'object' && body !== null && 'password' in body
        ? (body as { password: unknown }).password
        : undefined;

    if (typeof password !== 'string' || password.length === 0) {
      return reply.code(400).send({ success: false, data: null, error: '암호를 입력하세요.' });
    }

    if (!verifyPassword(password)) {
      noteFailure(address);
      app.log.warn(`로그인 실패 — ${address}`);
      return reply.code(401).send({ success: false, data: null, error: '암호가 맞지 않습니다.' });
    }

    clearFailures(address);
    const session = issueSession();
    app.log.info(`로그인 성공 — ${address}`);
    return reply
      .header('Set-Cookie', sessionCookie(session.value, session.maxAgeSec))
      .send({ success: true, data: { ok: true }, error: null });
  });

  app.post('/api/logout', async (request, reply) => {
    // 루프백은 애초에 쿠키를 쓰지 않는다 — 지울 것이 없다고 알려 준다
    const local = isLoopbackAddress(request.ip);
    return reply
      .header('Set-Cookie', sessionCookie('', 0))
      .send({ success: true, data: { wasLocal: local }, error: null });
  });
}
