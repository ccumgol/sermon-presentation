/**
 * 배경 그림 고르기 (템플릿 탭).
 *
 * ## 고르기만 한다 (2026-08-18, D-B 결정)
 *
 * 올리기·삭제·총량 상한을 덜어냈다. 기획서 §1.3 이 처음부터 배경 재생을 범위에서
 * 제외했고("OBS가 이미 잘 함"), 검수에서 그 판단으로 되돌렸다.
 * 파일은 두 폴더에 **직접 넣는다** — 그게 큰 그림에는 더 빠르다.
 *
 * | 폴더 | 성격 |
 * |---|---|
 * | `~/Desktop/Data/Background` | 모아 둔 것 (앱은 읽기만) |
 * | `data/backgrounds/` | 직접 넣어 둔 것 |
 *
 * 고른 파일이 목록에 없으면(다른 PC 에서 가져온 순서표 등) **조용히 넘기지 않고**
 * 그 사실을 알린다. 배경이 빠진 채로 예배가 시작되는 것보다 낫다.
 */

import { useCallback, useEffect, useState } from 'react';

import type { BackgroundFit, CanvasBackground } from '../../../shared/types.ts';
import { api, ApiError, type BackgroundFile } from '../api.ts';

type ImageBackground = Extract<CanvasBackground, { mode: 'image' }>;

interface Props {
  background: ImageBackground;
  onChange: (next: CanvasBackground) => void;
}

/** 사람이 읽는 용량 — MB 로 고정하면 작은 그림이 전부 `0.0MB` 가 된다 */
function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(1)}GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${bytes}B`;
}

export function BackgroundPicker({ background, onChange }: Props): React.JSX.Element {
  const [files, setFiles] = useState<BackgroundFile[]>([]);
  const [library, setLibrary] = useState<BackgroundFile[]>([]);
  const [libraryDir, setLibraryDir] = useState('');
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const result = await api.backgrounds();
      setFiles(result.files);
      setLibrary(result.library ?? []);
      setLibraryDir(result.libraryDir ?? '');
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '배경 목록을 불러오지 못했습니다');
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const inLibrary = library.some((f) => f.name === background.src);
  const inData = files.some((f) => f.name === background.src);
  const known = background.src.length === 0 || inLibrary || inData;
  const empty = library.length === 0 && files.length === 0;

  /*
   * **어느 폴더에서 골랐는지 함께 담는다** (2026-09-11 버그 수정).
   *
   * 전에는 파일 이름만 담아서, 출력 페이지가 늘 `/backgrounds/`(데이터 폴더)로
   * 주소를 만들었다 — 내 배경 폴더에서 고른 그림은 **404 로 조용히 사라졌다.**
   * 목록이 두 폴더를 함께 보여 주므로 이름만으로는 어느 쪽인지 알 수 없다.
   *
   * 그래서 `<option>` 값에 폴더를 붙여 두고 여기서 갈라 읽는다.
   */
  const pick = (value: string): void => {
    const at = value.indexOf(':');
    if (at < 0) {
      onChange({ ...background, src: '', source: 'data' });
      return;
    }
    const source = value.slice(0, at) === 'library' ? 'library' : 'data';
    onChange({ ...background, src: value.slice(at + 1), source });
  };

  /** 지금 고른 것을 드롭다운 값으로 — 저장된 폴더가 목록에 없으면 실제 자리를 따른다 */
  const selected =
    background.src.length === 0
      ? ''
      : `${background.source ?? (inLibrary && !inData ? 'library' : 'data')}:${background.src}`;

  return (
    <>
      <div className="field">
        <label>파일</label>
        <div className="row file-row">
          <select className="grow" value={selected} onChange={(e) => pick(e.target.value)}>
            <option value="">— 고르세요 —</option>
            {/* 목록에 없는 파일도 값으로 남긴다 — 지우면 무엇을 쓰려 했는지 사라진다 */}
            {!known && <option value={selected}>{background.src} (없음)</option>}
            {library.length > 0 && (
              <optgroup label="내 배경 폴더">
                {library.map((file) => (
                  <option key={`lib:${file.name}`} value={`library:${file.name}`}>
                    {file.name} ({formatSize(file.bytes)})
                  </option>
                ))}
              </optgroup>
            )}
            {files.length > 0 && (
              <optgroup label="data/backgrounds">
                {files.map((file) => (
                  <option key={`data:${file.name}`} value={`data:${file.name}`}>
                    {file.name} ({formatSize(file.bytes)})
                  </option>
                ))}
              </optgroup>
            )}
          </select>
          <button type="button" onClick={() => void reload()} title="폴더 다시 읽기">
            새로 고침
          </button>
        </div>
      </div>

      <div className="field">
        <label>맞춤</label>
        <select
          value={background.fit ?? 'cover'}
          onChange={(e) => onChange({ ...background, fit: e.target.value as BackgroundFit })}
        >
          <option value="cover">화면 채우기 (넘치는 부분 잘림)</option>
          <option value="contain">전체 보이기 (여백 생김)</option>
        </select>
      </div>

      <div className="field">
        <label>불투명도</label>
        <input
          type="range"
          min={0.1}
          max={1}
          step={0.05}
          value={background.opacity ?? 1}
          onChange={(e) => onChange({ ...background, opacity: Number(e.target.value) })}
        />
        <span className="muted">{Math.round((background.opacity ?? 1) * 100)}%</span>
      </div>

      {error && <p className="hintline error">{error}</p>}

      {!known && (
        <p className="hintline error">
          '{background.src}' 파일이 없습니다 — 배경 없이 나갑니다. 폴더에 넣거나 다시 고르세요.
        </p>
      )}

      {empty && !error && (
        <p className="hintline muted">
          그림이 없습니다. <code>{libraryDir || '~/Desktop/Data/Background'}</code> 폴더에 넣으세요.
        </p>
      )}

      <p className="hintline muted">
        <b>반복 동영상 배경은 OBS 미디어 소스</b>로 깔면 됩니다 — 자동 재생·코덱 문제가 없습니다.
        배경 파일은 데이터 이전(백업)에 담기지 않으니 다른 PC 로 옮길 때는 폴더째 복사하세요.
      </p>
    </>
  );
}
