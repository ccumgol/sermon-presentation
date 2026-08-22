/**
 * 태블릿 접속 암호를 정한다 — `app.sqlite`
 *
 * ```
 * npm run password              # 물어보고 정한다 (화면에 찍히지 않는다)
 * npm run password -- --show    # 정해져 있는지만 본다
 * npm run password -- --clear   # 없앤다 (그러면 LAN 을 열 수 없다)
 * ```
 *
 * 암호는 **평문으로 저장되지 않는다** (scrypt 해시). 잊으면 다시 정하면 된다.
 * 다시 정하면 **이미 접속해 있던 태블릿은 모두 로그아웃된다** — 서명 열쇠가 바뀌기 때문이다.
 */

import { clearPassword, hasPassword, setPassword } from '../server/auth.ts';
import { initAppDb } from '../server/db/app.ts';
import { ensureDataDirs } from '../server/paths.ts';

/**
 * 한 줄을 받는다. **터미널에서는 글자를 찍지 않는다** (어깨 뒤로 보이지 않게).
 *
 * 파이프로 들어오는 경우(테스트·자동화)도 받아야 하므로 두 길을 모두 둔다.
 * `readline` 의 되울림을 억지로 막는 방법은 파이프에서 멈춰 버려 쓰지 않는다.
 */

/**
 * 파이프로 들어온 입력을 모아 두는 곳.
 *
 * 파이프는 여러 줄을 **한 덩어리로** 준다. 첫 줄만 쓰고 나머지를 버리면 두 번째
 * 질문이 영원히 기다린다(실제로 그렇게 멈췄다). 그래서 남은 것을 여기에 둔다.
 */
let piped = '';
let pipedEnded = false;

function readPipedLine(): Promise<string> {
  const takeLine = (): string | undefined => {
    const nl = piped.indexOf('\n');
    if (nl < 0) return undefined;
    const line = piped.slice(0, nl).replace(/\r$/, '');
    piped = piped.slice(nl + 1);
    return line;
  };

  return new Promise((resolve, reject) => {
    const ready = takeLine();
    if (ready !== undefined) {
      process.stdout.write('\n');
      resolve(ready);
      return;
    }
    if (pipedEnded) {
      reject(new Error('입력이 끝났습니다'));
      return;
    }

    const stdin = process.stdin;
    const onData = (chunk: Buffer | string): void => {
      piped += String(chunk);
      const line = takeLine();
      if (line === undefined) return;
      stdin.off('data', onData);
      stdin.off('end', onEnd);
      process.stdout.write('\n');
      resolve(line);
    };
    const onEnd = (): void => {
      pipedEnded = true;
      stdin.off('data', onData);
      // 마지막 줄에 개행이 없을 수 있다
      if (piped.length > 0) {
        const last = piped;
        piped = '';
        process.stdout.write('\n');
        resolve(last.replace(/\r$/, ''));
        return;
      }
      reject(new Error('입력이 끝났습니다'));
    };
    stdin.on('data', onData);
    stdin.once('end', onEnd);
    stdin.resume();
  });
}

function askHidden(prompt: string): Promise<string> {
  process.stdout.write(prompt);
  const stdin = process.stdin;

  if (!stdin.isTTY) return readPipedLine();

  return new Promise((resolve, reject) => {
    let buffer = '';

    // ── 터미널 — 글자마다 직접 받는다 ──────────────────────────
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');

    const finish = (value: string | null): void => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.off('data', onKey);
      process.stdout.write('\n');
      if (value === null) {
        reject(new Error('취소했습니다'));
        return;
      }
      resolve(value);
    };

    function onKey(key: string): void {
      for (const ch of key) {
        if (ch === '\r' || ch === '\n') return finish(buffer);
        if (ch === '\u0003') return finish(null); // Ctrl+C
        if (ch === '\u007f' || ch === '\b') {
          buffer = buffer.slice(0, -1);
          continue;
        }
        if (ch < ' ') continue; // 그 밖의 제어 문자는 무시
        buffer += ch;
      }
    }

    stdin.on('data', onKey);
  });
}

async function main(): Promise<void> {
  ensureDataDirs();
  initAppDb();

  if (process.argv.includes('--show')) {
    // 종료 코드로도 알린다 — start.sh 가 이것으로 판단한다
    if (hasPassword()) {
      console.log('접속 암호가 정해져 있습니다.');
      return;
    }
    console.log('접속 암호가 없습니다.');
    process.exitCode = 1;
    return;
  }

  if (process.argv.includes('--clear')) {
    if (!hasPassword()) {
      console.log('이미 없습니다.');
      return;
    }
    clearPassword();
    console.log('접속 암호를 없앴습니다. 이제 LAN(태블릿)으로는 열 수 없습니다.');
    return;
  }

  if (hasPassword()) {
    console.log('이미 암호가 정해져 있습니다. 새로 정하면 접속해 있던 태블릿이 모두 로그아웃됩니다.');
  }

  const first = await askHidden('새 접속 암호 (4자 이상): ');
  if (first.length < 4) {
    console.error('❌ 4자 이상이어야 합니다. 아무것도 바꾸지 않았습니다.');
    process.exitCode = 1;
    return;
  }

  const again = await askHidden('한 번 더 확인: ');
  if (first !== again) {
    console.error('❌ 두 번 입력한 값이 다릅니다. 아무것도 바꾸지 않았습니다.');
    process.exitCode = 1;
    return;
  }

  setPassword(first);
  console.log('✓ 접속 암호를 정했습니다.');
  console.log('  태블릿에서 처음 열 때 한 번 넣으면 30일간 기억합니다.');
  console.log('  이 PC(컨트롤 패널·OBS·프로젝터)는 암호를 묻지 않습니다.');
  console.log('  태블릿에 열려면:  ./start.sh lan');
}

await main();
