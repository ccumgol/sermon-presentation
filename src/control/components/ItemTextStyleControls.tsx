/**
 * 교독문·전례문의 **폰트와 글자 크기** 조절 칸.
 *
 * `PlanPanel.tsx` 에서 떼어냈다 (검토 2026-08-22 R-4).
 */

import type React from 'react';

import { CHAR_WIDTH_EM, SAFE_WIDTH_PX, wrapsAtScale } from '../../../lib/plan-item-view.ts';
import type { ItemTextStyle } from '../../../shared/types.ts';

export function ItemTextStyleControls({
  value,
  onChange,
  longestLineChars,
  baseFontSize,
  showScale = true,
}: {
  value: ItemTextStyle | undefined;
  onChange: (next: ItemTextStyle | undefined) => void;
  /** 이 항목 본문의 가장 긴 줄 글자 수 — 줄 감김 어림에 쓴다 */
  longestLineChars?: number;
  /** 템플릿의 기본 글자 크기 */
  baseFontSize?: number;
  /**
   * 글자 크기 조절을 보일지.
   *
   * 성경·찬양에서는 **감춘다.** 본문 길이가 매번 달라 자동 축소가 개입하므로,
   * 크기를 항목마다 주면 요청한 값과 화면이 달라져 무엇이 이겼는지 알기 어렵다.
   * 교독문·전례문은 본문이 정해져 있어 크기를 예측할 수 있다.
   */
  showScale?: boolean;
}): React.JSX.Element {
  const font = value?.font ?? 'sans';
  const scale = value?.scale ?? 1;

  /** 빈 설정은 아예 지운다 — 기본값이 박히면 나중에 기본을 바꿀 수 없다 */
  function patch(next: ItemTextStyle): void {
    const cleaned: ItemTextStyle = {
      ...(next.font && next.font !== 'sans' ? { font: next.font } : {}),
      ...(next.scale !== undefined && next.scale !== 1 ? { scale: next.scale } : {}),
    };
    onChange(Object.keys(cleaned).length > 0 ? cleaned : undefined);
  }

  return (
    <>
      <label>폰트</label>
      <div className="toggle-row">
        {([
          ['sans', '고딕'],
          ['serif', '명조'],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            type="button"
            className={`toggle${font === key ? ' active' : ''}`}
            onClick={() => patch({ ...value, font: key })}
          >
            {label}
          </button>
        ))}
      </div>

      {showScale && (
        <>
          <label title="템플릿 크기에 곱합니다. 행간은 그대로 유지됩니다.">글자 크기</label>
          <input
            type="range"
            min={0.6}
            max={2}
            step={0.05}
            value={scale}
            onChange={(e) => patch({ ...value, scale: Number(e.target.value) })}
          />
          <span className="muted">{Math.round(scale * 100)}%</span>
          {scale !== 1 && (
            <button type="button" className="reset" onClick={() => patch({ ...value, scale: 1 })} title="기본 크기로">
              ↺
            </button>
          )}

          {longestLineChars !== undefined &&
            baseFontSize !== undefined &&
            wrapsAtScale(longestLineChars, baseFontSize, value) && (
              <span className="wrap-warn" title={`가장 긴 줄이 ${longestLineChars}자입니다`}>
                ⚠ 이 크기에서는 긴 줄이 두 줄로 감깁니다
              </span>
            )}
        </>
      )}
    </>
  );
}
