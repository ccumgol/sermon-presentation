/**
 * 순서 표시 제목의 **글자별 크기·높낮이 조정**.
 *
 * 자동 리듬이 기본이고, 여기서 만진 글자만 그 값이 이긴다. 슬라이더는 처음에
 * **자동으로 계산된 값**을 가리키므로, 조금만 옮겨도 튀지 않는다.
 *
 * 되돌리기를 두 단계로 둔다 — 글자 하나만 자동으로(↺), 또는 전부 자동으로.
 * 예배 직전에 만졌다가 원래대로 돌리고 싶을 때 기억에 의존하지 않게 하기 위함이다.
 */

import {
  adjustableChars, autoDy, autoScale, AUTO_PATTERN,
  CHAR_DY_MAX, CHAR_DY_MIN, CHAR_SIZE_MAX, CHAR_SIZE_MIN,
} from '../../../lib/order-rhythm.ts';
import type { OrderCharStyle } from '../../../shared/types.ts';

interface Props {
  title: string;
  charStyles: OrderCharStyle[] | undefined;
  /** 자동 리듬 값 — 슬라이더의 출발점이 된다 */
  rhythm: number;
  rhythmY: number;
  onChange: (next: OrderCharStyle[] | undefined) => void;
}

/** 만진 글자가 하나도 없으면 저장하지 않는다 (순서표에 빈 배열이 쌓이지 않게) */
function compact(styles: OrderCharStyle[]): OrderCharStyle[] | undefined {
  return styles.some((style) => style.size !== undefined || style.dy !== undefined) ? styles : undefined;
}

export function OrderCharTuner({ title, charStyles, rhythm, rhythmY, onChange }: Props): React.JSX.Element | null {
  const chars = adjustableChars(title);
  if (chars.length === 0) return null;

  const styles: OrderCharStyle[] = chars.map((_, index) => charStyles?.[index] ?? {});
  const touched = styles.some((style) => style.size !== undefined || style.dy !== undefined);

  /**
   * 어절 안에서 몇 번째 글자인지 — 자동 리듬은 어절마다 다시 시작한다.
   * 공백을 뺀 목록을 쓰므로 원본 제목을 다시 훑어 계산한다.
   */
  const wordIndexes: number[] = [];
  let step = 0;
  for (const ch of Array.from(title)) {
    if (ch.trim().length === 0) {
      step = 0;
      continue;
    }
    wordIndexes.push(step);
    step += 1;
  }

  function patch(index: number, change: OrderCharStyle): void {
    onChange(compact(styles.map((style, i) => (i === index ? { ...style, ...change } : style))));
  }

  function resetOne(index: number): void {
    onChange(compact(styles.map((style, i) => (i === index ? {} : style))));
  }

  return (
    <div className="char-tuner">
      <div className="row">
        <label>글자 조정</label>
        <span className="muted">
          {chars.length > AUTO_PATTERN.length
            ? `자동은 앞 ${AUTO_PATTERN.length}글자까지 — 나머지는 직접 맞추세요`
            : '만진 글자만 자동 리듬을 벗어납니다'}
        </span>
        <button type="button" onClick={() => onChange(undefined)} disabled={!touched}>
          전부 자동으로
        </button>
      </div>

      {chars.map((ch, index) => {
        const inWord = wordIndexes[index] ?? 0;
        const size = styles[index]?.size ?? autoScale(inWord, rhythm);
        const dy = styles[index]?.dy ?? autoDy(inWord, rhythmY);
        const manual = styles[index]?.size !== undefined || styles[index]?.dy !== undefined;
        // 표는 네 글자까지다. 그 뒤 글자는 자동이 손대지 않으므로 눈에 띄게 둔다.
        const beyondTable = inWord >= AUTO_PATTERN.length;

        return (
          <div className={`char-row${manual ? ' manual' : ''}${beyondTable && !manual ? ' plain' : ''}`} key={`${ch}-${index}`}>
            <span className="ch" title={manual ? '직접 조정함' : beyondTable ? '자동 없음 — 직접 조정하세요' : '자동'}>{ch}</span>

            <span className="knob">
              <span className="tag">크기</span>
              <input
                type="range"
                min={CHAR_SIZE_MIN}
                max={CHAR_SIZE_MAX}
                step={0.02}
                value={size}
                onChange={(e) => patch(index, { size: Number(e.target.value) })}
              />
              <span className="num">{Math.round(size * 100)}%</span>
            </span>

            <span className="knob">
              <span className="tag">높낮이</span>
              <input
                type="range"
                min={CHAR_DY_MIN}
                max={CHAR_DY_MAX}
                step={0.01}
                value={dy}
                onChange={(e) => patch(index, { dy: Number(e.target.value) })}
              />
              <span className="num">{dy > 0 ? '↓' : dy < 0 ? '↑' : ''}{Math.abs(Math.round(dy * 100))}%</span>
            </span>

            <button type="button" onClick={() => resetOne(index)} disabled={!manual} title="이 글자만 자동으로">
              ↺
            </button>
          </div>
        );
      })}
    </div>
  );
}
