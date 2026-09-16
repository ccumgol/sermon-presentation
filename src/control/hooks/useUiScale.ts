import { useCallback, useEffect, useState } from 'react';

/**
 * 관리자 패널 글자 크기 (사용자 요청 2026-09-16).
 *
 * ## 왜 필요한가
 *
 * 슬라이드 목록의 본문 글씨가 13px 이다. 화면을 넓게 쓰려고 작게 잡은 값인데,
 * **방송실에서 교대로 앉는 사람마다 눈이 다르다.** 준비할 때는 괜찮다가도
 * 예배 중에 급히 확인할 때 안 보이면 그게 사고로 이어진다.
 *
 * ## 왜 `zoom` 인가
 *
 * `styles.css` 의 글자 크기가 **전부 px 로 박혀 있다**(150곳 넘음). 뿌리 글꼴 크기를
 * 키우는 방식(rem)을 쓰려면 그걸 전부 바꿔야 하는데, 한 곳만 놓쳐도 그 칸만 안 커진다.
 *
 * `zoom` 은 **레이아웃을 다시 계산한다** — `transform: scale` 과 다른 점이다.
 * scale 은 그려진 것만 늘려서 줄바꿈이 그대로고 스크롤 범위가 어긋나지만,
 * zoom 은 글자가 커진 만큼 줄이 다시 나뉘고 스크롤도 맞는다.
 *
 * **`:root` 에 건다.** `.app` 은 `height: 100%` 이라 거기 걸면 뷰포트를 넘쳐
 * 창 전체에 스크롤바가 생긴다. 뿌리에 걸면 브라우저가 기준 상자(ICB)를 함께
 * 조정하므로 `100%` 도 `vh` 도 그대로 맞는다.
 *
 * ## localStorage 에 둔다
 *
 * `useTheme` 과 같은 이유다 — 서버 설정이 아니라 **이 PC 의 취향**이다.
 * 방송실 모니터와 준비용 랩탑이 같아야 할 이유가 없다.
 */

/** 고를 수 있는 배율 (%). 100 이 지금까지의 크기다 */
export const UI_SCALES = [100, 115, 130, 150] as const;

export type UiScale = (typeof UI_SCALES)[number];

const KEY = 'sermon.uiScale';
const DEFAULT: UiScale = 100;

function isUiScale(value: number): value is UiScale {
  return (UI_SCALES as readonly number[]).includes(value);
}

function readStored(): UiScale {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === null) return DEFAULT;
    const parsed = Number(raw);
    if (isUiScale(parsed)) return parsed;
  } catch {
    // 사생활 보호 모드 등에서 막힐 수 있다 — 그때는 기본값으로 둔다
  }
  return DEFAULT;
}

export function useUiScale(): {
  scale: UiScale;
  setScale: (next: UiScale) => void;
  /** 다음 크기로. 마지막이면 처음으로 돌아온다 — 단추 하나로 다 돌 수 있게 */
  cycle: () => void;
} {
  const [scale, setStored] = useState<UiScale>(readStored);

  const setScale = useCallback((next: UiScale) => {
    setStored(next);
    try {
      localStorage.setItem(KEY, String(next));
    } catch {
      // 저장에 실패해도 이번 세션에는 적용된다
    }
  }, []);

  const cycle = useCallback(() => {
    const at = UI_SCALES.indexOf(scale);
    setScale(UI_SCALES[(at + 1) % UI_SCALES.length] ?? DEFAULT);
  }, [scale, setScale]);

  /**
   * 100% 면 **변수를 지운다.** CSS 의 기본값(`1`)이 살아나므로, 한 번도 만지지 않은
   * 사람에게는 `zoom` 자체가 없던 때와 똑같이 그려진다.
   */
  useEffect(() => {
    const root = document.documentElement;
    if (scale === DEFAULT) root.style.removeProperty('--ui-scale');
    else root.style.setProperty('--ui-scale', String(scale / 100));
  }, [scale]);

  return { scale, setScale, cycle };
}
