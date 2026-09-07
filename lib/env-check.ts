/**
 * **환경 점검** — 예배를 진행하려면 이 PC 에 무엇이 더 있어야 하는가.
 *
 * 봉사자 PC 에 앱만 깔면 반은 준비된 것이다. OBS 가 없으면 방송이 안 나가고,
 * 한글 폰트가 없으면 가사가 네모로 나온다. 그런데 **없다는 사실을 예배 직전에야**
 * 알게 되는 것이 문제였다.
 *
 * ## 자동으로 설치하지 않는다
 *
 * 다른 회사 프로그램을 사용자 모르게 내려받아 실행하는 것은 하지 않는다
 * (사용자 결정 2026-09-05). 무엇을 왜 설치하는지 화면에 적고, **누르면 그때**
 * 명령을 돌린다. 설치 도구(Homebrew·winget)가 없으면 공식 페이지를 열어 준다.
 *
 * ## 이 파일에는 판단만 둔다
 *
 * 실제로 파일이 있는지 보는 것은 `server/routes/system.ts` 가 한다. 여기 있는
 * 것은 '무엇을 어디서 찾고, 없으면 무슨 명령을 권하는가' 라는 **자료**다 —
 * 새 항목을 더할 때 한 곳만 고치면 되고, 검사로 확인할 수 있다.
 */

export type Platform = 'mac' | 'win' | 'other';

export interface EnvItem {
  id: string;
  label: string;
  /** 왜 필요한가 — 화면에 그대로 나간다 */
  why: string;
  /** 없어도 예배는 되는가 */
  optional: boolean;
  /** 이 경로 중 하나라도 있으면 설치된 것으로 본다 */
  paths: Partial<Record<Platform, string[]>>;
  /** 설치 도구가 있을 때 권하는 명령 */
  install: Partial<Record<Platform, { tool: string; command: string }>>;
  /** 설치 도구가 없을 때 열어 줄 공식 페이지 */
  homepage: string;
}

/**
 * 점검 목록.
 *
 * 폰트를 '있으면 좋은 것' 으로 두는 이유: 맥·윈도우 모두 한글 폰트를 기본으로
 * 갖고 있어 가사가 깨지지는 않는다. 다만 **예배용으로 골라 쓸 글꼴**이 있으면
 * 화면이 훨씬 낫다.
 */
export const ENV_ITEMS: readonly EnvItem[] = [
  {
    id: 'obs',
    label: 'OBS Studio',
    why: '예배 영상을 송출합니다. 이 앱은 OBS 의 브라우저 소스로 가사를 올립니다.',
    optional: false,
    paths: {
      mac: ['/Applications/OBS.app'],
      win: ['C:\\Program Files\\obs-studio\\bin\\64bit\\obs64.exe'],
    },
    install: {
      mac: { tool: 'brew', command: 'brew install --cask obs' },
      win: { tool: 'winget', command: 'winget install --id OBSProject.OBSStudio -e' },
    },
    homepage: 'https://obsproject.com/download',
  },
  {
    id: 'chrome',
    label: 'Google Chrome',
    why: '프로젝터 창을 앱처럼 띄울 수 있습니다(주소줄 없이). 없으면 기본 브라우저를 씁니다.',
    optional: true,
    paths: {
      mac: ['/Applications/Google Chrome.app'],
      win: ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'],
    },
    install: {
      mac: { tool: 'brew', command: 'brew install --cask google-chrome' },
      win: { tool: 'winget', command: 'winget install --id Google.Chrome -e' },
    },
    homepage: 'https://www.google.com/chrome/',
  },
];

/**
 * 설치 도구가 있을 만한 **절대 경로** — `which` 가 실패할 때 여기를 본다.
 *
 * ## 왜 필요한가 (점검 P-5, 2026-09-07 실측)
 *
 * **Finder·독으로 띄운 맥 앱의 `PATH` 는 셸의 것이 아니다.** 사용자가 띄워 둔
 * 설치 앱의 프로세스 환경을 읽어 보니 이랬다:
 *
 * ```
 * PATH=/usr/bin:/bin:/usr/sbin:/sbin
 * ```
 *
 * Homebrew 는 `/opt/homebrew/bin/brew` 에 **분명히 있는데**(6.0.18) 그 목록에
 * `/opt/homebrew/bin` 이 없다. 그래서 앱 안에서 `which brew` 가 실패하고,
 * 화면은 '설치 도구가 없습니다 → 공식 페이지' 로 떨어진다 — 한 번 누르면 되는
 * 일을 사람이 손으로 받아 설치하게 된다.
 *
 * 터미널로 돌릴 때는 셸의 `PATH` 를 물려받아 이 문제가 없다. **설치판에서만**
 * 나타나므로 만든 사람은 끝까지 모른다 (서명 문제와 같은 종류의 함정이다).
 *
 * 윈도우는 GUI 앱도 사용자 `PATH` 를 물려받아 대개 문제가 없지만, 같은 방식으로
 * 후보를 둔다 — 없으면 그냥 지나간다.
 */
export function toolCandidates(
  tool: string,
  platform: Platform,
  env: Record<string, string | undefined> = {},
): string[] {
  if (platform === 'mac' && tool === 'brew') {
    // 애플 실리콘 · 인텔 두 자리
    return ['/opt/homebrew/bin/brew', '/usr/local/bin/brew'];
  }
  if (platform === 'win' && tool === 'winget') {
    const local = env.LOCALAPPDATA;
    return local ? [`${local}\\Microsoft\\WindowsApps\\winget.exe`] : [];
  }
  return [];
}

/**
 * 설치 도구의 실행 경로를 고른다 — **판단만** 여기서 한다.
 *
 * `which`(윈도우는 `where`)를 먼저 믿는다 — 사용자가 다른 자리에 두었을 수 있다.
 * 실패하면 위 `toolCandidates` 의 알려진 자리를 본다. 실제로 셸을 돌리고 파일을
 * 보는 것은 부르는 쪽(`server/routes/system.ts`)의 일이다 — 그래야 검사할 수 있다
 * (이 파일의 `checkEnv` 와 같은 방식).
 *
 * @param whichOutput `which <도구>` 가 성공했다면 그 출력, 실패했으면 `undefined`
 * @returns 실행할 절대 경로, 없으면 `undefined`
 */
export function pickToolPath(
  tool: string,
  platform: Platform,
  whichOutput: string | undefined,
  exists: (path: string) => boolean,
  env: Record<string, string | undefined> = {},
): string | undefined {
  // `where` 는 여러 줄을 줄 수 있다 — 첫 줄이 우선순위가 가장 높은 것이다
  const fromWhich = whichOutput?.split('\n')[0]?.trim();
  if (fromWhich !== undefined && fromWhich.length > 0) return fromWhich;

  for (const candidate of toolCandidates(tool, platform, env)) {
    if (exists(candidate)) return candidate;
  }
  return undefined;
}

/** 이 PC 가 무엇인가 — `process.platform` 을 우리 말로 */
export function platformOf(nodePlatform: string): Platform {
  if (nodePlatform === 'darwin') return 'mac';
  if (nodePlatform === 'win32') return 'win';
  return 'other';
}

export interface EnvStatus {
  id: string;
  label: string;
  why: string;
  optional: boolean;
  installed: boolean;
  /** 없을 때 권하는 명령. 설치 도구가 없으면 `undefined` */
  command?: string;
  tool?: string;
  homepage: string;
}

/**
 * 점검 결과를 만든다.
 *
 * `exists` 와 `hasTool` 을 인자로 받는 이유: 파일시스템을 건드리지 않아야
 * 검사할 수 있다. 실제 확인은 부르는 쪽이 한다.
 */
export function checkEnv(
  platform: Platform,
  exists: (path: string) => boolean,
  hasTool: (tool: string) => boolean,
): EnvStatus[] {
  return ENV_ITEMS.map((item) => {
    const candidates = item.paths[platform] ?? [];
    const installed = candidates.some(exists);
    const install = item.install[platform];
    return {
      id: item.id,
      label: item.label,
      why: item.why,
      optional: item.optional,
      installed,
      ...(install && !installed && hasTool(install.tool)
        ? { command: install.command, tool: install.tool }
        : {}),
      homepage: item.homepage,
    };
  });
}

/**
 * 실행을 허락할 명령인가.
 *
 * **화면이 보낸 문자열을 그대로 실행하지 않는다.** 목록에 적힌 명령과 **글자까지
 * 같을 때만** 돌린다 — 그렇지 않으면 이 라우트가 '무엇이든 실행하는 구멍' 이 된다.
 * 이 앱은 LAN 에도 열릴 수 있다.
 */
export function isAllowedCommand(command: string): boolean {
  return ENV_ITEMS.some((item) =>
    Object.values(item.install).some((install) => install.command === command),
  );
}
