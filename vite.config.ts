import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * 컨트롤 패널 빌드 설정.
 *
 * Vite 개발 서버를 따로 띄우지 않고 `public/app/` 으로 정적 빌드한 뒤
 * Fastify 가 서빙한다. 그래야 포트가 하나로 유지되고(태블릿 접속·OBS URL 안내가
 * 단순해진다) Electron 패키징도 정적 파일 복사로 끝난다.
 *
 * 개발 중에는 `npm run dev` 가 `vite build --watch` 를 함께 돌린다.
 */
export default defineConfig({
  root: fileURLToPath(new URL('./src/control', import.meta.url)),
  base: '/app/',
  plugins: [react()],
  build: {
    outDir: fileURLToPath(new URL('./public/app', import.meta.url)),
    emptyOutDir: true,
    // 예배 중 문제를 추적할 수 있어야 한다
    sourcemap: true,
  },
});
