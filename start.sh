#!/usr/bin/env bash
# 예배 준비를 한 번에 시작한다 — 컨트롤 패널 빌드 + 서버 + 브라우저.
#
# 사용법:
#   ./start.sh              이 PC 안에서만 (기본 · 권장)
#   ./start.sh lan          태블릿으로도 조작 (접속 암호를 넣어야 한다)
#   PORT=7800 ./start.sh    포트를 직접 준다
#   OPEN_BROWSER=0 ./start.sh   브라우저를 열지 않는다
#
# 터미널에서 `presentation` 으로 부른다 (~/.zshrc 의 alias).
set -euo pipefail

# 스크립트가 있는 폴더로 이동 (어디서 실행하든 동작)
cd "$(dirname "$0")"

PORT="${PORT:-7777}"
BASE="http://localhost:${PORT}"

# ── 준비물 확인 ─────────────────────────────────────────────────────
if [ ! -d "node_modules" ]; then
  echo "❌ node_modules 가 없습니다. 먼저 아래를 실행하세요:"
  echo "   npm install"
  exit 1
fi

if [ ! -f "data/bible.sqlite" ]; then
  echo "❌ 성경 DB(data/bible.sqlite)가 없습니다. 먼저 아래를 실행하세요:"
  echo "   npm run bible:build"
  exit 1
fi

# ── 태블릿 모드 ─────────────────────────────────────────────────────
# 기본은 이 PC 안에서만 연다(감사 H-1). LAN 을 열 때는 **접속 암호가 있어야** 한다 —
# 없이 열면 같은 WiFi 의 누구나 예배 화면을 바꿀 수 있다 (docs/SECURITY-AUDIT.md 권고 4).
if [ "${1:-}" = "lan" ]; then
  export SERMON_HOST=0.0.0.0

  # 암호가 없으면 서버가 뜨기를 거부한다. 예배 직전에 벽을 만나지 않도록 **여기서**
  # 먼저 잡아 그 자리에서 정하게 한다 (10초면 끝난다).
  if ! node scripts/set-password.ts --show >/dev/null 2>&1; then
    echo "태블릿으로 열려면 접속 암호가 필요합니다. 아직 정해지지 않았습니다."
    printf "지금 정할까요? [Y/n] "
    read -r ANS || ANS=""
    case "${ANS}" in
      [nN] | [nN][oO])
        echo "  그러면 태블릿으로는 열 수 없습니다. 이 PC 안에서만 쓰려면:  ./start.sh"
        exit 1
        ;;
      *)
        node scripts/set-password.ts || exit 1
        echo
        ;;
    esac
  fi

  echo "⚠ 태블릿 모드 — 같은 WiFi 의 기기가 접속할 수 있습니다."
  echo "  태블릿은 접속 암호를 넣어야 하고, 이 PC 는 묻지 않습니다."
  echo "  예배가 끝나면 Ctrl+C 로 닫으세요."
  echo
fi

# ── 이미 떠 있으면? ─────────────────────────────────────────────────
# 우리 서버는 포트가 막혀 있으면 다음 포트로 올라간다. 그러면 **옛 프로세스가
# 구버전 코드로 응답**해 "수정이 반영되지 않은 것처럼" 보인다(실제로 여러 번 겪었다 —
# docs/TROUBLESHOOTING.md 2.7). 그래서 조용히 두 번째 서버를 띄우지 않고 먼저 묻는다.
if command -v lsof >/dev/null 2>&1; then
  EXISTING_PID="$(lsof -ti:"${PORT}" -sTCP:LISTEN 2>/dev/null || true)"
  if [ -n "${EXISTING_PID}" ]; then
    # 우리 앱인지 확인한다 — 남의 프로세스를 죽이라고 권하지 않는다
    if curl -s --max-time 2 "${BASE}/api/info" | grep -q '"songCount"'; then
      echo "✓ 서버가 이미 ${PORT} 에 떠 있습니다 (PID: ${EXISTING_PID//$'\n'/ })."
      printf "  껐다 새로 시작할까요? 코드를 고쳤다면 필요합니다. [y/N] "
      read -r ANS || ANS=""
      case "${ANS}" in
        [yY] | [yY][eE][sS])
          echo "  종료 중…"
          # shellcheck disable=SC2086
          kill ${EXISTING_PID} 2>/dev/null || true
          for _ in $(seq 1 20); do   # 포트가 풀릴 때까지 최대 ~10초
            lsof -ti:"${PORT}" -sTCP:LISTEN >/dev/null 2>&1 || break
            sleep 0.5
          done
          ;;
        *)
          echo "  그대로 씁니다. 컨트롤 패널을 엽니다."
          [ "${OPEN_BROWSER:-1}" != "0" ] && command -v open >/dev/null 2>&1 && open "${BASE}/"
          exit 0
          ;;
      esac
    else
      echo "❌ 포트 ${PORT} 를 다른 프로그램이 쓰고 있습니다 (PID: ${EXISTING_PID//$'\n'/ })."
      echo "   그것이 무엇인지 확인하거나, 포트를 바꿔 실행하세요:  PORT=7800 ./start.sh"
      exit 1
    fi
  fi
fi

# ── 컨트롤 패널 빌드 ────────────────────────────────────────────────
# React 패널은 public/app/ 로 빌드된다. 서버만 띄우면 옛 화면이 나온다.
echo "컨트롤 패널 빌드 중…"
npm run app:build --silent

echo
echo "  컨트롤 패널  : ${BASE}/"
echo "  OBS 브라우저 : ${BASE}/output/?layer=main"
echo "  강사 모니터  : ${BASE}/stage"
echo "  프로젝터     : ${BASE}/projector"
echo "  (종료: Ctrl+C)"
echo

# ── 서버가 뜨면 컨트롤 패널을 연다 ──────────────────────────────────
if [ "${OPEN_BROWSER:-1}" != "0" ]; then
  (
    for _ in $(seq 1 60); do   # 최대 ~30초 (성경 DB 를 여는 데 시간이 걸릴 수 있다)
      if curl -s --max-time 1 -o /dev/null "${BASE}/api/info"; then break; fi
      sleep 0.5
    done
    if command -v open >/dev/null 2>&1; then open "${BASE}/"          # macOS
    elif command -v xdg-open >/dev/null 2>&1; then xdg-open "${BASE}/"  # Linux
    fi
  ) &
fi

# ── 서버 실행 — 죽으면 되살린다 ─────────────────────────────────────
#
# **예배 중에 도는 서버다.** 처리되지 않은 오류 하나로 프로세스가 사라지면 화면은
# 마지막 슬라이드로 멈춘 채 남고(검은 화면은 아니다) 다음 장으로 넘길 수 없다.
# 그때 터미널로 달려가 다시 띄우는 30초가 예배에서는 길다.
#
# 그래서 감시 루프로 감싼다. `uncaughtException` 을 삼켜 살려 두지 않는 이유는
# 그 뒤 프로세스 상태를 믿을 수 없기 때문이다 — **빨리 죽고 빨리 살아나는 편**이
# 안전하다. 서버는 오류를 남기고 나가고(server/index.ts), 여기서 다시 띄운다.
#
# Ctrl+C(130)·SIGTERM(143)·정상 종료(0)는 사람이 끝낸 것이므로 되살리지 않는다.
# 짧은 시간에 거듭 죽으면 되살리기를 멈춘다 — 무한 재시작은 원인을 가린다.

RESTART_LIMIT="${RESTART_LIMIT:-5}"   # 이만큼 거듭 빨리 죽으면 포기한다
QUICK_DEATH=20                        # 뜬 지 이 초 안에 죽으면 '빨리 죽었다'
quick_deaths=0

while true; do
  started_at=$(date +%s)
  set +e
  env PORT="${PORT}" node server/index.ts
  code=$?
  set -e
  lived=$(( $(date +%s) - started_at ))

  if [ "$code" -eq 0 ] || [ "$code" -eq 130 ] || [ "$code" -eq 143 ]; then
    exit 0                            # 사람이 끝냈다
  fi

  if [ "$lived" -lt "$QUICK_DEATH" ]; then
    quick_deaths=$(( quick_deaths + 1 ))
  else
    quick_deaths=1                    # 한참 돌다 죽은 것은 처음부터 센다
  fi

  if [ "$quick_deaths" -ge "$RESTART_LIMIT" ]; then
    echo
    echo "❌ 서버가 ${QUICK_DEATH}초 안에 ${quick_deaths}번 거듭 죽었습니다 (마지막 종료 코드 ${code})."
    echo "   되살리기를 멈춥니다 — 위의 오류를 보세요. 같은 원인이 계속 있는 상태입니다."
    echo "   급하면 다른 포트로: PORT=7800 ./start.sh  (OBS 소스 URL 도 함께 바꾸세요)"
    exit "$code"
  fi

  echo
  echo "⚠️  서버가 종료됐습니다 (코드 ${code}, ${lived}초 돌았음). 1초 뒤 다시 띄웁니다… [${quick_deaths}/${RESTART_LIMIT}]"
  echo "   화면은 마지막 슬라이드를 그대로 두고 스스로 다시 붙습니다."
  sleep 1
done
