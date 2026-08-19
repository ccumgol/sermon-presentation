import { useCallback, useEffect, useRef, useState } from 'react';

import { api, ApiError, type ServerInfo } from '../api.ts';
import { FontSetupCard } from '../components/FontSetupCard.tsx';

interface Props {
  info: ServerInfo | null;
}

function CopyRow({ value }: { value: string }): React.JSX.Element {
  const [label, setLabel] = useState('복사');

  return (
    <div className="url-row">
      <code>{value}</code>
      <button
        type="button"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setLabel('복사됨');
          } catch {
            setLabel('복사 실패');
          }
          setTimeout(() => setLabel('복사'), 1500);
        }}
      >
        {label}
      </button>
    </div>
  );
}

interface BackupSummary {
  songs: number;
  templates: number;
  plans: number;
  settings: number;
  fonts: string[];
  approximateBytes: number;
}

/**
 * 데이터 이전 카드.
 *
 * 가져오기 '덮어쓰기'는 되돌릴 수 없으므로 명시적으로 고르게 하고,
 * 실행 전에 한 번 더 확인한다.
 */
function BackupCard(): React.JSX.Element {
  const [summary, setSummary] = useState<BackupSummary | null>(null);
  const [mode, setMode] = useState<'merge' | 'replace'>('merge');
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const reload = useCallback(() => {
    void api
      .backupSummary()
      .then(setSummary)
      .catch(() => setSummary(null));
  }, []);

  useEffect(reload, [reload]);

  async function onFile(file: File): Promise<void> {
    if (mode === 'replace') {
      const confirmed = window.confirm(
        '덮어쓰기는 되돌릴 수 없습니다.\n\n' +
          '기존 찬양·템플릿·예배 순서를 모두 지우고 파일 내용으로 바꿉니다.\n' +
          '(성경 DB 와 내장 프리셋은 그대로 유지됩니다)\n\n계속하시겠습니까?',
      );
      if (!confirmed) return;
    }

    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const bundle = JSON.parse(await file.text());
      const result = await api.importBundle(bundle, mode);
      setStatus(
        `가져왔습니다 — 찬양 ${result.songs} · 템플릿 ${result.templates} · 순서 ${result.plans} · ` +
          `설정 ${result.settings} · 폰트 ${result.fonts}` +
          (result.skipped.length > 0 ? `\n건너뛴 항목 ${result.skipped.length}개: ${result.skipped.slice(0, 5).join(', ')}` : ''),
      );
      reload();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? `파일을 읽을 수 없습니다: ${err.message}`
            : '가져오지 못했습니다',
      );
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  return (
    <div className="card">
      <h2>데이터 이전</h2>
      <p className="hintline muted">
        찬양·템플릿·예배 순서·설정·폰트를 파일 하나로 옮깁니다. 다른 PC 에 설치할 때 쓰세요.
        성경 DB 는 담기지 않습니다 — 원본에서 다시 빌드하면 됩니다.
      </p>

      {summary && (
        <dl className="meta" style={{ marginTop: 10 }}>
          <dt>담길 내용</dt>
          <dd>
            찬양 {summary.songs} · 템플릿 {summary.templates} · 순서 {summary.plans} · 설정 {summary.settings}
            {summary.fonts.length > 0 ? ` · 폰트 ${summary.fonts.length}` : ''}
          </dd>
          <dt>대략 크기</dt>
          <dd>{(summary.approximateBytes / 1024 / 1024).toFixed(1)} MB</dd>
        </dl>
      )}

      <div className="row" style={{ marginTop: 12 }}>
        <a href="/api/backup/export" download>
          <button type="button" className="primary">내보내기</button>
        </a>
        <div className="field">
          <label>가져오기 방식</label>
          <select value={mode} onChange={(e) => setMode(e.target.value as 'merge' | 'replace')}>
            <option value="merge">추가 (기존 유지)</option>
            <option value="replace">덮어쓰기 (기존 삭제)</option>
          </select>
        </div>
        <button type="button" onClick={() => fileRef.current?.click()} disabled={busy}>
          {busy ? '가져오는 중…' : '파일 선택'}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          style={{ display: 'none' }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void onFile(file);
          }}
        />
      </div>

      {status && <p className="hintline ok" style={{ whiteSpace: 'pre-wrap' }}>{status}</p>}
      {error && <p className="hintline error">{error}</p>}
    </div>
  );
}

export function SettingsPanel({ info }: Props): React.JSX.Element {
  if (!info) return <p className="hintline muted">서버 정보를 불러오는 중…</p>;

  return (
    <>
      <div className="card">
        <h2>OBS 브라우저 소스 URL</h2>
        <CopyRow value={info.outputUrl} />
      </div>

      {/*
        폰트 안내를 OBS 설정 **바로 다음**에 둔다. 처음 설치하는 사람이 위에서
        아래로 읽어 내려가는 순서에서, 소스를 만든 직후가 폰트를 챙길 자리다.
        더 아래로 밀면 스크롤 밖이라 아무도 안 본다.
      */}
      <FontSetupCard />

      <div className="card">
        <h2>OBS 설정</h2>
        <ol className="steps">
          <li>
            소스 추가 → <strong>브라우저</strong>
          </li>
          <li>URL 에 위 주소를 붙여넣기</li>
          <li>
            폭 <strong>1920</strong> / 높이 <strong>1080</strong>
          </li>
          <li>
            사용자 지정 CSS 칸을 <strong>비우기</strong> — 기본값을 안 지우면 배경이 덮여 투명이 깨집니다
          </li>
          <li>
            “표시되지 않을 때 소스 종료” <strong>해제</strong>
          </li>
          <li>
            “장면이 활성화될 때 브라우저 새로고침” <strong>해제</strong>
          </li>
        </ol>
        <p className="hintline muted">
          크로마키 필터는 필요하지 않습니다. 알파 투명으로 합성되므로 글자 경계가 깨끗합니다.
        </p>
      </div>

      {info.lanAddresses.length > 0 && (
        <div className="card">
          <h2>태블릿에서 조작하기</h2>
          {info.lanAddresses.map((url) => (
            <CopyRow key={url} value={url} />
          ))}
          <p className="hintline muted">같은 네트워크의 태블릿·노트북 브라우저에서 이 주소로 접속하세요.</p>
        </div>
      )}

      <div className="card">
        <h2>확인용 링크</h2>
        <div className="candidates">
          <a href="/output/?layer=main&demo=1&preview=1" target="_blank" rel="noreferrer">
            <button type="button">데모 + 미리보기 배경</button>
          </a>
          <a href="/output/?layer=main&demo=1" target="_blank" rel="noreferrer">
            <button type="button">데모 (투명 배경)</button>
          </a>
          <a href="/output/?layer=main&debug=1" target="_blank" rel="noreferrer">
            <button type="button">실시간 + 진단 배지</button>
          </a>
        </div>
      </div>

      <BackupCard />

      <div className="card">
        <h2>서버 정보</h2>
        <dl className="meta">
          <dt>포트</dt>
          <dd>{info.port}</dd>
          <dt>역본</dt>
          <dd>{info.bibleReady ? `${info.translationCount}개` : '성경 DB 없음'}</dd>
          <dt>찬양</dt>
          <dd>{info.songCount.toLocaleString()}곡</dd>
          <dt>예배 순서</dt>
          <dd>{info.planCount}개</dd>
          <dt>데이터 폴더</dt>
          <dd>{info.dataDir}</dd>
          <dt>원본 성경 DB</dt>
          <dd>{info.bibleSourceDir}</dd>
        </dl>
      </div>
    </>
  );
}
