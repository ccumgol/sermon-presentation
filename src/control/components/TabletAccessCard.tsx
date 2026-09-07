/**
 * 태블릿 연결 — QR 을 띄운다.
 *
 * 주소를 손으로 넣는 것이 실제로 잘 안 됐다. 포트(`:7777`)를 빼먹거나 Safari 가
 * `https://` 로 바꿔 버리면 연결되지 않는데, 화면에는 그냥 '접속 실패' 만 나온다.
 * QR 을 찍으면 그 두 실수가 사라진다.
 *
 * **QR 에는 주소만 담는다.** 암호를 담으면 그 그림이 곧 열쇠가 된다 — 예배당에서
 * 화면은 여러 사람이 스치듯 본다. 찍으면 로그인 화면이 뜨고 암호는 사람이 넣는다.
 */

import { useCallback, useEffect, useState } from 'react';

import { api, ApiError, type TabletAccess } from '../api.ts';
import { TabletSetup } from './TabletSetup.tsx';

/** QR 한 장. `size` 는 여백을 포함한 모듈 수 */
function QrImage({
  qr,
  label,
}: {
  qr: { size: number; path: string };
  label: string;
}): React.JSX.Element {
  return (
    <svg
      className="qr"
      viewBox={`0 0 ${qr.size} ${qr.size}`}
      role="img"
      aria-label={label}
      /* shapeRendering: 모듈 경계가 흐려지면 인식률이 떨어진다 */
      shapeRendering="crispEdges"
    >
      {/* 흰 바탕을 직접 깔아 준다 — 어두운 테마에서도 QR 은 흑백이어야 읽힌다 */}
      <rect width={qr.size} height={qr.size} fill="#fff" />
      <path d={qr.path} fill="#000" />
    </svg>
  );
}

export function TabletAccessCard(): React.JSX.Element | null {
  const [access, setAccess] = useState<TabletAccess | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setAccess(await api.tabletAccess());
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '태블릿 연결 정보를 읽지 못했습니다');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) {
    return (
      <div className="card">
        <h2>태블릿에서 조작하기</h2>
        <p className="hintline warn">{error}</p>
      </div>
    );
  }

  if (!access) return null;

  /*
   * ── LAN 이 닫혀 있다 ─────────────────────────────────────────
   *
   * 주소를 보여 주지 않는다 — 열리지 않는 주소를 주면 '접속이 안 된다' 가 된다.
   *
   * 전에는 여기서 `presentation lan` 을 입력하라고 안내했다. **설치판에는 터미널도
   * alias 도 없다** (점검 P-1). 이제 이 카드에서 암호를 정하고 열 수 있다.
   */
  if (!access.lanOpen) {
    return (
      <div className="card">
        <h2>태블릿에서 조작하기</h2>
        <p className="hintline muted">
          지금은 <b>이 PC 안에서만</b> 열려 있습니다. 태블릿으로도 조작하려면 접속 암호를 정한 뒤
          열어 주세요.
        </p>
        <TabletSetup access={access} onChanged={load} />
      </div>
    );
  }

  return (
    <div className="card">
      <h2>태블릿에서 조작하기</h2>

      {/*
        암호가 없으면 **가장 먼저** 말한다 — 이 상태의 랜은 감사 H-1 이 막으려던
        상태다. 전에는 `npm run password` 를 시켰는데 설치판에서는 할 수 없다.
      */}
      {!access.passwordSet && (
        <p className="hintline warn">
          <b>접속 암호가 정해져 있지 않습니다.</b> 아래에서 정하세요 — 지금은 같은 WiFi 의 누구나
          예배 화면을 바꿀 수 있습니다.
        </p>
      )}

      <TabletSetup access={access} onChanged={load} />

      <p className="hintline muted">
        태블릿 카메라로 QR 을 찍으면 로그인 화면이 열립니다. <b>암호는 그때 한 번</b> 넣고,
        이후 30일간 기억합니다.
      </p>

      <div className="qr-list">
        {access.targets.map((target) => (
          <figure className="qr-item" key={target.url}>
            <QrImage qr={target.qr} label={`태블릿 접속 주소 ${target.url}`} />
            <figcaption>
              <code>{target.url}</code>
              <span className="muted">{target.iface}</span>
            </figcaption>
          </figure>
        ))}
      </div>

      {access.targets.length > 1 && (
        <p className="hintline muted">
          주소가 여러 개인 것은 정상입니다 — Wi-Fi 와 유선이 함께 붙어 있으면 각각 하나씩
          나옵니다. <b>태블릿 IP 와 앞 세 자리가 같은 것</b>을 찍으세요 (태블릿 설정 → Wi-Fi
          에서 확인).
        </p>
      )}

      <p className="hintline muted">
        찍어도 열리지 않으면 태블릿이 <b>같은 WiFi</b> 인지 보세요. 게스트 망은 기기끼리
        통신을 막는 경우가 많습니다.
      </p>
    </div>
  );
}
