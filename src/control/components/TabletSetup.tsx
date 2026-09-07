/**
 * 태블릿 접속 준비 — **접속 암호와 열기/닫기를 화면에서** 한다 (점검 P-1, 2026-09-07).
 *
 * ## 왜 만들었나
 *
 * 여태 이 자리에는 `presentation lan` 과 `npm run password` 를 입력하라는 안내가
 * 있었다. **설치판(DMG·EXE)을 받은 봉사자에게는 터미널도 저장소도 alias 도 없다** —
 * 할 수 없는 일을 시킨 것이다. 성경 DB 안내에서 이미 같은 것을 겪고 고쳤는데
 * (`lib/bible-missing.ts`) 여기는 그대로였다.
 *
 * ## 순서를 강제한다 — 암호 먼저, 그다음 열기
 *
 * 암호 없이 랜을 열면 같은 WiFi 의 누구나 예배 화면을 바꾸고 가사를 지울 수 있다
 * (감사 H-1·H-2 에서 실증됐다). 그래서 암호가 없으면 '열기' 를 누를 수 없고,
 * 서버도 그 요청을 409 로 거부한다 — 화면만 막으면 화면을 우회할 수 있다.
 *
 * ## 켜자마자 열리지 않는다
 *
 * 바인딩 주소는 서버가 뜰 때 한 번 정해진다. 도는 중에 리스너를 더 여는 장치를
 * **예배 중에 도는 서버**에 넣는 것은 위험이 이득보다 크다. 그래서 값만 저장하고
 * 다시 시작할 때 반영하며, **무엇을 다시 시작해야 하는지**를 설치판/소스에 따라
 * 갈라서 말해 준다.
 */

import { useState } from 'react';

import { api, ApiError, type TabletAccess } from '../api.ts';

/** 암호 최소 길이 — 서버(`setPassword`)와 같은 값이어야 한다 */
const MIN_LENGTH = 4;

function restartHint(packaged: boolean, open: boolean): string {
  if (!open) {
    return packaged
      ? '앱을 닫고 다시 열면 이 PC 안에서만 열립니다.'
      : '서버를 다시 띄우면 이 PC 안에서만 열립니다 (presentation 또는 ./start.sh).';
  }
  return packaged
    ? '앱을 닫고 다시 열면 태블릿에서 접속할 수 있습니다. 그때 이 카드에 QR 이 나옵니다.'
    : '서버를 다시 띄우면 태블릿에서 접속할 수 있습니다 (presentation lan 또는 ./start.sh lan).';
}

/**
 * 지금 상태를 한 줄로.
 *
 * **'지금 열렸나' 와 '다시 시작하면 열리나' 를 나눠 말한다.** 합쳐 놓으면 켠 직후
 * '닫혀 있습니다 · [열기]' 로 남아 눌렀는데 아무 일도 없는 것처럼 보인다
 * (브라우저로 실제로 눌러 보고 발견했다).
 */
function lanStatus(access: TabletAccess): React.JSX.Element {
  if (access.lanOpen) return <b className="ok-text">열려 있습니다</b>;
  if (access.lanWanted) {
    return (
      <>
        <b>닫혀 있습니다</b> <span className="warn-text">— 다시 시작하면 열립니다</span>
      </>
    );
  }
  return <b>닫혀 있습니다</b>;
}

export function TabletSetup({
  access,
  onChanged,
}: {
  access: TabletAccess;
  onChanged: () => void;
}): React.JSX.Element {
  const [editing, setEditing] = useState(!access.passwordSet);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const tooShort = password.length > 0 && password.length < MIN_LENGTH;
  const mismatch = confirm.length > 0 && password !== confirm;
  const canSave = password.length >= MIN_LENGTH && password === confirm && !busy;

  /** 어떤 요청이든 같은 뒤처리를 한다 — 오류를 삼키지 않고, 성공하면 다시 읽는다 */
  async function run(action: () => Promise<string>): Promise<void> {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      setDone(await action());
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '바꾸지 못했습니다');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="row tablet-setup-row">
        <span className="grow">
          접속 암호{' '}
          {access.passwordSet ? (
            <b className="ok-text">정해져 있습니다</b>
          ) : (
            <b className="warn-text">아직 없습니다</b>
          )}
        </span>
        {access.passwordSet && !editing && (
          <>
            <button type="button" onClick={() => setEditing(true)} disabled={busy}>
              바꾸기
            </button>
            {/* 랜이 열려 있는 동안에는 없앨 수 없다 — 서버도 409 로 막는다 */}
            {!access.lanWanted && (
              <button
                type="button"
                onClick={() =>
                  void run(async () => {
                    await api.clearPassword();
                    setEditing(false);
                    return '암호를 없앴습니다. 태블릿으로는 열 수 없습니다.';
                  })
                }
                disabled={busy}
              >
                없애기
              </button>
            )}
          </>
        )}
      </div>

      {editing && (
        <form
          className="tablet-password-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (!canSave) return;
            void run(async () => {
              await api.setPassword(password);
              setPassword('');
              setConfirm('');
              setEditing(false);
              return '암호를 정했습니다. 이미 접속해 있던 기기는 다시 넣어야 합니다.';
            });
          }}
        >
          <div className="field">
            <label htmlFor="tablet-password">새 접속 암호</label>
            <input
              id="tablet-password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder={`${MIN_LENGTH}자 이상`}
            />
          </div>
          <div className="field">
            <label htmlFor="tablet-password-confirm">한 번 더</label>
            <input
              id="tablet-password-confirm"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
            />
          </div>
          <div className="row">
            <button type="submit" className="primary" disabled={!canSave}>
              암호 정하기
            </button>
            {access.passwordSet && (
              <button
                type="button"
                onClick={() => {
                  setEditing(false);
                  setPassword('');
                  setConfirm('');
                }}
                disabled={busy}
              >
                그만두기
              </button>
            )}
          </div>
          {tooShort && <p className="hintline warn">{MIN_LENGTH}자 이상이어야 합니다.</p>}
          {mismatch && <p className="hintline warn">두 번 넣은 값이 다릅니다.</p>}
          <p className="hintline muted">
            태블릿에서 <b>처음 열 때 한 번</b> 넣으면 30일간 기억합니다. 이 PC(컨트롤 패널·OBS·
            프로젝터)는 묻지 않습니다.
          </p>
        </form>
      )}

      <div className="row tablet-setup-row">
        <span className="grow">태블릿 접속 {lanStatus(access)}</span>
        {/*
          버튼은 **저장된 선택**(`lanWanted`)을 뒤집는다. 지금 열려 있는지가 아니다 —
          그러면 켠 직후에도 '열기' 로 남아 되돌릴 방법이 없다.
        */}
        <button
          type="button"
          className={access.lanWanted ? undefined : 'primary'}
          disabled={busy || (!access.lanWanted && !access.passwordSet)}
          title={
            !access.lanWanted && !access.passwordSet ? '먼저 접속 암호를 정하세요' : undefined
          }
          onClick={() =>
            void run(async () => {
              const result = await api.setLanOpen(!access.lanWanted);
              return restartHint(result.packaged, result.lanOpen);
            })
          }
        >
          {access.lanWanted ? '닫기' : '열기'}
        </button>
      </div>

      {!access.lanWanted && !access.passwordSet && (
        <p className="hintline muted">
          암호를 정해야 열 수 있습니다 — 암호 없이 열면 같은 WiFi 의 누구나 예배 화면을 바꿀 수
          있습니다.
        </p>
      )}

      {error && <p className="hintline warn">{error}</p>}
      {done && <p className="hintline ok">{done}</p>}
    </>
  );
}
