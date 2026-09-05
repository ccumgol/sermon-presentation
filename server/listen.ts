/**
 * 포트를 순차 탐색해 바인딩한다.
 *
 * 다른 PC 나 다른 앱이 7777 을 이미 쓰고 있어도 앱이 죽지 않아야 한다
 * (계획서 D1 제약 2). **예배 직전에 '포트가 사용 중' 으로 멈추면 손쓸 시간이 없다.**
 *
 * 터미널 실행(`server/index.ts`)과 Electron 실행(`server/electron-entry.ts`)이
 * 함께 쓴다 — 한쪽만 고치면 '터미널로는 되는데 앱으로는 안 된다' 가 된다.
 */

import type { FastifyInstance } from 'fastify';

export interface ListenOptions {
  firstPort: number;
  /** 몇 개까지 넘겨 볼 것인가 */
  range: number;
  host: string;
  /** 다음 포트로 넘어갈 때 알린다 (로그가 없으면 왜 주소가 다른지 모른다) */
  onBusy?: (port: number) => void;
}

export async function listenWithFallback(app: FastifyInstance, options: ListenOptions): Promise<number> {
  let lastError: unknown;
  for (let port = options.firstPort; port < options.firstPort + options.range; port++) {
    try {
      await app.listen({ port, host: options.host });
      return port;
    } catch (err) {
      // 포트가 막힌 것이 아니면 그대로 던진다 — 삼키면 원인을 찾을 수 없다
      if ((err as { code?: string }).code !== 'EADDRINUSE') throw err;
      lastError = err;
      options.onBusy?.(port);
    }
  }
  throw lastError ?? new Error('사용 가능한 포트를 찾지 못했습니다');
}
