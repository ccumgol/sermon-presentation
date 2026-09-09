import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

const repoRoot = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  test: {
    /**
     * `.tsx` 도 받는다 — `src/`(React) 검사가 JSX 를 쓴다 (2026-09-07).
     * 넓히지 않으면 `.test.tsx` 파일이 **조용히 실행되지 않는다** (실제로 겪었다:
     * "No test files found" 만 나온다).
     */
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    environment: 'node',
    /**
     * 테스트는 사용자 데이터를 절대 건드리지 않는다.
     * app.sqlite 는 임시 폴더로 보내고, 성경 DB 만 실제 파일을 읽기 전용으로 쓴다.
     */
    env: {
      SERMON_DATA_DIR: path.join(repoRoot, '.test-data'),
      SERMON_BIBLE_DB: path.join(repoRoot, 'data', 'bible.sqlite'),
    },
    /**
     * 테스트 파일을 직렬로 돌린다.
     *
     * 통합 테스트들이 같은 app.sqlite·songs.sqlite 를 열고 스키마를 만들기 때문에,
     * 병렬로 돌리면 두 워커가 동시에 CREATE TABLE 을 시도해 깨진다.
     * 전체 실행이 1초 미만이라 직렬로 두는 비용이 사실상 없다.
     */
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      /**
       * `src/`(React)도 **재기 시작한다** (2026-09-07).
       *
       * 전에는 `lib/`·`server/` 만 재서, 검수 리포트가 '가장 큰 빚' 으로 지목한
       * `src/` 커버리지 0 이 **숫자로 보이지 않았다.** 재지 않으면 늘지도 않는다.
       */
      include: ['lib/**/*.ts', 'server/**/*.ts', 'src/**/*.ts', 'src/**/*.tsx'],
      exclude: ['src/**/*.d.ts', 'src/control/main.tsx'],
      /**
       * 문턱을 **묶음별로** 준다.
       *
       * `src/**` 만 따로 주고 전역 값을 두면, 이 판(vitest 4)에서는 `src/` 가
       * 전역 계산에도 **함께 들어가** 전역이 80% → 54% 로 떨어져 늘 실패한다
       * (실측). 그래서 `lib/`·`server/` 에도 같은 값을 명시해 전역을 비워 둔다.
       */
      thresholds: {
        /*
         * 값은 **실측한 지금 값보다 조금 낮게** 잡는다 (ratchet). 목적은 '내려가지
         * 않게 막는 것' 이다 — 닿을 수 없는 목표를 걸면 `--coverage` 가 늘 실패해서
         * 아무도 쳐다보지 않게 된다.
         *
         * 2026-09-08 실측: lib 줄 98.1 · server 문장 79.5 · src 문장 25.7
         *
         * server/ 는 2026-09-08 에 두 번 올랐다:
         *   · `ws.ts` 통합 검사 — 문장 77.5 → 79.5 (`ws.ts` 자체 57.3 → 86.0).
         *     예배 중 화면이 도는 통로다.
         *   · 곡집 검사 — 문장 79.5 → **85.1** (`db/songbooks` 36.7 → 96.7 ·
         *     `routes/songbooks` 36.5 → 97.6). 되돌릴 수 없는 사용자 데이터를 쓰는 길이다.
         *
         * 2026-09-09 에 한 번 더 올랐다 — 문장 85.1 → **86.9**, 분기 78.5 → **80.4**:
         *   `routes/tablet` 36.4 → 100 (태블릿을 여는 유일한 길인데 **QR 을 만드는 줄이
         *   한 번도 안 밟혔다**) · `db/readings` 76.8 → 97.1 (스키마 이전) ·
         *   `routes/backgrounds` 75.9 → 94.3 (분기 51.1 → 97.4) · `lan` 65.6 → 93.8.
         *
         * ⚪ `routes/system.ts` 는 74.3 에서 멈춘다 — **일부러 그렇다.** 남은 줄은
         * 실제로 Finder 창을 띄우거나 `brew install` 을 돌려야 밟힌다. 검사가 남의
         * 프로그램을 설치하게 둘 수는 없다. 판단(어느 명령·허용된 명령인가)은
         * `lib/env-check.ts` 로 옮겨 세 플랫폼 모두 검사한다.
         *
         * ⚠️ `server/` 가 80% 아래인 것은 새로 생긴 일이 아니다. 전에는 `lib/` 와
         * 한 덩이로 재서 평균 86% 로 통과했고, **낮은 쪽이 가려져 있었다.**
         * 나눠서 재기 시작하니 드러났다.
         */
        'lib/**': { lines: 95, functions: 95, branches: 88, statements: 94 },
        'server/**': { lines: 87, functions: 88, branches: 79, statements: 86 },
        /**
         * `src/` 는 **낮은 데서 올려 가는 문턱**이다 (ratchet).
         *
         * 지금 값(2026-09-08 실측: 문장 37.9%)보다 조금 낮게 잡아 두고, 검사를
         * 더할 때마다 올린다.
         *
         * 예배 순서 탭은 훅 90% 대 + 갈라낸 화면 컴포넌트 60~100% 다:
         *   usePlanStorage 98 · usePlanAdd 97 · usePlanSend 94 · usePlanPreview 94 ·
         *   PlanLoadList 100 · PlanHead 92 · PlanAddBar 92 · PlanDefaultsCard 91 ·
         *   PlanActions 82 · PlanCueList 79 · **PlanItemEditor 60**
         *
         * PlanItemEditor 는 732줄에 종류별 블록이 열이라 한 번에 100% 가 되지
         * 않는다. 주요 종류(구분·찬양·성경·순서 표시·교독문·전례문)를 덮었고,
         * 남은 것은 전례문 본문 덮어쓰기 편집기다.
         *
         * 찬양 탭은 훅으로 갈랐다(2026-09-08): useSongSearch 100 · useSongEditor 95.
         * `SongPanel` 자체는 0% 인데, 위험한 규칙(빈 가사 덮어쓰기 방지·삭제 확인·
         * 악보 보기 초기화)이 전부 훅으로 내려가 검사가 붙었다.
         *
         * 남은 것은 **아직 검사가 없는 화면들**이다 — BiblePanel · SongPanel(JSX) ·
         * TemplatePanel · SongbookManager 등.
         */
        'src/**': { lines: 37, functions: 31, branches: 34, statements: 37 },
      },
    },
  },
});
