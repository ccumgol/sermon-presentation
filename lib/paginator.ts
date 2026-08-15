/**
 * 자동 분할 — 실측 높이를 기준으로 절을 화면에 담는다.
 *
 * 서버가 글자 수로 추정하지 않는다. 폰트·자간·행간·안전 영역이 모두 얽혀 있어
 * 추정은 반드시 틀리기 때문이다. 컨트롤 패널이 실제 출력 페이지(1920×1080)를
 * 숨긴 iframe 으로 띄워 재고, 그 결과로 나눈다 (계획서 §11).
 *
 * 이 모듈은 측정 함수를 주입받는 순수 로직이라 테스트로 고정할 수 있다.
 */

import type { Passage, PassageBlock, SlidePayload, Verse } from '../shared/types.ts';

/** 슬라이드 하나를 재는 함수. 넘치면 overflow=true. */
export type MeasureFn = (slide: SlidePayload) => Promise<{ overflow: boolean; height: number }>;

/** 한 화면에 담을 절 수의 상한 — 측정이 계속 '맞다'고 해도 이 이상 넣지 않는다 */
const MAX_VERSES_PER_SLIDE = 12;

function verseKey(v: Pick<Verse, 'book' | 'chapter' | 'verse'>): string {
  return `${v.book}:${v.chapter}:${v.verse}`;
}

function pickReferenceBlock(blocks: PassageBlock[]): PassageBlock | undefined {
  return blocks.find((b) => !b.unavailable && b.verses.length > 0);
}

/**
 * 절 키 묶음으로 슬라이드를 만든다.
 *
 * **병합 절 처리**: 보조 역본에 해당 절이 없으면(역본마다 절 분할이 다름)
 * 그 역본에서는 앞 절에 내용이 합쳐져 있다는 뜻이다. 이때 보조 블록의 절 범위를
 * 주 역본 범위에 맞춰 '앞으로 당겨' 잡으면 같은 내용이 두 화면에 겹쳐 나온다.
 * 그래서 없는 절은 그냥 비워 둔다 — 겹쳐 보이는 것보다 낫다.
 */
export function slideFromKeys(
  passage: Passage,
  keys: string[],
  options: { includeHeading: boolean },
): SlidePayload {
  const keySet = new Set(keys);
  const blocks: PassageBlock[] = passage.blocks.map((block) => ({
    ...block,
    verses: block.verses.filter((v) => keySet.has(verseKey(v))),
  }));

  return {
    kind: 'bible',
    reference: passage.referenceAbbr,
    blocks,
    ...(options.includeHeading && passage.heading ? { heading: passage.heading } : {}),
  };
}

export interface PaginateResult {
  slides: SlidePayload[];
  /** 한 절만으로도 화면을 넘긴 슬라이드 수 — 컨트롤 패널이 안내에 쓴다 */
  overflowing: number;
}

/**
 * 절을 하나씩 더해 가며 넘치기 직전까지 담는다.
 *
 * 측정 호출 수는 절 수에 비례한다(장 전체 150절이면 최대 150회 남짓).
 * iframe 안에서 동기 렌더 + scrollHeight 읽기라 한 번에 1ms 내외이므로
 * 실사용에서 체감되지 않는다. 이분 탐색은 "절을 더 넣으면 항상 더 높아진다"는
 * 단조성이 성립하지 않는 경우(짧은 절이 줄을 채우지 못할 때)가 있어 쓰지 않는다.
 */
export async function paginateByMeasure(passage: Passage, measure: MeasureFn): Promise<PaginateResult> {
  const reference = pickReferenceBlock(passage.blocks);
  if (!reference) return { slides: [], overflowing: 0 };

  const allKeys = reference.verses.map(verseKey);
  const slides: SlidePayload[] = [];
  let overflowing = 0;

  let index = 0;
  while (index < allKeys.length) {
    const isFirst = slides.length === 0;
    let taken = 1;
    let best: SlidePayload = slideFromKeys(passage, allKeys.slice(index, index + 1), {
      includeHeading: isFirst,
    });

    const firstMeasure = await measure(best);
    if (firstMeasure.overflow) {
      // 한 절만으로도 넘친다 — 더 줄일 수 없으므로 그대로 내보내고 기록한다.
      // 출력 페이지의 autoFit 이 배율로 줄여 최대한 담아 준다.
      overflowing++;
    } else {
      // 넘치기 직전까지 절을 늘린다
      while (index + taken < allKeys.length && taken < MAX_VERSES_PER_SLIDE) {
        const candidate = slideFromKeys(passage, allKeys.slice(index, index + taken + 1), {
          includeHeading: isFirst,
        });
        const result = await measure(candidate);
        if (result.overflow) break;
        best = candidate;
        taken++;
      }
    }

    slides.push(best);
    index += taken;
  }

  return { slides, overflowing };
}

/**
 * 고정 개수로 나눈다 (1절씩·2절씩·전체). 측정이 필요 없는 경로다.
 * 자동 분할을 쓸 수 없는 환경(미리보기 iframe 미준비)의 대비책이기도 하다.
 */
export function paginateFixed(passage: Passage, versesPerSlide: number): PaginateResult {
  const reference = pickReferenceBlock(passage.blocks);
  if (!reference) return { slides: [], overflowing: 0 };

  const allKeys = reference.verses.map(verseKey);
  const size = Number.isFinite(versesPerSlide) && versesPerSlide > 0 ? versesPerSlide : allKeys.length;

  const slides: SlidePayload[] = [];
  for (let i = 0; i < allKeys.length; i += size) {
    slides.push(slideFromKeys(passage, allKeys.slice(i, i + size), { includeHeading: slides.length === 0 }));
  }
  return { slides, overflowing: 0 };
}
