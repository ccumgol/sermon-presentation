/**
 * 폰트 체인에서 **실제로 쓰이는 폰트**를 재서 보여 준다.
 *
 * 왜 필요한가 — 이름을 적어 넣어도 그대로 잡히지 않는 일이 잦다. 실제로 겪었다:
 * 파일이 `BareunBatangOTFPro-3.otf` 라 `"BareunBatangOTFPro 3"` 으로 적었더니
 * 어디에도 안 걸려 **조용히 고딕으로 대체**됐다. 화면은 멀쩡해 보여 알아채기 어렵다.
 * 폰트를 새로 설치했는데 반영이 안 되는 경우도 마찬가지다.
 *
 * 재는 방법은 폭 비교다. 어떤 이름을 지정했을 때의 글자 폭이 총칭 대체 폰트의 폭과
 * 같으면 그 이름은 없는 것으로 본다. 브라우저가 "이 폰트를 썼다"를 직접 알려주는
 * 표준 방법이 없어 이 방식을 쓴다.
 */

import { useEffect, useState } from 'react';

import { isGenericFamily, parseFontChain } from '../../../lib/font-chain.ts';

interface Props {
  /** 검사할 CSS 폰트 체인 */
  value: string;
  /** 재는 데 쓸 표본 글자 — 한글 폰트는 한글로 재야 뜻이 있다 */
  sample?: string;
}

interface Probe {
  used: string | null;
  missing: string[];
}

/** 폭을 재서 이 이름이 실제로 있는지 본다 */
function measure(family: string, sample: string, weight: number): number {
  const span = document.createElement('span');
  span.style.cssText =
    'position:absolute;visibility:hidden;white-space:nowrap;font-size:200px;left:-9999px;top:-9999px';
  span.style.fontWeight = String(weight);
  span.style.fontFamily = family;
  span.textContent = sample;
  document.body.appendChild(span);
  const width = span.getBoundingClientRect().width;
  span.remove();
  return width;
}

function probeChain(css: string, sample: string): Probe {
  const names = parseFontChain(css);
  const missing: string[] = [];

  // 없는 이름을 지정했을 때 나오는 폭 두 가지. 둘 다와 같으면 대체된 것으로 본다.
  const fallbackSans = measure('sans-serif', sample, 700);
  const fallbackSerif = measure('serif', sample, 700);

  for (const name of names) {
    if (isGenericFamily(name)) {
      // 총칭까지 왔다면 앞의 실제 폰트가 하나도 없었다는 뜻이다
      return { used: name, missing };
    }
    const width = measure(`"${name}", sans-serif`, sample, 700);
    const widthSerif = measure(`"${name}", serif`, sample, 700);
    // 두 총칭 어느 쪽에 붙여도 폭이 그 총칭과 같다면 이름이 안 잡힌 것이다
    if (width === fallbackSans && widthSerif === fallbackSerif) {
      missing.push(name);
      continue;
    }
    return { used: name, missing };
  }

  return { used: null, missing };
}

export function FontChainStatus({ value, sample = '찬양과 경배' }: Props): React.JSX.Element | null {
  const [probe, setProbe] = useState<Probe | null>(null);

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
