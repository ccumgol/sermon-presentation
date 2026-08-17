/**
 * 배경 그림·동영상 고르기 (템플릿 탭).
 *
 * 파일을 넣는 길이 두 가지다 (2026-08-15 사용자 결정):
 *  - `data/backgrounds/` 폴더에 **직접** 넣기 — 큰 동영상은 이 편이 빠르다
 *  - 여기서 **올리기** — 다른 PC 에서 터미널 없이 넣을 수 있어야 한다
 *
 * 고른 파일이 목록에 없으면(다른 PC 에서 가져온 순서표 등) **조용히 넘기지 않고**
 * 그 사실을 알린다. 배경이 빠진 채로 예배가 시작되는 것보다 낫다.
 *
 * 폴더 총량도 함께 보여 준다. 상한(기본 2GB)을 넘으면 서버가 업로드를 막는데,
 * 지금 얼마를 쓰는지 안 보이면 그 거절이 갑작스럽다 (SECURITY-AUDIT S-1).
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import type { BackgroundFit, CanvasBackground } from '../../../shared/types.ts';
import { api, ApiError, type BackgroundFile } from '../api.ts';

type MediaBackground = Extract<CanvasBackground, { mode: 'image' | 'video' }>;

interface Props {
  background: MediaBackground;
  onChange: (next: CanvasBackground) => void;
}

/** 파일을 base64 로 읽는다 — 서버가 JSON 으로 받으므로 의존성이 늘지 않는다 */
function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('파일을 읽지 못했습니다'));
    reader.onload = () => {
      const result = String(reader.result);
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.readAsDataURL(file);
  });
}

/**
 * 사람이 읽는 용량. MB 로 고정하면 작은 그림이 `0.0MB` 가 되고 2GB 한도가
 * `2048.0MB` 로 나온다 (서버 메시지도 같은 이유로 단위를 맞춘다).
 */
function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(1)}GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${bytes}B`;
}

export function BackgroundPicker({ background, onChange }: Props): React.JSX.Element {
  const [files, setFiles] = useState<BackgroundFile[]>([]);
  const [maxBytes, setMaxBytes] = useState(0);
  const [total, setTotal] = useState<{ used: number; max: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const reload = useCallback(async () => {
    try {
      const result = await api.backgrounds();
      setFiles(result.files);
      setMaxBytes(result.maxUploadBytes);
      setTotal({ used: result.totalBytes, max: result.maxTotalBytes });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '배경 목록을 불러오지 못했습니다');
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const matching = files.filter((file) => file.kind === background.mode);
  const missing = background.src.length > 0 && !files.some((file) => file.name === background.src);

  async function upload(file: File): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      if (maxBytes > 0 && file.size > maxBytes) {
        setError(
          `${formatSize(file.size)} 는 너무 큽니다 (한도 ${formatSize(maxBytes)}). ` +
            `data/backgrounds/ 폴더에 직접 넣으세요.`,
        );
        return;
      }
      // 같은 이름이면 덮어쓴다 — 되돌릴 수 없으므로 먼저 묻는다
      if (files.some((f) => f.name === file.name) && !window.confirm(`'${file.name}' 을(를) 덮어씁니다.`)) {
        return;
      }

      const uploaded = await api.uploadBackground(file.name, await readAsBase64(file));
      await reload();
      if (uploaded.file) onChange({ ...background, mode: uploaded.file.kind, src: uploaded.file.name });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '올리지 못했습니다');
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  /**
   * 고른 배경 지우기.
   *
   * 쓰고 있는 템플릿이 있으면 서버가 **409 로 막고 그 이름들을 알려 준다.** 그 메시지를
   * 그대로 보여 주고 강제 삭제를 물어본다 — 어느 템플릿이 깨질지 모른 채 지우면
   * 예배 중에 발견하게 된다.
   */
  async function remove(name: string): Promise<void> {
    if (!window.confirm(`배경 '${name}' 을(를) 지웁니다. 되돌릴 수 없습니다.`)) return;

    setBusy(true);
    setError(null);
    try {
      await api.deleteBackground(name);
      if (background.src === name) onChange({ ...background, src: '' });
      await reload();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : '지우지 못했습니다';
      // 템플릿이 쓰고 있다는 거절이면 강제 삭제를 물어본다
      if (message.includes('템플릿이 쓰고 있습니다') && window.confirm(`${message}\n\n그래도 지울까요?`)) {
        try {
          await api.deleteBackground(name, true);
          if (background.src === name) onChange({ ...background, src: '' });
          await reload();
          return;
        } catch (forced) {
          setError(forced instanceof ApiError ? forced.message : '지우지 못했습니다');
          return;
        }
      }
      setError(message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="field">
        <label>파일</label>
        {/* .field 는 세로로 쌓으므로, 고르기와 지우기는 한 줄로 묶는다 */}
        <div className="row file-row">
          <select
            className="grow"
            value={background.src}
            onChange={(e) => onChange({ ...background, src: e.target.value })}
          >
            <option value="">— 고르세요 —</option>
            {matching.map((file) => (
              <option key={file.name} value={file.name}>
                {file.name} ({formatSize(file.bytes)})
              </option>
            ))}
          </select>
          <button
            type="button"
            className="del"
            onClick={() => void remove(background.src)}
            disabled={busy || background.src.length === 0 || missing}
            title="고른 배경 파일을 지웁니다"
          >
            ✕
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

      <div className="row">
        <input
          ref={fileRef}
          type="file"
          accept={background.mode === 'video' ? 'video/*' : 'image/*'}
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void upload(file);
          }}
        />
        <button type="button" onClick={() => void reload()} disabled={busy} title="폴더에 직접 넣은 파일 다시 읽기">
          새로 고침
        </button>
      </div>

      {error && <p className="hintline error">{error}</p>}

      {missing && (
        <p className="hintline error">
          '{background.src}' 파일이 없습니다 — 배경 없이 나갑니다. 폴더에 넣거나 다시 고르세요.
        </p>
      )}

      {matching.length === 0 && !error && (
        <p className="hintline muted">
          아직 파일이 없습니다. 위에서 올리거나 <code>data/backgrounds/</code> 폴더에 직접 넣으세요.
        </p>
      )}

      {total && total.max > 0 && (
        <p className={`hintline ${total.used / total.max > 0.9 ? 'warn' : 'muted'}`}>
          배경 폴더 {formatSize(total.used)} / {formatSize(total.max)}
          {total.used / total.max > 0.9 && ' — 거의 찼습니다. 쓰지 않는 배경을 지우세요.'}
        </p>
      )}

      <p className="hintline muted">
        배경 파일은 데이터 이전(백업)에 담기지 않습니다 — 동영상이 커서 이전 파일을 못 쓰게 만듭니다.
        다른 PC 로 옮길 때는 폴더째 복사하세요.
      </p>
    </>
  );
}
