import { recolorKeepingAlpha } from '../../../lib/template-css.ts';
import type { BoxStyle, TextStyle } from '../../../shared/types.ts';
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
  /**
   * **색상자로 골랐을 때**만 부른다 (`#RRGGBB`). 없으면 `onChange` 를 그대로 쓴다.
   *
   * 투명도를 값에 담는 칸(네모 색)이 이것을 쓴다 — 그러지 않으면 색을 고르는 순간
   * 투명도가 사라진다.
   */
  onPick?: (hex: string) => void;
}

export function ColorField({ label, value, onChange, onPick }: ColorFieldProps): React.JSX.Element {
  // color input 은 #RRGGBB 만 받으므로 rgba() 값은 텍스트로 다룬다
  const isHex = /^#[0-9a-f]{6}$/i.test(value);

  return (
    <div className="field">
      <label>{label}</label>
      <div className="color-row">
        {/*
          **색상자는 `#RRGGBB` 만 준다.** 값이 투명도를 담고 있던 경우
          (`rgba(0,0,0,0.55)`) 그대로 넣으면 **투명도가 조용히 사라진다** —
          네모가 불투명해져 카메라 영상이 통째로 가려진다 (2026-09-12 실측).
          그래서 부르는 쪽이 `onPick` 으로 '고른 색을 어떻게 합칠지' 를 정한다.
          글자 칸은 사람이 쓴 값을 그대로 받는다 — 거기서는 뒤집지 않는다.
        */}
        <input
          type="color"
          value={isHex ? value : '#ffffff'}
          onChange={(e) => (onPick ?? onChange)(e.target.value)}
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
  /**
   * 자간·절대 행간·대문자화·글자 뒤 상자를 보일지.
   *
   * **주·보조 텍스트에서만 켠다.** 이 넷은 `lib/template-css.ts` 의
   * `textStyleVars` 만 CSS 변수로 내보내고, 절 번호·참조·소제목은
   * `simpleStyleVars` 를 타서 **변수가 아예 나가지 않는다.** 거기에 컨트롤을 두면
   * 만져도 화면이 안 바뀌는 칸이 된다 (2026-09-03 §4.6 B).
   */
  full?: boolean;
}

/** 한 역할(주 역본·보조 역본 등)의 글자 스타일 편집 묶음 */
/**
 * **네모 상자 편집** — 색·여백·모서리. 두 군데가 같은 것을 쓴다.
 *
 * | 부르는 곳 | 무엇을 고치나 |
 * |---|---|
 * | 글자 카드 (`TextStyleFields`) | `TextStyle.bgBox` — **줄마다** 그려진다 |
 * | 템플릿 탭 배치 카드 | `TemplateLayout.box` — **글자 덩어리 하나**에 그려진다 |
 *
 * 둘이 같은 모양(`BoxStyle`)이라 편집 화면도 하나여야 한다 — 두 벌을 두면
 * 한쪽만 고쳐져 서로 다르게 동작한다.
 */
export function BoxFields({
  box,
  onChange,
  colorLabel = '상자 색 (rgba 가능)',
}: {
  box: BoxStyle;
  onChange: (next: BoxStyle) => void;
  colorLabel?: string;
}): React.JSX.Element {
  return (
    <div className="box-fields">
      {/* rgba 를 쓰므로 색 고르기가 아니라 글자로도 받는다 (투명도가 값에 들어 있다) */}
      <ColorField
        label={colorLabel}
        value={box.color}
        onChange={(color) => onChange({ ...box, color })}
        // 색상자로 고를 때는 **지금 투명도를 그대로 유지한다** (없으면 1 = 불투명)
        onPick={(hex) => onChange({ ...box, color: recolorKeepingAlpha(hex, box.color) })}
      />
      <div className="row">
        <NumberField
          label="좌우 여백"
          value={box.paddingX}
          min={0}
          max={200}
          step={2}
          suffix="px"
          onChange={(paddingX) => onChange({ ...box, paddingX })}
        />
        <NumberField
          label="위아래 여백"
          value={box.paddingY}
          min={0}
          max={160}
          step={2}
          suffix="px"
          onChange={(paddingY) => onChange({ ...box, paddingY })}
        />
      </div>
      <NumberField
        label="모서리 둥글기"
        value={box.radius}
        min={0}
        max={80}
        suffix="px"
        onChange={(radius) => onChange({ ...box, radius })}
      />
    </div>
  );
}

export function TextStyleFields({
  title,
  style,
  onChange,
  showFontChain = true,
  full = false,
}: TextStyleFieldsProps): React.JSX.Element {
  /** 절대 행간을 쓰는 중인가 — 쓰면 '줄 간격'(배수)은 화면에 영향을 주지 않는다 */
  const absoluteGap = style.lineGapPx !== undefined && style.lineGapPx !== null;

  return (
    <details className="style-group" open>
      <summary>{title}</summary>

      <NumberField label="글자 크기" value={style.fontSize} min={12} max={160} suffix="px"
        onChange={(fontSize) => onChange({ fontSize })} />

      <ColorField label="글자 색" value={style.color} onChange={(color) => onChange({ color })} />

      {/*
        **글자 투명도.** 모든 역할에 있다 (`simpleStyleVars` 도 `--*-opacity` 를 내보낸다).
        참조 표기·저작권을 흐리게 두는 데 프리셋이 이미 쓰던 값인데(0.75~0.95) 화면에서
        바꿀 길이 없었다. 20% 아래로는 못 내린다 — 0% 는 글자가 사라져 고장으로 보인다.
      */}
      <NumberField
        label="글자 투명도"
        value={Math.round(style.opacity * 100)}
        min={20}
        max={100}
        step={5}
        suffix="%"
        onChange={(percent) => onChange({ opacity: percent / 100 })}
      />

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
          <label>줄 간격 {absoluteGap && <span className="num-value">고정 여백을 씁니다</span>}</label>
          <select
            value={style.lineHeight}
            disabled={absoluteGap}
            title={absoluteGap ? '아래 «줄 사이 고정» 을 끄면 이 배수를 씁니다' : '글자 크기의 배수'}
            onChange={(e) => onChange({ lineHeight: Number(e.target.value) })}
          >
            {[1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.8].map((h) => (
              <option key={h} value={h}>{h}</option>
            ))}
          </select>
        </div>
      </div>

      {/*
        **절대 행간** — 글자를 키워도 줄 사이가 벌어지지 않는다. 프리셋이 쓰던 값인데
        (`lineGapPx`) 화면에서 켜고 끌 길이 없었다.
      */}
      {full && (
        <div className="row">
          <label className="check" title="글자를 키워도 줄 사이 여백이 그대로입니다">
            <input
              type="checkbox"
              checked={absoluteGap}
              // 끌 때는 반드시 null 이다 — undefined 는 JSON 에서 사라져 서버에 안 간다
              onChange={(e) => onChange({ lineGapPx: e.target.checked ? 16 : null })}
            />
            줄 사이 고정
          </label>
          {absoluteGap && (
            <div className="field grow">
              <label>
                여백 <span className="num-value">{style.lineGapPx}px</span>
              </label>
              <input
                type="range"
                min={0}
                max={60}
                value={style.lineGapPx ?? 16}
                onChange={(e) => onChange({ lineGapPx: Number(e.target.value) })}
                aria-label="줄 사이 고정 여백"
              />
            </div>
          )}
        </div>
      )}

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

      {/*
        여기 아래는 손대는 일이 드물어 접어 둔다. 위쪽(크기·색·외곽선)은 예배 준비마다
        만지는 값이라 늘 펼쳐져 있어야 하고, 이것들이 그 위에 끼면 그때마다 지나쳐야 한다.
      */}
      {full && (
        <details className="style-advanced">
          <summary>자간 · 대문자 · 글자 뒤 상자</summary>

          <NumberField
            label="자간"
            value={style.letterSpacing}
            min={-3}
            max={12}
            step={0.5}
            suffix="px"
            onChange={(letterSpacing) => onChange({ letterSpacing })}
          />

          <label className="check" title="영어에만 걸립니다 — 한글에는 대문자가 없습니다">
            <input
              type="checkbox"
              checked={style.textTransform === 'uppercase'}
              onChange={(e) => onChange({ textTransform: e.target.checked ? 'uppercase' : 'none' })}
            />
            영어를 대문자로
          </label>

          {/*
            **글자 뒤 상자** — 밝은 영상 위에서 외곽선만으로 부족할 때 쓴다.
            프리셋 두 개가 이미 쓰고 있었다 (`rgba(0,0,0,0.55)`).
          */}
          <label className="check" title="밝은 영상 위에서 외곽선만으로 부족할 때">
            <input
              type="checkbox"
              checked={style.bgBox !== null}
              onChange={(e) =>
                onChange({
                  bgBox: e.target.checked
                    ? { color: 'rgba(0,0,0,0.55)', paddingX: 28, paddingY: 14, radius: 10 }
                    : null,
                })
              }
            />
            글자 뒤 상자
          </label>

          {style.bgBox && (
            <BoxFields box={style.bgBox} onChange={(bgBox) => onChange({ bgBox })} />
          )}
        </details>
      )}
    </details>
  );
}
