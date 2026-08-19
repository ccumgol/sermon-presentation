/**
 * 성경·찬양 탭의 화면 설정 — 프리셋과 폰트.
 *
 * ## 왜 두 탭에 필요한가
 *
 * 예배 순서 탭에서는 항목마다 템플릿·폰트를 정하지만, 성경·찬양 탭은 **순서를 벗어나
 * 급히 띄우는 자리**다. 설교 중 갑자기 다른 본문을 찾을 때 여기서 띄우는데, 그때
 * 화면 모양을 정할 길이 없었다 — 지금 활성 템플릿이 무엇이든 그대로 나갔다.
 *
 * ## 고를 수 있는 프리셋은 셋뿐이다
 *
 * 하단·전체·좌우 (`SHARED_PRESET_IDS`). 순서 표시·교독문·전례문은 그 항목 전용이라
 * 본문·가사에 쓰면 크기와 배치가 맞지 않는다. **고를 수 있다는 것이 곧 안내**여야 하므로
 * 목록에 넣지 않는다.
 *
 * 덮어쓴 프리셋은 사용자가 붙인 이름으로 보인다 — 목록이 코드가 아니라 화면을 따라간다.
 *
 * ## 기본값은 '템플릿 그대로'
 *
 * 고르지 않으면 지금까지와 똑같이 동작한다. 처음부터 하나를 골라 두면 이 탭에서
 * 띄울 때마다 템플릿이 바뀌어, 예배 순서에서 정해 둔 모양을 덮어쓴다.
 */

import { useEffect, useState } from 'react';

import { LANG_LABELS } from '../../../lib/lang-select.ts';
import { SHARED_PRESET_IDS } from '../../../lib/template-presets.ts';
import type { ItemTextStyle, Template } from '../../../shared/types.ts';
import { api } from '../api.ts';

export interface OutputStyle {
  /** 고른 프리셋 id — 없으면 지금 템플릿을 그대로 쓴다 */
  templateId?: number;
  /** 고딕/명조 — 없으면 템플릿 글꼴 */
  style?: ItemTextStyle;
}

interface Props {
  value: OutputStyle;
  onChange: (next: OutputStyle) => void;
}

export function OutputStyleBar({ value, onChange }: Props): React.JSX.Element {
  const [presets, setPresets] = useState<Template[]>([]);

  useEffect(() => {
    let alive = true;
    void api
      .templates()
      .then((all) => {
        if (!alive) return;
        // 코드에 적힌 순서대로 — 가장 많이 쓰는 하단이 앞
        const picked = SHARED_PRESET_IDS.map((id) => all.find((t) => t.id === id)).filter(
          (t): t is Template => t !== undefined,
        );
        setPresets(picked);
      })
      // 목록을 못 읽어도 송출은 돼야 한다 — 고를 것이 없을 뿐이다
      .catch(() => setPresets([]));
    return () => {
      alive = false;
    };
  }, []);

  const font = value.style?.font ?? 'sans';

  return (
    <div className="row detail-controls output-style">
      <label title="고르지 않으면 지금 템플릿을 그대로 씁니다">화면</label>
      <select
        value={value.templateId ?? ''}
        onChange={(e) => {
          const raw = e.target.value;
          onChange({ ...value, ...(raw === '' ? { templateId: undefined } : { templateId: Number(raw) }) });
        }}
        disabled={presets.length === 0}
      >
        <option value="">템플릿 그대로</option>
        {presets.map((preset) => (
          <option key={preset.id} value={preset.id}>
            {preset.name}
          </option>
        ))}
      </select>

      <label>폰트</label>
      <div className="toggle-row">
        {(
          [
            ['sans', '고딕'],
            ['serif', '명조'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            className={`toggle${font === key ? ' active' : ''}`}
            onClick={() =>
              // 고딕은 기본값이라 담지 않는다 — 기본이 박히면 나중에 기본을 바꿀 수 없다
              onChange({ ...value, style: key === 'sans' ? undefined : { font: key } })
            }
          >
            {label}
          </button>
        ))}
      </div>

      <span className="muted output-style-hint">
        {value.templateId === undefined && font === 'sans'
          ? '지금 템플릿·글꼴 그대로 나갑니다'
          : `이 탭에서 띄울 때 적용됩니다${font === 'serif' ? ` (한국어 줄만 명조 — ${LANG_LABELS.en} 등은 전용 글꼴)` : ''}`}
      </span>
    </div>
  );
}
