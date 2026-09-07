/**
 * **항목 하나를 슬라이드로 푸는 것** — 예배 순서 탭의 미리보기.
 *
 * `PlanPanel` 에서 떼어냈다(2026-09-07). 떼어낸 이유는 줄 수가 아니라 **검사**다:
 * `resolveItem` 은 **무엇이 화면에 나갈지 정하는 함수**인데 2,549줄짜리 컴포넌트
 * 안에 있어서 화면을 다 띄우지 않고는 부를 수 없었다.
 *
 * ## 지키는 것
 *
 * | | 왜 |
 * |---|---|
 * | 푼 결과를 **송출하지 않는다** | 선택과 송출은 갈라져 있다. 눌렀다고 나가면 예배 중에 사고가 난다 |
 * | 실패를 `error` 로 **돌려준다**(던지지 않는다) | 오퍼레이터가 왜 비었는지 알아야 한다 |
 * | 항목 **내용**이 바뀌면 다시 푼다 | `id` 만 보면 판본을 바꿔도 미리보기가 그대로라 안 먹힌 것처럼 보인다 |
 * | 실패하면 앞의 슬라이드를 **지운다** | 남겨 두면 엉뚱한 것을 송출한다 |
 * | 표시 여부·꾸밈은 **실어 보내기만** 한다 | 결정은 출력 페이지가 한다 — 여기서 풀면 템플릿만 바꿨을 때 따라오지 않는다 |
 */

import { useCallback, useEffect, useState } from 'react';

import { splitOrderText } from '../../../lib/plan-deck.ts';
import { quoteSlides } from '../../../lib/verse-quotes.ts';
import { paginateByMeasure } from '../../../lib/paginator.ts';
import { textVariantLabel } from '../../../lib/plan-item-view.ts';
import {
  DEFAULT_LITURGY_PER_SLIDE,
  liturgyLines,
  liturgySlides,
} from '../../../lib/liturgy-texts.ts';
import type { CueItem, SlidePayload, Template } from '../../../shared/types.ts';
import { api, ApiError } from '../api.ts';
import { useMeasure } from './useMeasure.ts';

/** 푼 결과. `error` 가 있어도 `slides` 는 항상 배열이다 — 화면이 분기를 덜 한다 */
export interface Resolved {
  slides: SlidePayload[];
  labels: string[];
  error?: string;
}

export interface PlanPreview {
  /** 항목 하나를 슬라이드로 푼다. **던지지 않는다** — 실패는 `error` 로 온다 */
  resolveItem: (item: CueItem) => Promise<Resolved>;
  /** 펼친 항목을 푼 결과 (아무것도 펼치지 않았으면 `null`) */
  preview: { slides: SlidePayload[]; labels: string[] } | null;
  previewError: string | null;
  /** 항목마다 지정할 수 있는 표시 템플릿 (예배 유형 목록과 다른 것) */
  styleTemplates: Template[];
}

export function usePlanPreview(options: {
  items: readonly CueItem[];
  /** 지금 펼친 항목 — 이것만 미리 푼다 */
  expandedId: string | null;
  /** 지금 화면이 쓰는 템플릿 — 자동 분할에 글자 크기가 필요하다 */
  template: Template | null;
}): PlanPreview {
  const { items, expandedId, template } = options;

  const [preview, setPreview] = useState<{ slides: SlidePayload[]; labels: string[] } | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [styleTemplates, setStyleTemplates] = useState<Template[]>([]);

  const measurer = useMeasure();
  const maxChars = template?.behavior.maxCharsPerLine;

  const resolveItem = useCallback(
    async (item: CueItem): Promise<Resolved> => {
      if (item.type === 'bible') {
        const passage = await api.passage(item.ref, [item.primary, ...item.secondary], item.paging ?? 'verse');
        if (!passage.parse.ok) return { slides: [], labels: [], error: passage.parse.message };
        if (!passage.passage || !passage.deck) return { slides: [], labels: [], error: '본문을 찾지 못했습니다' };

        /*
         * 항목이 정한 표시 여부를 슬라이드마다 실어 보낸다.
         *
         * **결정은 출력 페이지가 한다** — 여기서 풀어 담으면 나중에 템플릿만 바꿨을 때
         * 그 값이 따라오지 않는다. 여기서는 항목의 뜻을 전달만 한다.
         */
        const withDisplay = (slides: SlidePayload[]): SlidePayload[] =>
          item.display === undefined && item.style === undefined
            ? slides
            : slides.map((slide) =>
                slide.kind === 'bible'
                  ? {
                      ...slide,
                      ...(item.display ? { display: item.display } : {}),
                      ...(item.style ? { style: item.style } : {}),
                    }
                  : slide,
              );

        /*
         * 인용구는 **참조를 본문 앞에 붙인다** — `고전 1:3 하나님 우리 아버지와…`.
         *
         * 네 화면(관리자 목록·OBS·강사 모니터·프로젝터)이 서로 다른 렌더러를 쓰는데,
         * 참조를 별개 요소로 두면 규칙이 넷이 되어 다시 어긋난다 (사용자 지적
         * 2026-08-20). 글자로 넣으면 네 화면이 그것을 '본문' 으로 받아 저절로 같아진다.
         *
         * 접두사는 **항목의 `ref`** 다 — 목록 줄(`describeItem`)과 글자까지 같아진다.
         * 본문 낭독(성경 항목)은 `item.quote` 가 없어 이 길로 오지 않는다.
         */
        const finish = (slides: SlidePayload[]): SlidePayload[] =>
          item.quote ? quoteSlides(withDisplay(slides), item.ref, item.display?.reference !== false) : withDisplay(slides);

        if ((item.paging ?? 'verse') === 'auto') {
          const paginated = await paginateByMeasure(passage.passage, (slide) =>
            measurer.measure(slide, template ?? undefined),
          );
          if (paginated.slides.length > 0) {
            return {
              slides: finish(paginated.slides),
              labels: paginated.slides.map((_, i) => `${i + 1}`),
            };
          }
        }
        return { slides: finish(passage.deck.slides), labels: passage.deck.labels };
      }

      if (item.type === 'song') {
        // 악보는 항목이 켠 것만 — 기본은 가사다 (2026-09-04 사용자 결정)
        const songDeck = await api.songDeck(
          item.songId, item.langs, item.lines ?? '2', undefined, maxChars, item.sheet === true,
        );
        const slides =
          item.display === undefined && item.style === undefined
            ? songDeck.deck.slides
            : songDeck.deck.slides.map((slide) =>
                slide.kind === 'song'
                  ? {
                      ...slide,
                      ...(item.display ? { display: item.display } : {}),
                      ...(item.style ? { style: item.style } : {}),
                    }
                  : slide,
              );
        return { slides, labels: songDeck.deck.labels };
      }

      if (item.type === 'text') {
        // 순서 표시는 기본이 좌우 나누기 — 왼쪽 순서 이름, 오른쪽 담당자
        if (item.variant === 'order' && item.layout !== 'stack') {
          return {
            slides: [
              {
                kind: 'order',
                ...splitOrderText(item.content),
                ...(item.charStyles ? { charStyles: item.charStyles } : {}),
                ...(item.presenterScale !== undefined ? { presenterScale: item.presenterScale } : {}),
                ...(item.titleStroke !== undefined ? { titleStroke: item.titleStroke } : {}),
                ...(item.presenterStroke !== undefined ? { presenterStroke: item.presenterStroke } : {}),
              },
            ],
            labels: ['순서 표시'],
          };
        }
        const lines = item.content.split(/\r?\n/).filter((line) => line.trim().length > 0);
        return { slides: [{ kind: 'text', lines }], labels: [textVariantLabel(item.variant)] };
      }

      /*
       * 슬라이드쇼 — 폴더를 **띄울 때** 읽는다.
       *
       * 순서표에는 폴더만 담겨 있다. 그림 이름을 담아 두면 나중에 파일을 더 넣어도
       * 순서표를 고쳐야 하는데, '폴더에 넣기만 하면 되는 것' 이 이 기능의 요점이다.
       */
      if (item.type === 'slideshow') {
        const { files } = await api.slideshow(item.source, item.folder);
        if (files.length === 0) {
          return { slides: [], labels: [], error: `폴더에 그림이 없습니다 (${item.folder || '기본 폴더'})` };
        }
        return {
          slides: files.map((file) => ({
            kind: 'image' as const,
            src: file.url,
            alt: file.name,
            ...(item.fit === 'cover' ? { fit: 'cover' as const } : {}),
          })),
          labels: files.map((file) => file.name.replace(/\.[^.]+$/, '')),
        };
      }

      if (item.type === 'liturgy') {
        const lines = liturgyLines(item.textId, item.version, item.overrideLines);
        if (!lines) return { slides: [], labels: [], error: '본문을 찾지 못했습니다' };

        const pages = liturgySlides(lines, item.perSlide ?? DEFAULT_LITURGY_PER_SLIDE);
        return {
          slides: pages.map((page) => ({
            kind: 'text' as const,
            lines: [...page],
            ...(item.background ? { background: item.background } : {}),
            ...(item.style ? { style: item.style } : {}),
          })),
          labels: pages.map((_, index) => `${index + 1}`),
        };
      }

      if (item.type === 'reading') {
        try {
          const reading = await api.reading(item.readingNumber, item.readingBook);
          if (reading.slides.length === 0) {
            return { slides: [], labels: [], error: '본문이 비어 있습니다' };
          }
          return {
            slides: reading.slides.map((slide) => ({
              kind: 'reading' as const,
              leader: slide.leader,
              ...(slide.people !== undefined ? { people: slide.people } : {}),
              reference: reading.title,
              ...(item.background ? { background: item.background } : {}),
              ...(item.style ? { style: item.style } : {}),
            })),
            labels: reading.slides.map((_, index) => `${index + 1}`),
          };
        } catch (err) {
          // 가져오기를 안 한 PC 면 여기로 온다 — 조용히 빈 화면을 내보내지 않는다
          return {
            slides: [],
            labels: [],
            error: err instanceof ApiError ? err.message : '교독문을 불러오지 못했습니다',
          };
        }
      }

      if (item.type === 'blank') return { slides: [{ kind: 'blank' }], labels: ['공백'] };

      // 구분은 슬라이드가 없다 (buildPlanDeck 도 건너뛴다)
      return { slides: [], labels: [] };
    },
    [measurer, template, maxChars],
  );

  // 펼친 항목을 풀어 슬라이드 줄로 보여 준다. **송출하지 않는다.**
  const expandedItem = items.find((item) => item.id === expandedId);
  /**
   * 항목 **내용**이 바뀌어도 다시 풀어야 한다.
   *
   * 전에는 `id` 만 봤다. 그래서 판본이나 화면 넘김을 바꿔도 미리보기가 그대로라
   * 방금 만진 설정이 먹히지 않은 것처럼 보였다. 항목 하나를 직렬화하는 비용은
   * 무시할 만하고, 이 값이 같으면 결과도 같다.
   */
  const expandedSignature = expandedItem ? JSON.stringify(expandedItem) : null;
  useEffect(() => {
    if (!expandedItem) {
      setPreview(null);
      setPreviewError(null);
      return;
    }

    let cancelled = false;
    setPreviewError(null);
    void resolveItem(expandedItem)
      .then((result) => {
        if (cancelled) return;
        setPreview({ slides: result.slides, labels: result.labels });
        setPreviewError(result.error ?? null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        // 이전 항목의 슬라이드를 남겨 두면 오퍼레이터가 엉뚱한 것을 송출한다
        setPreview(null);
        setPreviewError(err instanceof ApiError ? err.message : '불러오지 못했습니다');
      });

    return () => {
      cancelled = true;
    };
  }, [expandedSignature, resolveItem]);

  // 템플릿 목록 — 항목마다 지정할 수 있게 이름을 보여 준다
  useEffect(() => {
    void api
      .templates()
      .then(setStyleTemplates)
      .catch(() => setStyleTemplates([]));
  }, []);
  return { resolveItem, preview, previewError, styleTemplates };
}
