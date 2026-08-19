/**
 * 항목별 표시 옵션 — 참조 표기·소제목·절 번호를 켜고 끈다.
 *
 * ## 세 갈래를 그림으로 보여 준다
 *
 * 값은 **템플릿 따름 · 켬 · 끔** 세 갈래다. 체크박스로 두면 두 갈래밖에 못 담아,
 * '이 항목은 템플릿을 따른다' 와 '이 항목은 일부러 껐다' 를 구분할 수 없다.
 * 구분이 안 되면 템플릿을 바꿨을 때 왜 어떤 항목만 안 따라오는지 알 수 없다.
 *
 * 그래서 버튼 셋을 두고, **템플릿 따름일 때 실효값을 함께 적는다** — 지금 화면에
 * 무엇이 나가는지 알아야 고칠지 말지 정할 수 있다.
 */

import { resolveDisplay } from '../../../lib/item-display.ts';
import type { ItemDisplay, Template } from '../../../shared/types.ts';

/** 무엇을 고를 수 있는지 — 찬양은 절 번호만 뜻이 있다 */
export type DisplayKey = 'reference' | 'headings' | 'verseNumbers';

const LABELS: Readonly<Record<DisplayKey, string>> = {
  reference: '참조 표기',
  headings: '소제목',
  verseNumbers: '절 번호',
};

interface Props {
  value: ItemDisplay | undefined;
  /** 실효값을 계산할 템플릿 — 없으면 '템플릿 따름' 의 결과를 적지 못한다 */
  template: Template | null;
  /** 이 항목에서 뜻이 있는 것만 (찬양은 `['verseNumbers']`) */
  keys: readonly DisplayKey[];
  onChange: (next: ItemDisplay | undefined) => void;
}

export function DisplayToggles({ value, template, keys, onChange }: Props): React.JSX.Element {
  const resolved = resolveDisplay(template?.behavior ?? {}, value);

  /** 한 항목만 바꾼다. 남는 것이 없으면 **아예 지운다** — 빈 객체를 저장하지 않는다 */
  function set(key: DisplayKey, next: boolean | undefined): void {
    const merged: ItemDisplay = { ...value };
    if (next === undefined) delete merged[key];
    else merged[key] = next;
    onChange(Object.keys(merged).length > 0 ? merged : undefined);
  }

  return (
    <>
      {keys.map((key) => {
        const own = value?.[key];
        const effective =
          key === 'reference' ? resolved.reference !== 'none' : resolved[key] === true;

        return (
          <div className="display-row" key={key}>
            <label>{LABELS[key]}</label>
            <span className="candidates">
              {(
                [
                  [undefined, '템플릿 따름'],
                  [true, '켬'],
                  [false, '끔'],
                ] as const
              ).map(([option, label]) => (
                <button
                  key={label}
                  type="button"
                  className={own === option ? 'primary' : undefined}
                  onClick={() => set(key, option)}
                >
                  {label}
                </button>
              ))}
            </span>
            {/* 템플릿을 따를 때는 지금 무엇이 나가는지 적는다 — 모르면 고칠지 판단할 수 없다 */}
            {own === undefined && (
              <span className="muted display-effective">
                지금 {effective ? '켜져 있음' : '꺼져 있음'}
                {key === 'reference' && effective && resolved.reference !== 'none'
                  ? ` (${resolved.reference === 'top' ? '위' : resolved.reference === 'bottom' ? '아래' : '본문 줄'})`
                  : ''}
              </span>
            )}
          </div>
        );
      })}
    </>
  );
}
