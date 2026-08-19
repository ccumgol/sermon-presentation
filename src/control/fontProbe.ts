/**
 * 폰트가 이 PC 에 **실제로 있는지** 재는 장치.
 *
 * 브라우저에는 "이 폰트를 썼다" 를 알려주는 표준 방법이 없다. 그래서 폭을 비교한다 —
 * 어떤 이름을 지정했을 때의 글자 폭이 총칭 대체 폰트의 폭과 같으면 그 이름은 없는 것이다.
 *
 * `document.fonts.check()` 를 쓰지 않는 이유: 설치되지 않은 이름에도 `true` 를 주는
 * 브라우저가 있어 믿을 수 없다. 폭 비교는 화면에 실제로 그려지는 것을 재므로 정확하다.
 *
 * **두 총칭 모두와 비교**한다. 한쪽만 보면, 예를 들어 명조 이름을 `sans-serif` 에만
 * 붙여 재면 명조가 없어도 폭이 달라 '있다' 로 잘못 읽는다.
 */

import { isGenericFamily, parseFontChain } from '../../lib/font-chain.ts';

/** 한글 폰트는 한글로 재야 뜻이 있다 — 라틴 글리프만 가진 폰트에 속지 않게 */
const DEFAULT_SAMPLE = '찬양과 경배';

function measure(family: string, sample: string, weight = 700): number {
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

/**
 * 이름 하나가 이 PC 에 있는지.
 *
 * 총칭 이름(`serif` 등)은 언제나 '있다' 다 — 브라우저가 무언가를 고르기 때문이다.
 */
export function isFontInstalled(family: string, sample = DEFAULT_SAMPLE): boolean {
  if (isGenericFamily(family)) return true;

  const sans = measure('sans-serif', sample);
  const serif = measure('serif', sample);
  const withSans = measure(`"${family}", sans-serif`, sample);
  const withSerif = measure(`"${family}", serif`, sample);

  // 두 총칭 어느 쪽에 붙여도 그 총칭과 폭이 같다면 이름이 안 잡힌 것이다
  return !(withSans === sans && withSerif === serif);
}

export interface ChainProbe {
  /** 실제로 쓰이는 이름 (총칭까지 내려갔으면 그 총칭) */
  used: string | null;
  /** 앞에서 건너뛴 — 이 PC 에 없는 이름들 */
  missing: string[];
}

/** 체인을 앞에서부터 훑어 처음으로 잡히는 이름을 찾는다 */
export function probeChain(css: string, sample = DEFAULT_SAMPLE): ChainProbe {
  const missing: string[] = [];

  for (const name of parseFontChain(css)) {
    // 총칭까지 왔다면 앞의 실제 폰트가 하나도 없었다는 뜻이다
    if (isGenericFamily(name)) return { used: name, missing };
    if (!isFontInstalled(name, sample)) {
      missing.push(name);
      continue;
    }
    return { used: name, missing };
  }

  return { used: null, missing };
}
