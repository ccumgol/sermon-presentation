import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

const repoRoot = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
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
      include: ['lib/**/*.ts', 'server/**/*.ts'],
      // 파서·페이지네이터 등 순수 로직은 계획서(§10)상 90% 목표
      thresholds: { lines: 80, functions: 80, branches: 75, statements: 80 },
    },
  },
});
