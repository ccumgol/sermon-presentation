/**
 * 대표 폰트 설치 안내 — 처음 쓰는 PC 에서 한 번 보는 화면.
 *
 * ## 왜 필요한가
 *
 * 폰트가 없어도 **화면은 멀쩡해 보인다.** 브라우저가 조용히 다른 글꼴로 대체하기
 * 때문이다. 그래서 "명조를 골랐는데 고딕이 나온다" 를 예배 중에야 알게 된다.
 * 교회 PC 를 바꾸거나 다른 노트북으로 옮겼을 때 특히 그렇다.
 *
 * 그래서 **묻지 않고 재서 보여 준다.** 있으면 조용히 넘어가고, 없으면 무엇을
 * 어디서 받는지 알려 준다. 재는 장치는 템플릿 탭의 '실제 사용' 표시와 같은 것을 쓴다.
 */

import { useEffect, useState } from 'react';

import { RECOMMENDED_FONTS } from '../../../lib/korean-fonts.ts';
import { isFontInstalled } from '../fontProbe.ts';

export function FontSetupCard(): React.JSX.Element | null {
  /** 아직 재지 않았으면 `null` — 재기 전에 '없다' 고 겁주지 않는다 */
  const [installed, setInstalled] = useState<Record<string, boolean> | null>(null);

  useEffect(() => {
    let cancelled = false;
    const run = (): void => {
      if (cancelled) return;
      const next: Record<string, boolean> = {};
      for (const font of RECOMMENDED_FONTS) next[font.family] = isFontInstalled(font.family);
      setInstalled(next);
    };
    // 폰트 로딩이 끝난 뒤에 재야 방금 설치한 것도 잡힌다
    if (document.fonts?.ready) void document.fonts.ready.then(run);
    else run();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!installed) return null;

  const missing = RECOMMENDED_FONTS.filter((font) => !installed[font.family]);

  return (
    <div className="card">
      <h2>화면 폰트</h2>

      {missing.length === 0 ? (
        <p className="hintline ok">
          권하는 폰트 두 개가 모두 설치돼 있습니다. 고딕·명조가 의도한 대로 나옵니다.
        </p>
      ) : (
        <p className="hintline warn">
          {missing.length === RECOMMENDED_FONTS.length ? '두 폰트가' : `'${missing[0]!.family}' 이(가)`}{' '}
          없습니다. 화면은 비슷해 보이지만 <b>다른 글꼴로 대체돼 나갑니다</b> — 특히 명조를
          골랐을 때 눈에 띕니다.
        </p>
      )}

      <ul className="font-list">
        {RECOMMENDED_FONTS.map((font) => {
          const ok = installed[font.family] === true;
          return (
            <li key={font.family}>
              <span className={`font-dot ${ok ? 'ok' : 'missing'}`} aria-hidden="true" />
              <span className="font-name" style={{ fontFamily: `"${font.family}", sans-serif` }}>
                {font.family}
              </span>
              <span className="muted font-why">{font.label}</span>
              {ok ? (
                <span className="muted">설치됨</span>
              ) : (
                <a href={font.url} target="_blank" rel="noreferrer">
                  받기
                </a>
              )}
            </li>
          );
        })}
      </ul>

      {missing.length > 0 && (
        <ol className="steps">
          <li>
            위 <strong>받기</strong> 를 눌러 구글 폰트에서 내려받기 (무료)
          </li>
          <li>
            압축을 풀고 <code>.ttf</code> 파일을 모두 선택해 설치 —
            맥은 두 번 클릭 후 <strong>서체 설치</strong>, 윈도우는 오른쪽 클릭 후{' '}
            <strong>모든 사용자용으로 설치</strong>
          </li>
          <li>
            <strong>OBS 를 다시 켜기</strong> — 브라우저 소스는 켜져 있는 동안 설치한 폰트를
            잡지 못합니다
          </li>
          <li>이 탭을 새로 고쳐 위 표시가 '설치됨' 으로 바뀌는지 확인</li>
        </ol>
      )}

      <p className="hintline muted">
        굵은 글씨를 쓰므로 <b>Bold 를 함께 설치</b>하세요. 없으면 브라우저가 억지로 굵게
        그려 글자가 뭉개집니다.
      </p>
    </div>
  );
}
