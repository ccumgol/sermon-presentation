/**
 * 이 PC 가 LAN 에서 어떤 주소로 보이는가.
 *
 * `app.ts` 에서 떼어냈다 — 라우트(`routes/tablet.ts`)가 이것을 쓰는데, `app.ts` 는
 * 라우트를 불러오므로 그대로 두면 순환 참조가 된다.
 */

import { networkInterfaces } from 'node:os';

/**
 * LAN 에서 닿을 수 있는 주소들 — **어느 장치인지 함께 준다.**
 *
 * 맥에 Wi-Fi 와 USB 이더넷이 함께 붙어 있으면 주소가 두 개 뜬다. 그때 '어느 것을
 * 태블릿에 넣어야 하나' 를 알 수 없어 헤맸다(실제로 겪음). 장치 이름을 붙여 두면
 * 시스템 설정 → 네트워크 와 짝지어 볼 수 있다.
 *
 * 장치 이름(en0)을 사람이 읽는 이름(Wi-Fi)으로 바꾸려면 macOS 명령을 불러야 하는데,
 * 예배 중 도는 서버가 기동할 때 외부 프로세스를 띄우는 위험을 만들지 않는다.
 */
export function lanInterfaces(): Array<{ address: string; iface: string }> {
  const out: Array<{ address: string; iface: string }> = [];
  for (const [iface, addrs] of Object.entries(networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      if (!isLanCandidate(iface, a.address)) continue;
      out.push({ address: a.address, iface });
    }
  }
  return out;
}

/**
 * VPN 터널 장치 — 여기 붙은 주소로는 태블릿이 우리를 찾을 수 없다.
 *
 * 실제로 Tailscale 의 `utun8`(100.x)이 태블릿 주소 목록에 섞여 나왔다. 찍어도 열리지
 * 않는 QR 이 하나 더 생기면 예배 직전에 헤매게 된다.
 *
 * `bridge*` 는 빼지 않는다 — 인터넷 공유로 태블릿을 맥에 직접 붙이는 것도 정당한 방법이다.
 */
const TUNNEL_PREFIXES = ['utun', 'tun', 'tap', 'ppp', 'ipsec', 'awdl', 'llw'] as const;

/** 사설 IPv4 인가 (RFC1918) — 공유기가 나눠 주는 주소 대역 */
function isPrivateIpv4(address: string): boolean {
  const parts = address.split('.');
  if (parts.length !== 4) return false;
  const nums = parts.map((part) => (/^\d{1,3}$/.test(part) ? Number(part) : Number.NaN));
  if (nums.some((value) => Number.isNaN(value) || value > 255)) return false;
  const [a, b] = nums as [number, number, number, number];
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

/**
 * 태블릿에게 알려 줄 만한 주소인가.
 *
 * 사설 대역이 아니면 뺀다 — Tailscale 의 `100.64/10`(CGNAT)이나 공인 주소가 섞이면
 * 열리지 않는 주소를 보여 주게 된다.
 */
export function isLanCandidate(iface: string, address: string): boolean {
  if (TUNNEL_PREFIXES.some((prefix) => iface.startsWith(prefix))) return false;
  return isPrivateIpv4(address);
}

export function lanHosts(): string[] {
  return lanInterfaces().map((entry) => entry.address);
}
