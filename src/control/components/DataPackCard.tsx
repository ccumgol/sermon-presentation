/**
 * **자료 설치** — 다른 PC 에서 만든 자료 꾸러미를 이 PC 에 넣는다 (2026-09-12 사용자 요청).
 *
 * ## 누르기 전에 무엇이 되는지 보여 준다
 *
 * 158MB 짜리 파일들을 바꾸는 일이다. '설치' 한 단어만 두고 누르게 하면, 무엇이
 * 덮이고 무엇이 남는지 모른 채 누르게 된다 — 이 프로젝트에서 가장 비싼 실수는
 * **되돌릴 수 없는 자료를 잃는 것**이다.
 *
 * ## 가사·순서표는 건드리지 않는다
 *
 * 이미 있으면 '건너뜀' 으로 보여 준다. 합치려면 아래의 '자료 가져오기(번들)' 를 쓴다.
 */

import { useCallback, useEffect, useState } from 'react';

import { api, ApiError } from '../api.ts';
import { formatBytes } from '../../../lib/data-pack.ts';

interface PlanRow {
  name: string;
  action: 'install' | 'replace' | 'skip';
  reason?: string;
}

interface PackStatus {
  dir: string;
  found: boolean;
  manifest?: { version: string; builtAt: string; entries: Array<{ name: string; bytes: number; files?: number }> };
  plan: PlanRow[];
}

const ACTION_LABEL: Record<PlanRow['action'], string> = {
  install: '넣습니다',
  replace: '바꿉니다',
  skip: '건너뜁니다',
};

export function DataPackCard(): React.JSX.Element {
  const [status, setStatus] = useState<PackStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /** 건너뛴 것까지 덮을지 — **일부러 켜야 한다.** 잃는 것이 되돌릴 수 없는 자료다 */
  const [overwriteMine, setOverwriteMine] = useState(false);

  const reload = useCallback(async () => {
    try {
      setStatus(await api.dataPack());
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '꾸러미를 살펴보지 못했습니다');
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const install = useCallback(async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await api.installDataPack(overwriteMine);
      const parts = [`${result.installed.join(' · ')} 을(를) 넣었습니다`];
      if (result.skipped.length > 0) parts.push(`${result.skipped.join(' · ')} 은(는) 그대로 두었습니다`);
      if (result.restartRequired) parts.push('**앱을 다시 시작해야** 성경이 반영됩니다');
      setNotice(parts.join('. '));
      await reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '설치하지 못했습니다');
    } finally {
      setBusy(false);
    }
  }, [overwriteMine, reload]);

  const doing = overwriteMine ? (status?.plan ?? []) : (status?.plan.filter((row) => row.action !== 'skip') ?? []);

  return (
    <div className="card">
      <h2>자료 설치</h2>

      {!status?.found && (
        <>
          <p className="hintline muted">
            다른 PC 에서 만든 <b>자료 꾸러미</b>(성경·가사·악보)를 이 PC 에 넣습니다.
          </p>
          <ol className="hintline muted">
            <li>위의 <b>데이터 폴더 열기</b> 를 누릅니다</li>
            <li>
              받은 <code>sermon-data-…</code> 폴더를 그 안에 <b><code>install</code></b> 이라는
              이름으로 넣습니다
            </li>
            <li>아래 <b>다시 보기</b> 를 누릅니다</li>
          </ol>
          <p className="hintline muted">
            찾는 자리: <code>{status?.dir ?? '…'}</code>
          </p>
        </>
      )}

      {status?.found && status.manifest && (
        <>
          <p className="hintline ok">
            꾸러미 <b>{status.manifest.version}</b> 을(를) 찾았습니다 —{' '}
            {new Date(status.manifest.builtAt).toLocaleString('ko-KR')} 에 만들어짐
          </p>

          {/* 누르기 전에 무엇이 되는지 — 이 표가 이 카드의 핵심이다 */}
          <table className="pack-plan">
            <tbody>
              {status.plan.map((row) => {
                const entry = status.manifest?.entries.find((one) => one.name === row.name);
                return (
                  <tr key={row.name} className={row.action === 'skip' ? 'muted' : undefined}>
                    <td><code>{row.name}</code></td>
                    <td>{entry ? formatBytes(entry.bytes) : ''}</td>
                    <td>
                      <b>{ACTION_LABEL[row.action]}</b>
                      {row.reason && <div><small>{row.reason}</small></div>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {status.plan.some((row) => row.action === 'skip') && (
            <label className="check" title="이 PC 에 만들어 둔 것이 사라집니다">
              <input
                type="checkbox"
                checked={overwriteMine}
                onChange={(e) => setOverwriteMine(e.target.checked)}
              />
              건너뛴 것까지 <b>덮어쓰기</b> — 이 PC 의 가사·순서표·설정이 꾸러미 것으로 바뀝니다
            </label>
          )}

          <p className="hintline muted">
            바꾸기 전에 <b>지금 자료를 백업</b>합니다 (<code>backups/</code>).
            백업이 실패하면 아무것도 바꾸지 않고 멈춥니다.
          </p>
        </>
      )}

      <div className="row">
        <button type="button" onClick={() => void reload()} disabled={busy}>
          다시 보기
        </button>
        {status?.found && doing.length > 0 && (
          <button type="button" className="primary" onClick={() => void install()} disabled={busy}>
            {busy ? '넣는 중…' : `${doing.length}개 설치`}
          </button>
        )}
      </div>

      {notice && <p className="hintline ok">{notice}</p>}
      {error && <p className="hintline error">{error}</p>}
    </div>
  );
}
