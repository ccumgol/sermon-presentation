/**
 * PDF 를 **쪽마다 그림으로** 바꾼다 (2026-10-03 사용자 결정).
 *
 * ## 왜 조작 화면에서 하나
 *
 * 서버(Node)에서 PDF 를 래스터화하려면 **네이티브 canvas** 가 필요하다. 그러면
 * 이 저장소의 «빌드 없음 · 런타임 의존성 다섯» 이 깨지고, 맥·윈도우 양쪽에
 * 컴파일된 모듈을 실어야 한다. **조작 화면은 이미 크로미움이다** — 거기서 그린다.
 *
 * `pdfjs-dist` 는 **devDependency** 다. Vite 가 번들에 묻으므로 서버 런타임
 * 의존성은 다섯 그대로이고, **출력 페이지의 의존성 0 도 그대로**다.
 *
 * ## 왜 WebP 인가
 *
 * 선교보고는 사진이 많다. 같은 쪽을 PNG 로 두면 서너 배가 된다 — 그 용량이
 * 자료 꾸러미와 백업에 그대로 얹힌다.
 */

import { MAX_DECK_PAGES } from '../../lib/deck-files.ts';

/** 긴 변 기준. 1920 이면 프로젝터·OBS 어디에 내도 충분하고 용량이 과하지 않다 */
const TARGET_WIDTH = 1920;

/** 0~1. 0.82 는 사진 슬라이드에서 눈에 띄는 손상 없이 확실히 작아지는 값이다 */
const QUALITY = 0.82;

export interface PageImage {
  page: number;
  /** 순수 base64 (앞의 `data:...;base64,` 는 떼어 낸 것) */
  data: string;
  bytes: number;
}

export interface ConvertProgress {
  page: number;
  total: number;
}

/**
 * `pdfjs-dist` 를 **쓸 때 불러온다.**
 *
 * 맨 위에서 import 하면 PDF 를 한 번도 안 쓰는 사람도 번들을 내려받는다 —
 * 예배 순서 탭을 여는 것이 느려진다. 동적 import 면 Vite 가 따로 떼어 둔다.
 */
async function loadPdfjs() {
  const pdfjs = await import('pdfjs-dist');
  /*
   * 작업자(worker)를 **번들 안의 것**으로 가리킨다. 기본값은 CDN 을 보는데,
   * 이 앱은 **인터넷 없이 예배당에서 돈다** — 그러면 조용히 실패한다.
   */
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.mjs',
    import.meta.url,
  ).toString();
  return pdfjs;
}

function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('쪽 그림을 읽지 못했습니다'));
    reader.onload = () => {
      const text = String(reader.result);
      // `data:image/webp;base64,AAAA` → `AAAA`
      const at = text.indexOf(',');
      resolve(at < 0 ? text : text.slice(at + 1));
    };
    reader.readAsDataURL(blob);
  });
}

/**
 * PDF 주소를 받아 쪽마다 그림을 만든다.
 *
 * **한 쪽씩 돌려준다**(`onPage`). 전부 모아 두면 100쪽짜리가 메모리에 한꺼번에
 * 올라가고, 중간에 끊기면 아무것도 남지 않는다.
 */
export async function convertPdf(
  url: string,
  onPage: (image: PageImage, progress: ConvertProgress) => Promise<void>,
  onProgress?: (progress: ConvertProgress) => void,
): Promise<number> {
  const pdfjs = await loadPdfjs();
  /*
   * 작업(task)을 들고 있는다. **문서가 아니라 이쪽에 `destroy` 가 있다** —
   * 다 쓰고 놓지 않으면 작업자 스레드가 남아, 여러 번 바꾸면 쌓인다.
   */
  const task = pdfjs.getDocument({ url });
  const doc = await task.promise;

  try {
    const total = Math.min(doc.numPages, MAX_DECK_PAGES);
    if (doc.numPages > MAX_DECK_PAGES) {
      throw new Error(`쪽이 너무 많습니다 (${doc.numPages}쪽 · 상한 ${MAX_DECK_PAGES}쪽)`);
    }

    for (let page = 1; page <= total; page += 1) {
      const rendered = await doc.getPage(page);
      // 원래 크기를 재서 목표 폭에 맞춘다 — 4:3 이든 16:9 든 긴 변을 맞춘다
      const base = rendered.getViewport({ scale: 1 });
      const viewport = rendered.getViewport({ scale: TARGET_WIDTH / base.width });

      const canvas = document.createElement('canvas');
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      const context = canvas.getContext('2d');
      if (!context) throw new Error('이 브라우저에서 PDF 를 그릴 수 없습니다');

      /*
       * **흰 바탕을 먼저 칠한다.** PDF 쪽은 대개 배경이 투명한데, 그대로 WebP 로
       * 만들면 글자만 떠서 OBS 의 카메라 영상 위에 겹쳐 나간다.
       */
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      await rendered.render({ canvas, canvasContext: context, viewport }).promise;

      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, 'image/webp', QUALITY),
      );
      if (!blob) throw new Error(`${page}쪽을 그림으로 만들지 못했습니다`);

      const data = await toBase64(blob);
      await onPage({ page, data, bytes: blob.size }, { page, total });
      onProgress?.({ page, total });

      // 다 쓴 쪽은 바로 놓는다 — 100쪽짜리가 메모리에 쌓이지 않게
      rendered.cleanup();
      canvas.width = 0;
      canvas.height = 0;
    }

    return total;
  } finally {
    await doc.cleanup();
    await task.destroy();
  }
}
