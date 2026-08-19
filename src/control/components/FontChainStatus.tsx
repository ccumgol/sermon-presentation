/**
 * 폰트 체인에서 **실제로 쓰이는 폰트**를 재서 보여 준다.
 *
 * 왜 필요한가 — 이름을 적어 넣어도 그대로 잡히지 않는 일이 잦다. 실제로 겪었다:
 * 파일이 `BareunBatangOTFPro-3.otf` 라 `"BareunBatangOTFPro 3"` 으로 적었더니
 * 어디에도 안 걸려 **조용히 고딕으로 대체**됐다. 화면은 멀쩡해 보여 알아채기 어렵다.
 * 폰트를 새로 설치했는데 반영이 안 되는 경우도 마찬가지다.
 *
 * 재는 방법은 `../fontProbe.ts` 에 있다 — 설정 탭의 설치 안내와 **같은 장치**를 쓴다.
 * 재는 방식이 두 벌이면 한쪽은 '있다', 한쪽은 '없다' 로 갈려 어느 쪽을 믿을지 모른다.
 */

import { useEffect, useState } from 'react';

import { isGenericFamily } from '../../../lib/font-chain.ts';
import { probeChain, type ChainProbe } from '../fontProbe.ts';

interface Props {
  /** 검사할 CSS 폰트 체인 */
  value: string;
  /** 재는 데 쓸 표본 글자 — 한글 폰트는 한글로 재야 뜻이 있다 */
  sample?: string;
}

export function FontChainStatus({ value, sample }: Props): React.JSX.Element | null {
  const [probe, setProbe] = useState<ChainProbe | null>(null);

  useEffect(() => {
    // 폰트가 아직 로드되는 중일 수 있어 준비된 뒤에 잰다
    let cancelled = false;
    const run = (): void => {
      if (!cancelled) setProbe(probeChain(value, sample));
    };
    if (document.fonts?.ready) void document.fonts.ready.then(run);
    else run();
    return () => {
      cancelled = true;
    };
  }, [value, sample]);

  if (!probe || !probe.used) return null;

  const generic = isGenericFamily(probe.used);
  return (
    <p className={`hintline ${generic ? 'error' : probe.missing.length > 0 ? 'warn' : 'ok'}`}>
      실제 사용: <b>{probe.used}</b>
      {probe.missing.length > 0 && <> · 없는 폰트: {probe.missing.join(', ')}</>}
      {generic && <> — 총칭으로 떨어졌습니다. 글자마다 다른 폰트로 대체될 수 있습니다.</>}
    </p>
  );
}
