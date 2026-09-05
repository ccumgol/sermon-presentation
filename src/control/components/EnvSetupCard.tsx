/**
 * **환경 점검 · 데이터 폴더** — 이 PC 가 예배를 진행할 준비가 됐는가.
 *
 * ## 왜 필요한가
 *
 * 봉사자 PC 에 앱만 깔면 반만 준비된 것이다. OBS 가 없으면 방송이 안 나간다.
 * 그런데 없다는 것을 **예배 직전에야** 알게 되는 것이 문제였다.
 *
 * ## 자동으로 설치하지 않는다
 *
 * 다른 회사 프로그램을 사용자 모르게 내려받아 실행하지 않는다(사용자 결정
 * 2026-09-05). 무엇을 왜 설치하는지 적어 두고, **누르면 그때** 명령을 돌린다.
 * 설치 도구가 없으면 공식 페이지를 열어 준다.
 *
 * ## 데이터 폴더 열기
 *
 * 포장한 앱에서는 데이터가 `Application Support`·`AppData` 안에 있어 **사람이
 * 찾아갈 수 없는 자리**다. 백업을 챙기거나 배경 그림을 넣으려면 여는 길이 있어야 한다.
 */

import { useCallback, useEffect, useState } from 'react';

import type { EnvStatus } from '../../../lib/env-check.ts';
import { api, ApiError } from '../api.ts';

export function EnvSetupCard({ dataDir }: { dataDir: string }): React.JSX.Element {
  const [items, setItems] = useState<EnvStatus[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** 지금 설치 중인 항목 id — 여러 번 눌러 두 번 설치되지 않게 */
  const [installing, setInstalling] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setItems((await api.envCheck()).items);
    } catch {
      // 점검에 실패해도 나머지 설정은 써야 한다 — 이 카드만 조용히 접는다
      setItems([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function openFolder(): Promise<void> {
    setError(null);
    setNotice(null);
    try {
      const result = await api.openDataDir();
      setNotice(`폴더를 열었습니다 — ${result.path}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '폴더를 열지 못했습니다');
    }
  }

  async function install(item: EnvStatus): Promise<void> {
    if (!item.command) return;
    // 무엇을 돌리는지 **보여 주고** 확인받는다. 남의 프로그램을 설치하는 일이다
    if (!confirm(`${item.label} 을(를) 설치합니다.\n\n실행할 명령:\n${item.command}\n\n몇 분 걸릴 수 있습니다. 진행할까요?`)) return;

    setInstalling(item.id);
    setError(null);
    setNotice(null);
    try {
      await api.installEnvItem(item.command);
      setNotice(`${item.label} 을(를) 설치했습니다.`);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : `${item.label} 설치에 실패했습니다`);
    } finally {
      setInstalling(null);
    }
  }

  const missingRequired = (items ?? []).filter((one) => !one.installed && !one.optional);

  return (
    <div className="card">
      <h2>이 PC 준비 상태</h2>

      {error && <p className="hintline warn">{error}</p>}
      {notice && <p className="hintline ok">{notice}</p>}

      {missingRequired.length > 0 && (
        <p className="hintline warn">
          <b>{missingRequired.map((one) => one.label).join(' · ')} 이(가) 없습니다.</b> 예배 전에
          설치해 두세요 — 예배 직전에 알면 손쓸 시간이 없습니다.
        </p>
      )}

      {items !== null && items.length > 0 && (
        <ul className="env-list">
          {items.map((item) => (
            <li key={item.id} className={item.installed ? 'done' : item.optional ? '' : 'missing'}>
              <span className="mark">{item.installed ? '✓' : item.optional ? '·' : '!'}</span>
              <span className="body">
                <span className="title">
                  {item.label}
                  {item.optional && <span className="dim"> (없어도 됩니다)</span>}
                </span>
                <span className="why">{item.why}</span>
                {!item.installed && item.command && (
                  <code className="cmd" title="이 명령을 그대로 실행합니다">{item.command}</code>
                )}
              </span>
              <span className="actions">
                {item.installed ? (
                  <span className="dim">설치됨</span>
                ) : item.command ? (
                  <button type="button" disabled={installing !== null} onClick={() => void install(item)}>
                    {installing === item.id ? '설치 중…' : `${item.tool} 로 설치`}
                  </button>
                ) : (
                  <a className="button-link" href={item.homepage} target="_blank" rel="noreferrer">
                    내려받기
                  </a>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}

      {/*
        데이터 폴더 열기.

        경로를 **글자로도 보여 준다** — 단추가 안 먹는 환경(원격 접속 등)에서도
        어디를 찾아가야 하는지는 알 수 있어야 한다.
      */}
      <div className="row data-dir-row">
        <button type="button" className="primary" onClick={() => void openFolder()}>
          데이터 폴더 열기
        </button>
        <code className="path">{dataDir}</code>
      </div>
      <p className="hintline muted">
        가사·순서표·배경 그림·백업이 모두 이 폴더에 있습니다. <b>이 폴더만 복사하면 이사가 됩니다.</b>
        {' '}옮기기 전에 <b>앱을 완전히 끄세요</b> — 켜져 있으면 반쪽만 복사됩니다.
      </p>
    </div>
  );
}
