import type { TextStyle } from '../../../shared/types.ts';
import { FontChainStatus } from './FontChainStatus.tsx';

interface NumberFieldProps {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
  onChange: (value: number) => void;
}

/** 숫자 입력 + 슬라이더. 예배 중에도 쓸 수 있게 둘 다 제공한다. */
export function NumberField({
  label,
  value,
  min = 0,
  max = 200,
  step = 1,
  suffix,
  onChange,
}: NumberFieldProps): React.JSX.Element {
  return (
    <div className="field num-field">
      <label>
        {label} <span className="num-value">{value}{suffix ?? ''}</span>
      </label>
      <div className="num-row">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          aria-label={label}
        />
        <input
          type="number"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          aria-label={`${label} 값`}
        />
      </div>
    </div>
  );
}

interface ColorFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
}

export function ColorField({ label, value, onChange }: ColorFieldProps): React.JSX.Element {
  // color input 은 #RRGGBB 만 받으므로 rgba() 값은 텍스트로 다룬다
  const isHex = /^#[0-9a-f]{6}$/i.test(value);

  return (
    <div className="field">
      <label>{label}</label>
      <div className="color-row">
        <input
          type="color"
          value={isHex ? value : '#ffffff'}
          onChange={(e) => onChange(e.target.value)}
          aria-label={label}
        />
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          spellCheck={false}
          aria-label={`${label} 값`}
        />
      </div>
    </div>
  );
}

interface TextStyleFieldsProps {
  title: string;
  style: TextStyle;
  onChange: (patch: Partial<TextStyle>) => void;
  /**
   * 글꼴 칸을 보일지.
   *
   * **주·보조 텍스트에서는 감춘다** — 폰트는 예배 순서 탭의 항목에서 고른다
   * (고딕/명조, 요청 5). 참조 표기·소제목·절 번호는 항목 폰트가 걸리지 않는 자리라
   * (`--item-font` 는 `.line-primary`·`.line-secondary` 에만 걸린다) 여기서 정한다.
   */
  showFontChain?: boolean;
}

/** 한 역할(주 역본·보조 역본 등)의 글자 스타일 편집 묶음 */
export function TextStyleFields({
  title,
  style,
  onChange,
  showFontChain = true,
}: TextStyleFieldsProps): React.JSX.Element {
  return (
    <details className="style-group" open>
      <summary>{title}</summary>

      <NumberField label="글자 크기" value={style.fontSize} min={12} max={160} suffix="px"
        onChange={(fontSize) => onChange({ fontSize })} />

      <ColorField label="글자 색" value={style.color} onChange={(color) => onChange({ color })} />

      <div className="row">
        <div className="field grow">
          <label>굵기</label>
          <select value={style.fontWeight} onChange={(e) => onChange({ fontWeight: Number(e.target.value) })}>
            {[300, 400, 500, 600, 700, 800, 900].map((w) => (
              <option key={w} value={w}>{w}</option>
            ))}
          </select>
        </div>
        <div className="field grow">
          <label>줄 간격</label>
          <select value={style.lineHeight} onChange={(e) => onChange({ lineHeight: Number(e.target.value) })}>
            {[1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.8].map((h) => (
              <option key={h} value={h}>{h}</option>
            ))}
          </select>
        </div>
      </div>

      {showFontChain ? (
        <>
          <div className="field">
            <label>글꼴 (쉼표로 구분된 후보 목록)</label>
            <input
              type="text"
              value={style.fontFamily}
              onChange={(e) => onChange({ fontFamily: e.target.value })}
              spellCheck={false}
            />
          </div>

          {/* 적어 넣은 이름이 실제로 잡히는지 재서 보여 준다 (설치했는데 안 잡히는 함정 방지) */}
          <FontChainStatus value={style.fontFamily} />
        </>
      ) : (
        <p className="hintline muted">
          글꼴(고딕/명조)은 <b>예배 순서</b> 탭의 항목에서 고릅니다.
        </p>
      )}

      {/* 외곽선 — 밝은 영상 위에서 글자를 읽히게 하는 가장 효과적인 수단 */}
      <div className="row">
        <div className="field grow">
          <label>외곽선 두께</label>
          <input
            type="number"
            min={0}
            max={12}
            value={style.stroke?.width ?? 0}
            onChange={(e) => {
              const width = Number(e.target.value);
              onChange({ stroke: width > 0 ? { width, color: style.stroke?.color ?? '#000000' } : null });
            }}
          />
        </div>
        <div className="field grow">
          <label>외곽선 색</label>
          <input
            type="color"
            value={style.stroke?.color ?? '#000000'}
            onChange={(e) =>
              onChange({ stroke: { width: style.stroke?.width ?? 3, color: e.target.value } })
            }
            disabled={!style.stroke || style.stroke.width === 0}
          />
        </div>
      </div>

      <div className="row">
        <label className="check">
          <input
            type="checkbox"
            checked={style.shadow !== null}
            onChange={(e) =>
              onChange({ shadow: e.target.checked ? { x: 0, y: 3, blur: 10, color: 'rgba(0,0,0,0.55)' } : null })
            }
          />
          그림자
        </label>
        <label className="check">
          <input type="checkbox" checked={style.italic} onChange={(e) => onChange({ italic: e.target.checked })} />
          이탤릭
        </label>
        <label className="check" title="한국어는 어절 단위로 줄바꿈해야 읽기 좋습니다">
          <input
            type="checkbox"
            checked={style.wordBreak === 'keep-all'}
            onChange={(e) => onChange({ wordBreak: e.target.checked ? 'keep-all' : 'normal' })}
          />
          어절 단위 줄바꿈
        </label>
      </div>
    </details>
  );
}
