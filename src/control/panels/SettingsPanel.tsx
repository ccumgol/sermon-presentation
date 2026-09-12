import { useCallback, useEffect, useRef, useState } from 'react';

import { api, ApiError, type ServerInfo } from '../api.ts';
import { DataPackCard } from '../components/DataPackCard.tsx';
import { EnvSetupCard } from '../components/EnvSetupCard.tsx';
import { FontSetupCard } from '../components/FontSetupCard.tsx';
import { TabletAccessCard } from '../components/TabletAccessCard.tsx';

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
  readings: number;
  songbooks: number;
  /** 악보 **상태** 개수 — 그림은 담기지 않는다 (폴더를 복사해야 한다) */
  sheets: number;
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
          // 대응곡은 곡을 다 만든 뒤에 걸린다. 0 이면 연결이 끊긴 것이니 보여야 한다
          (result.links > 0 ? ` · 대응곡 ${result.links}` : '') +
          (result.songbooks > 0 ? ` · 곡집 ${result.songbooks}` : '') +
          (result.readings > 0 ? ` · 교독문 ${result.readings}` : '') +
          // 악보는 **상태만** 옮겨진다. 그림이 없으면 화면에 안 나오므로 그렇게 적는다
          (result.sheets > 0 ? ` · 악보 상태 ${result.sheets}(그림은 폴더 복사)` : '') +
          // 오류가 아니라 정상 동작이다. 이 줄이 없으면 '찬양 0' 만 보고 실패로 읽는다
          (result.songsExisting > 0 ? ` (이미 있는 찬양 ${result.songsExisting}곡은 그대로 두었습니다)` : '') +
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
        찬양·곡집·교독문·템플릿·예배 순서·설정·폰트를 파일 하나로 옮깁니다. 다른 PC 에 설치할
        때 쓰세요.
      </p>
      {/*
        **담기지 않는 둘을 여기서 말한다** (점검 P-3). 전에는 '자료 가져오기로 각 PC 에
        넣는다' 고만 적어 두어, 받은 사람이 성경과 악보 그림이 없는 것을 나중에 알았다.
      */}
      <p className="hintline muted">
        <b>성경 DB 와 악보 그림은 담기지 않습니다.</b> 성경은 원본에서 다시 빌드하고(또는
        <code>bible.sqlite</code> 를 데이터 폴더에 넣고), 악보 그림은 데이터 폴더의{' '}
        <code>sheets</code> 폴더를 그대로 복사하세요 — 둘 다 파일 하나에 담기엔 너무 큽니다
        (약 100MB · 50MB). <b>악보의 단 경계와 검토 판정은 담깁니다.</b>
      </p>

      {summary && (
        <dl className="meta" style={{ marginTop: 10 }}>
          <dt>담길 내용</dt>
          <dd>
            찬양 {summary.songs} · 템플릿 {summary.templates} · 순서 {summary.plans} · 설정 {summary.settings}
            {summary.songbooks > 0 ? ` · 곡집 ${summary.songbooks}` : ''}
            {summary.readings > 0 ? ` · 교독문 ${summary.readings}` : ''}
            {summary.sheets > 0 ? ` · 악보 상태 ${summary.sheets}` : ''}
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

/**
 * 성경 DB 를 **언제 무엇으로** 만들었는지.
 *
 * 원본 자료가 바뀌었는데 다시 빌드하지 않으면 앱은 옛 본문을 계속 내보낸다. 그것을
 * 알아챌 단서가 화면에 하나도 없었다 — 서버는 `build_info` 를 들고 있었는데
 * 꺼내 보는 길이 없었다 (§4.6 U-7, 2026-09-03).
 */
function BibleBuildRows({ ready }: { ready: boolean }): React.JSX.Element | null {
  const [info, setInfo] = useState<Record<string, string> | null>(null);

  useEffect(() => {
    if (!ready) return;
    // 없어도 되는 정보다 — 실패하면 줄을 안 보여 주고 넘어간다
    void api.bibleBuildInfo().then(setInfo).catch(() => undefined);
  }, [ready]);

  if (!info) return null;

  const builtAt = info.built_at;
  const verses = info.verse_count;

  return (
    <>
      {builtAt && (
        <>
          <dt>성경 DB 빌드</dt>
          <dd>
            {new Date(builtAt).toLocaleString('ko-KR')}
            {verses ? ` · ${Number(verses).toLocaleString()}절` : ''}
          </dd>
        </>
      )}
    </>
  );
}

export function SettingsPanel({ info }: Props): React.JSX.Element {
  if (!info) return <p className="hintline muted">서버 정보를 불러오는 중…</p>;

  return (
    <>
      {/*
        준비 상태를 **맨 위**에 둔다. 처음 설치한 사람이 위에서 아래로 읽는데,
        OBS 가 아직 없는 상태에서 'OBS 브라우저 소스 URL' 부터 읽어도 할 일이 없다.
      */}
      <EnvSetupCard dataDir={info.dataDir} />

      <div className="card">
        <h2>OBS 브라우저 소스 URL</h2>
        <CopyRow value={info.outputUrl} />
      </div>

      {/*
        폰트 안내를 OBS 설정 **바로 다음**에 둔다. 처음 설치하는 사람이 위에서
        아래로 읽어 내려가는 순서에서, 소스를 만든 직후가 폰트를 챙길 자리다.
        더 아래로 밀면 스크롤 밖이라 아무도 안 본다.
      */}
      <DataPackCard />

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

      <TabletAccessCard />

      {/*
        프로젝터 안내.

        이 화면의 목적이 '주소줄까지 없애기' 이므로, **없애는 방법을 찾을 수 있는 자리**가
        필요하다. 사용자가 스크린샷으로 제목줄·출처줄을 표시하며 물어봤다 (2026-08-20) —
        기능은 있었지만 도달 방법이 눈에 띄지 않았다.
      */}
      <div className="card">
        <h2>프로젝터로 띄우기</h2>
        <p className="hintline muted">
          TV 가 아니라 프로젝터로 띄울 때 씁니다. 오른쪽 위 <b>프로젝터</b> 버튼으로 창을 열고,
          그 창을 프로젝터 화면으로 옮긴 뒤 <b>화면을 한 번 클릭</b>하세요 — 주소줄과 제목줄이
          사라집니다 (<b>F</b> 도 같습니다). 다음에 열 때는 첫 클릭에서 저절로 전체 화면이 됩니다.
        </p>
        <ol className="steps">
          <li>
            창 안에서 마우스를 움직이면 <b>글자 크기(+ −)</b> · <b>반전</b> 막대가 나옵니다.
            2.5초 뒤 다시 숨습니다
          </li>
          <li>
            OBS 와 <b>동시에 다른 배치</b>를 씁니다 — OBS 는 활성 템플릿, 프로젝터는
            <b> ‘전체 — 성경·찬송 겸용’</b> 고정
          </li>
          <li>
            매주 쓰신다면 <b>앱으로 설치</b>하세요. 크롬 주소창 오른쪽의 설치 아이콘(⊕) 또는
            메뉴 → <b>캐스트·저장 및 공유 → 페이지를 앱으로 설치</b>. 설치판은 <b>처음부터
            주소줄이 없는 전체 화면</b>으로 열립니다
          </li>
        </ol>
        <p className="hintline muted">
          이 창은 <b>OBS 연결 수에 세지 않습니다</b> — ‘OBS 미연결’ 표시는 정상입니다.
        </p>
      </div>

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
          {/*
            **판 번호를 맨 위에 둔다** (점검 P-7). 이 앱에는 자동 갱신이 없어서,
            고칠 것이 생기면 설치 파일을 다시 나눠 준다. 그때 받은 사람도 준
            사람도 '그거 새 판으로 깔았나' 를 확인할 방법이 있어야 한다.

            판 번호는 빌드마다 바뀌지 않으므로 **만든 시각**을 함께 낸다 —
            실제로 두 빌드를 가르는 것은 이쪽이다.
          */}
          <dt>판</dt>
          <dd>
            {info.version}
            {info.builtAt !== undefined && (
              <>
                {' '}
                <span className="muted">
                  ({new Date(info.builtAt).toLocaleString('ko-KR')} 에 만들어짐)
                </span>
              </>
            )}
          </dd>
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
          <BibleBuildRows ready={info.bibleReady} />
        </dl>
        {/*
          안내를 갈라 쓴다. 설치한 앱에는 터미널도 원본 자료도 없다 —
          `npm run` 을 시키는 것은 할 수 없는 일을 시키는 것이다.
        */}
        {info.bibleReady && !info.packaged && (
          <p className="hintline muted">
            원본 자료를 고쳤다면 <code>npm run bible:build</code> 로 다시 만들고 서버를 재시작하세요 —
            그때까지는 위 시각의 본문이 나갑니다.
          </p>
        )}
        {!info.bibleReady && (
          <p className="hintline warn">
            <b>성경 DB 가 없습니다.</b>{' '}
            {info.packaged ? (
              <>
                위의 <b>데이터 폴더 열기</b> 로 폴더를 연 뒤 그 안에 <code>bible.sqlite</code> 를
                넣고 앱을 다시 시작하세요.
              </>
            ) : (
              <>
                터미널에서 <code>npm run bible:build</code> 를 실행한 뒤 서버를 재시작하세요.
              </>
            )}
            <br />
            <small>찾은 자리: <code>{info.bibleDb}</code></small>
          </p>
        )}
      </div>
    </>
  );
}
