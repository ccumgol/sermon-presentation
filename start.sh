#!/usr/bin/env bash
# 예배 준비를 한 번에 시작한다 — 컨트롤 패널 빌드 + 서버 + 브라우저.
#
# 사용법:
#   ./start.sh              이 PC 안에서만 (기본 · 권장)
#   ./start.sh lan          태블릿으로도 조작 (⚠ 인증이 없다 — 아래 참고)
#   PORT=7800 ./start.sh    포트를 직접 준다
#   OPEN_BROWSER=0 ./start.sh   브라우저를 열지 않는다
#
# 터미널에서 `presentation` 으로 부른다 (~/.zshrc 의 alias).
set -euo pipefail

# 스크립트가 있는 폴더로 이동 (어디서 실행하든 동작)
cd "$(dirname "$0")"

PORT="${PORT:-7777}"
BASE="http://localhost:${PORT}"

# ── 태블릿 모드 ─────────────────────────────────────────────────────
# 기본은 이 PC 안에서만 연다. 이 앱에는 인증이 없어서, LAN 에 열면 같은 WiFi 의
# 누구나 예배 중 화면을 바꿀 수 있다 (docs/SECURITY-AUDIT.md H-1).
if [ "${1:-}" = "lan" ]; then
  export SERMON_HOST=0.0.0.0
  echo "⚠ 태블릿 모드 — 같은 WiFi 의 모든 기기가 조작할 수 있습니다 (인증 없음)."
  echo "  신뢰할 수 있는 망에서만 쓰고, 예배가 끝나면 Ctrl+C 로 닫으세요."
  echo
fi

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

# 서버 실행 — exec 로 넘겨 Ctrl+C 가 곧바로 서버에 닿게 한다
exec env PORT="${PORT}" node server/index.ts
