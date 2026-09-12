/**
 * Fastify 앱 구성. 실행(listen)과 분리해 테스트에서 그대로 주입할 수 있게 한다.
 *
 * 성경 DB 가 없어도 앱은 뜬다 — 안내 화면을 띄워야 하고,
 * 예배 직전 기동 실패로 아무것도 못 하는 상황을 만들지 않는다.
 */

import { existsSync } from 'node:fs';
import path from 'node:path';

import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';

import { DEFAULT_PRIMARY_TRANSLATION, isLanHost, resolveHost } from './config.ts';
import { initAppDb } from './db/app.ts';
import { initPlanStore, countPlans } from './db/plans.ts';
import { initReadingStore } from './db/readings.ts';
import { initSongsDb, countSongs } from './db/songs.ts';
import { initTemplateStore, getTemplateOrDefault } from './db/templates.ts';
import { BibleDbMissingError, initBibleDb, listTranslations } from './db/bible.ts';
import { isAllowedHost, isAllowedOrigin, parseAllowedOrigins } from '../lib/origin-check.ts';
import { createRateLimiter } from '../lib/rate-limit.ts';
import { lanHosts, lanInterfaces } from './lan.ts';
import { storedLanOpen } from './lan-setting.ts';
import { ensureDataDirs, paths } from './paths.ts';
import {
  SESSION_COOKIE, isAuthExemptPath, isLoopbackAddress, isTrustedAddress, parseTrustedIps,
  readCookie, wantsHtml,
} from '../lib/lan-auth.ts';
import { verifySession } from './auth.ts';
import { registerLoginRoutes } from './routes/login.ts';
import { registerTabletRoutes } from './routes/tablet.ts';
import { registerBibleRoutes } from './routes/bible.ts';
import { registerBackgroundRoutes } from './routes/backgrounds.ts';
import { registerDataPackRoutes } from './routes/data-pack.ts';
import { registerBackupRoutes } from './routes/backup.ts';
import { registerPlanRoutes } from './routes/plans.ts';
import { registerReadingRoutes } from './routes/readings.ts';
import { registerSongbookRoutes } from './routes/songbooks.ts';
import { registerSongRoutes } from './routes/songs.ts';
import { bibleMissingMessage, isPackagedApp } from '../lib/bible-missing.ts';
import { registerSystemRoutes } from './routes/system.ts';
import { registerTemplateRoutes } from './routes/templates.ts';
import { getState, initState } from './state.ts';
import { appVersion } from './version.ts';
import type { Template } from '../shared/types.ts';

export interface BuildAppOptions {
  logger?: FastifyServerOptions['logger'];
  /** 템플릿이 바뀌면 송출 화면에 즉시 반영하기 위한 콜백 (WS 허브가 넣는다) */
  onTemplateChanged?: (template: Template) => void;
  /** 실제 바인딩된 포트를 알려주는 접근자. /api/info 가 사용한다. */
  getPort: () => number;
  /** WS 접속 수 접근자. 허브가 붙기 전에는 0 을 돌려준다. */
  getConnections?: () => { control: number; output: number };
}

export interface BuiltApp {
  app: FastifyInstance;
  bibleReady: boolean;
  stateRestored: { restored: boolean; corrupt: boolean };
}

export async function buildApp(options: BuildAppOptions): Promise<BuiltApp> {
  const app = Fastify({
    logger: options.logger ?? false,
    // 요청 로그를 끈다. 예배 중 터미널에는 실제로 봐야 할 경고만 남아야 한다.
    // 디버깅이 필요하면 LOG_LEVEL=debug 로 켠다.
    //
    // Fastify 6 에서 logController 로 대체될 예정이라 기동 시 폐기 경고가 한 번 뜬다.
    // logController 는 10개 속성을 모두 요구해 부분 지정이 안 되므로,
    // Fastify 6 으로 올릴 때 함께 옮긴다.
    disableRequestLogging: process.env.LOG_LEVEL !== 'debug',
  });

  ensureDataDirs();
  initAppDb();
  initTemplateStore();
  initPlanStore();
  initReadingStore();
  initSongsDb();

  let bibleReady = false;
  try {
    initBibleDb();
    bibleReady = true;
  } catch (err) {
    if (err instanceof BibleDbMissingError) {
      app.log.error(err.message);
    } else {
      throw err;
    }
  }

  const stateRestored = initState();

  /*
   * **지금 이 서버가 실제로 열려 있는 범위.**
   *
   * 환경 변수(`start.sh lan`)와 저장된 선택(설치판의 설정 탭) 둘 다를 거친
   * 결과다 — `resolveHost` 가 그 우선순위를 정한다. `/api/info` 와 태블릿 QR 이
   * 이 값으로 안내하므로, 여기서 한 번만 계산해 두 곳이 어긋나지 않게 한다.
   */
  const lanOpen = isLanHost(resolveHost(storedLanOpen()));

  /**
   * ── 어디서 온 요청인가 (점검 S-2) ────────────────────────────
   *
   * **WS 와 똑같은 규칙을 HTTP 에도 적용한다.** 여태 이 검사는 `server/ws.ts` 에만
   * 있었고, 그래서 바깥 웹페이지가 REST 로는 그냥 들어왔다 (격리 서버 실증):
   *
   *   · `Origin: https://evil.example` + `Content-Type: text/plain` 으로
   *     `POST /api/songs/1/confirm` → 200. `lines_source` 가 `auto` → `manual` 로
   *     바뀐다. 본문을 안 보는 POST 는 **프리플라이트가 걸리지 않는다.**
   *   · `Host: evil.example` 로 `GET /api/backup/export` → 200 (곡 전체가 나간다).
   *     같은 방법으로 `mode:replace` 가져오기까지 성공했다. 리바인딩된 페이지는
   *     같은 출처라 GET 에 `Origin` 을 붙이지 않으므로 **Host 를 따로 봐야 한다.**
   *
   * **루프백을 면제하지 않는다.** 이 공격은 오퍼레이터 PC 의 브라우저에서 오므로
   * 요청 주소가 곧 루프백이다 — 여기서 면제하면 막는 의미가 없다.
   *
   * 정당한 접속은 그대로 통과한다:
   *   · OBS 브라우저 소스·프로젝터·강사 모니터 → Host 가 `localhost` 다
   *   · 태블릿 → Host 가 사설 IP(`192.168.*`)다
   *   · 컨트롤 패널의 fetch → Origin 과 Host 가 같고 그 Host 가 우리 것이다
   *   · `curl`·테스트 → Origin 이 없다 (Host 만 본다)
   *
   * 막히는 정당한 주소가 있으면(리버스 프록시·Tailscale 같은 100.64/10 주소)
   * `SERMON_ALLOWED_ORIGINS` 에 넣는다. 거부할 때 로그가 그렇게 말해 준다.
   */
  const allowedOrigins = parseAllowedOrigins(process.env.SERMON_ALLOWED_ORIGINS);
  app.addHook('onRequest', async (request, reply) => {
    const { origin, host } = request.headers;
    if (isAllowedOrigin(origin, host, allowedOrigins) && isAllowedHost(host, allowedOrigins)) return;

    // 정당한 접속이 막혔을 때 무엇을 해야 하는지 로그가 말해 준다.
    // 이 경고 없이는 '예배 직전에 화면이 안 붙는다' 를 진단할 수 없다.
    app.log.warn(
      `요청 거부 — Origin ${origin ?? '(없음)'} / Host ${host ?? '(없음)'} · ${request.method} ${request.url}. ` +
        '정당한 접속이면 SERMON_ALLOWED_ORIGINS 에 그 주소를 넣으세요.',
    );
    return reply.code(403).send({
      success: false,
      data: null,
      error: '이 주소로 온 요청은 받지 않습니다. 정당한 접속이면 SERMON_ALLOWED_ORIGINS 에 넣으세요.',
    });
  });

  /**
   * ── 접속 암호 (보안 감사 권고 4) ─────────────────────────────
   *
   * **이 PC 에서 온 요청은 그대로 통과시키고 LAN 요청만 암호를 묻는다.**
   * 안전 때문이 아니라 예배가 멈추지 않게 하기 위한 구분이다 — OBS 브라우저 소스는
   * 암호를 입력할 수 없고, 오퍼레이터의 패널도 예배 직전에 암호를 물으면 안 된다.
   * 자세한 근거는 `lib/lan-auth.ts` 머리말.
   *
   * LAN 이 닫혀 있으면(기본) 모든 요청이 루프백이라 이 훅은 아무 일도 하지 않는다.
   */
  const trustedIps = parseTrustedIps(process.env.SERMON_TRUSTED_IPS);

  /**
   * ── 요청 수 제한 (보안 감사 L-2) ─────────────────────────────
   *
   * 로그인에는 시도 제한이 있었지만 **나머지 라우트에는 아무것도 없었다.**
   * LAN 기기 하나가 `/api/backup/export`(곡 전체)를 쉼 없이 부르면 예배 중에
   * 서버가 느려진다.
   *
   * **이 PC 는 세지 않는다.** OBS·컨트롤 패널·프로젝터·강사 모니터가 모두 이
   * PC 이고, 그들을 세는 것은 예배를 막을 위험만 있고 얻는 것이 없다.
   * 한도는 넉넉하다 — 태블릿이 화면을 한 번 열 때 스물 몇 번을 부른다.
   */
  const lanLimiter = createRateLimiter({ limit: 600, windowMs: 60_000 });
  app.addHook('onRequest', async (request, reply) => {
    if (isLoopbackAddress(request.ip)) return;
    if (isTrustedAddress(request.ip, trustedIps)) return;

    const verdict = lanLimiter.hit(request.ip);
    if (!verdict.ok) {
      app.log.warn(`요청 수 제한 — ${request.ip} (${verdict.retryAfterSec}초 뒤 다시)`);
      return reply
        .code(429)
        .header('Retry-After', String(verdict.retryAfterSec))
        .send({ success: false, data: null, error: '요청이 너무 많습니다. 잠시 뒤에 다시 해 보세요.' });
    }
  });

  app.addHook('onRequest', async (request, reply) => {
    if (isLoopbackAddress(request.ip)) return;
    if (isTrustedAddress(request.ip, trustedIps)) return;
    if (isAuthExemptPath(request.url)) return;
    if (verifySession(readCookie(request.headers.cookie, SESSION_COOKIE))) return;

    // 사람이 보는 화면이면 로그인으로 보낸다. API·WS 에 HTML 을 주면 안 된다.
    if (wantsHtml(request.headers.accept)) {
      return reply.redirect(`/login?next=${encodeURIComponent(request.url)}`, 302);
    }
    return reply
      .code(401)
      .send({ success: false, data: null, error: '접속 암호가 필요합니다. /login 에서 넣으세요.' });
  });

  // ── 정적 파일 ────────────────────────────────────────────────
  await app.register(fastifyStatic, {
    root: paths.publicDir,
    prefix: '/',
    // '/' 는 아래에서 직접 처리한다 (컨트롤 패널 빌드 여부에 따라 갈린다)
    index: false,
    /**
     * 캐시 정책을 명시한다.
     *
     * `cacheControl: false` 는 헤더를 '생략'할 뿐이어서, Last-Modified 만 있으면
     * 브라우저가 휴리스틱 캐싱으로 오래된 파일을 재검증 없이 쓴다.
     * 실제로 이 때문에 갱신된 output.js 가 반영되지 않는 문제를 겪었다.
     *
     * 출력 페이지는 예배 중 새로고침으로 즉시 최신 파일을 받아야 하므로 no-store.
     * Vite 산출물은 파일명에 해시가 있어 영구 캐시가 안전하다.
     */
    setHeaders(res, pathName) {
      const normalized = pathName.split(path.sep).join('/');
      if (normalized.includes('/app/assets/')) {
        res.header('Cache-Control', 'public, max-age=31536000, immutable');
      } else {
        res.header('Cache-Control', 'no-store, must-revalidate');
      }
    },
  });

  /**
   * 배경 그림·동영상. `data/` 안이라 public 밖에 있으므로 따로 붙인다.
   * 이 폴더만 열어 주고, 파일 이름 검증은 배경 라우트가 맡는다.
   *
   * decorateReply: false — sendFile 데코레이터는 위에서 이미 붙였다(두 번 붙이면 기동 실패).
   */
  await app.register(fastifyStatic, {
    root: paths.backgroundsDir,
    prefix: '/backgrounds/',
    decorateReply: false,
    index: false,
    // 배경은 자주 바뀌지 않지만, 같은 이름으로 덮어썼을 때 옛 파일이 남으면
    // '바꿨는데 그대로'가 되므로 재검증하게 둔다
    setHeaders(res) {
      res.header('Cache-Control', 'no-cache, must-revalidate');
    },
  });

  /**
   * 악보 그림 (`data/sheets/<곡집>/NNNN.webp`).
   *
   * 배경과 같은 이유로 따로 붙인다 — `data/` 안이라 `public` 밖이다.
   *
   * **배경과 다른 점: 캐시를 길게 준다.** 악보는 `npm run sheets:convert` 로 한 번
   * 만들고 나면 바뀌지 않고, 한 장이 20~40KB 인데 예배 중 슬라이드를 넘길 때마다
   * 같은 그림을 다시 받으면 프로젝터가 깜박인다. 다시 변환하면 파일이 바뀌므로
   * 그때는 `--force` 뒤 브라우저 새로고침이 필요하다.
   */
  if (existsSync(paths.sheetsDir)) {
    await app.register(fastifyStatic, {
      root: paths.sheetsDir,
      prefix: '/sheets/',
      decorateReply: false,
      index: false,
      setHeaders(res) {
        res.header('Cache-Control', 'public, max-age=86400');
      },
    });
  }

  /**
   * 사용자가 모아 둔 배경 그림 폴더 (`~/Desktop/Data/Background`).
   *
   * **읽기만 한다** — 올리기·삭제·총량 상한은 `data/backgrounds/` 쪽 얘기다.
   * 폴더가 없을 수도 있으므로(다른 PC 에 설치했을 때) 있을 때만 붙인다.
   * 없는데 붙이면 기동이 실패해 예배 준비 자체가 막힌다.
   */
  if (existsSync(paths.backgroundSourceDir)) {
    await app.register(fastifyStatic, {
      root: paths.backgroundSourceDir,
      prefix: '/background-library/',
      decorateReply: false,
      index: false,
      setHeaders(res) {
        res.header('Cache-Control', 'no-cache, must-revalidate');
      },
    });
  }

  const controlPanelBuilt = existsSync(path.join(paths.publicDir, 'app', 'index.html'));

  /**
   * 루트는 컨트롤 패널을 띄운다. 아직 빌드되지 않았다면 안내 페이지로 넘겨
   * '무엇을 실행해야 하는지' 알려준다 — 빈 404 는 처음 설치한 사람을 막는다.
   */
  app.get('/', async (_request, reply) =>
    controlPanelBuilt ? reply.sendFile('app/index.html') : reply.sendFile('index.html'),
  );

  // index:false 로 두었으므로 디렉터리 경로의 index.html 은 직접 연결한다.
  // OBS 가 요청하는 '/output/' 이 여기 걸린다.
  app.get('/output/', async (_request, reply) => reply.sendFile('output/index.html'));

  /**
   * 강사 모니터. OBS 를 거치지 않고 **우리가 직접 띄우는 창**이다 —
   * 설교자 앞 모니터에 전체화면으로 둔다 (2026-08-18, (다)).
   */
  app.get('/stage/', async (_request, reply) => reply.sendFile('stage/index.html'));
  app.get('/stage', async (_request, reply) => reply.redirect('/stage/'));

  /**
   * 프로젝터 화면. 강사 모니터처럼 **우리가 직접 띄우는 창**이지만, 보여 주는 것은
   * 회중용 내용이다 — TV 가 아니라 프로젝터로 띄울 때 쓴다 (2026-08-20 사용자).
   *
   * 출력 페이지의 렌더러를 그대로 쓴다. `public/projector/index.html` 이
   * `/output/output.js` 를 불러오므로, 여기서 따로 줄 것이 없다.
   */
  app.get('/projector/', async (_request, reply) => reply.sendFile('projector/index.html'));
  app.get('/projector', async (_request, reply) => reply.redirect('/projector/'));
  app.get('/app/', async (_request, reply) => reply.sendFile('app/index.html'));

  // 파비콘 요청으로 로그가 지저분해지지 않게 조용히 넘긴다
  app.get('/favicon.ico', async (_request, reply) => reply.code(204).send());

  // ── API ──────────────────────────────────────────────────────
  app.get('/health', async () => ({ ok: true, uptime: process.uptime(), bibleReady }));

  app.get('/api/info', async () => ({
    success: true,
    data: {
      port: options.getPort(),
      outputUrl: `http://localhost:${options.getPort()}/output/?layer=main`,
      controlUrl: `http://localhost:${options.getPort()}/`,
      wsUrl: `ws://localhost:${options.getPort()}/ws`,
      // LAN 에 열려 있을 때만 태블릿 주소를 준다. 닫혀 있는데 주소를 보여 주면
      // '주소는 있는데 접속이 안 된다' 가 된다.
      lanAddresses: lanOpen ? lanHosts().map((h) => `http://${h}:${options.getPort()}/`) : [],
      lanOpen,
      dataDir: paths.dataDir,
      bibleSourceDir: paths.bibleSourceDir,
      bibleReady,
      /** 성경 DB 를 찾은 자리 — 없을 때 '어디에 넣으라' 고 말하려면 필요하다 */
      bibleDb: paths.bibleDb,
      /** 설치한 앱인가 — 화면이 안내 문구를 가려 쓴다 (터미널·저장소가 없다) */
      packaged: isPackagedApp(),
      /**
       * 어느 판인가 (점검 P-7).
       *
       * 판 번호는 빌드마다 바뀌지 않으므로 **만든 시각**이 실제로 두 빌드를
       * 가른다. 받은 사람이 '내 것이 옛 판인가' 를 물을 때 볼 값이다.
       */
      ...appVersion(),
      translationCount: bibleReady ? listTranslations().length : 0,
      songCount: countSongs(),
      planCount: countPlans(),
      defaultTranslation: DEFAULT_PRIMARY_TRANSLATION,
      connections: options.getConnections?.() ?? { control: 0, output: 0 },
    },
    error: null,
  }));

  registerLoginRoutes(app);
  registerSystemRoutes(app);
  registerTabletRoutes(app, options.getPort, () => lanOpen);
  registerDataPackRoutes(app);
  await registerSongRoutes(app);
  await registerSongbookRoutes(app);
  await registerPlanRoutes(app);
  await registerReadingRoutes(app);
  await registerBackupRoutes(app);
  await registerBackgroundRoutes(app);

  await registerTemplateRoutes(app, {
    onTemplateChanged: (template) => options.onTemplateChanged?.(template),
    currentTemplateId: () => getState().templateId,
  });

  app.get('/api/template/current', async () => ({
    success: true,
    data: getTemplateOrDefault(getState().templateId),
    error: null,
  }));

  if (bibleReady) {
    await registerBibleRoutes(app, DEFAULT_PRIMARY_TRANSLATION);
  } else {
    app.get('/api/bible/*', async (_request, reply) =>
      reply.code(503).send({
        success: false,
        data: null,
        error: bibleMissingMessage(paths.bibleDb),
      }),
    );
  }

  return { app, bibleReady, stateRestored };
}

// `lanHosts`·`lanInterfaces` 는 server/lan.ts 로 옮겼다. 기존 import 를 위해 다시 내보낸다.
export { lanHosts, lanInterfaces };
