/**
 * 배경 그림 고르기 — 교독문·주기도문·사도신경이 쓴다.
 *
 * `PlanPanel.tsx` 에서 떼어냈다 (검토 2026-08-22 R-4).
 */

import type React from 'react';

import type { BackgroundFile } from '../api.ts';
import type { ItemBackground } from '../../../shared/types.ts';

/**
 * 배경 그림 고르기 — 교독문·주기도문·사도신경이 쓴다.
 *
 * 두 폴더를 한 드롭다운에 묶는다. 사용자가 모아 둔 폴더(`~/Desktop/Data/Background`)가
 * 먼저 오고, 앱에 올린 것이 뒤에 온다 — 전례문 배경은 대개 그 폴더에서 고른다.
 *
 * 목록에 없는 파일도 값으로 남긴다. 지우면 무엇을 쓰려 했는지 알 수 없어진다.
 */
export function BackgroundSelect({
  value,
  library,
  uploaded,
  onChange,
}: {
  value: ItemBackground | undefined;
  library: BackgroundFile[];
  uploaded: BackgroundFile[];
  onChange: (next: ItemBackground | undefined) => void;
}): React.JSX.Element {
  /** `source:name` 한 문자열로 다뤄야 select 의 값이 두 폴더를 구분할 수 있다 */
  const key = value ? `${value.source}:${value.src}` : '';
  const known =
    value === undefined ||
    (value.source === 'library' ? library : uploaded).some((f) => f.name === value.src);

  return (
    <>
      <select
        value={key}
        onChange={(e) => {
          const raw = e.target.value;
          if (raw === '') {
            onChange(undefined);
            return;
          }
          const cut = raw.indexOf(':');
          const source = raw.slice(0, cut) === 'data' ? 'data' : 'library';
          onChange({ src: raw.slice(cut + 1), source, ...(value?.fit ? { fit: value.fit } : {}) });
        }}
      >
        <option value="">— 배경 없음 —</option>
        {!known && value && <option value={key}>{value.src} (없음)</option>}
        {library.length > 0 && (
          <optgroup label="내 배경 폴더">
            {library.map((f) => (
              <option key={`library:${f.name}`} value={`library:${f.name}`}>
                {f.name}
              </option>
            ))}
          </optgroup>
        )}
        {uploaded.length > 0 && (
          <optgroup label="data/backgrounds">
            {uploaded.map((f) => (
              <option key={`data:${f.name}`} value={`data:${f.name}`}>
                {f.name}
              </option>
            ))}
          </optgroup>
        )}
      </select>

      {value && (
        <select
          value={value.fit ?? 'cover'}
          onChange={(e) => onChange({ ...value, fit: e.target.value === 'contain' ? 'contain' : undefined })}
          title="배경은 화면을 채우는 것이 기본입니다"
        >
          <option value="cover">채우기</option>
          <option value="contain">전체 보이기</option>
        </select>
      )}
    </>
  );
}
