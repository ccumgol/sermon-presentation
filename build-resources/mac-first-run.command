#!/bin/bash
#
# 맥에서 **처음 한 번만** 실행합니다 — 두 번 누르면 됩니다.
#
# ## 무엇을 하는 스크립트인가
#
# 인터넷에서 받은 앱에는 macOS 가 **격리 표시**(com.apple.quarantine)를 붙입니다.
# 이 앱은 Apple 공증(연 $99 개발자 계정)을 받지 않았기 때문에, 그 표시가 붙어 있으면
# macOS 가 **"손상되었기 때문에 열 수 없습니다"** 라며 막습니다.
#
# **앱은 멀쩡합니다.** 표시만 지우면 됩니다. 그 일을 이 스크립트가 합니다.
#
# ## 왜 앱이 스스로 못 하나
#
# 막는 시점이 **앱이 뜨기 전**입니다. 앱 안의 코드는 한 줄도 돌지 않습니다.
# 그래서 앱 바깥에서 지워 주어야 합니다.

set -u

APP_NAME="SermonPresentation.app"
HERE="$(cd "$(dirname "$0")" && pwd)"

echo ""
echo "  예배 프레젠테이션 — 첫 실행 준비"
echo "  ────────────────────────────────────────────"
echo ""

# 앱을 어디서 찾을 것인가. **응용 프로그램에 옮긴 것**을 먼저 본다 —
# DMG 안에서 바로 실행하면 다음에 DMG 를 빼는 순간 앱이 사라진다.
if [ -d "/Applications/$APP_NAME" ]; then
  APP="/Applications/$APP_NAME"
elif [ -d "$HOME/Applications/$APP_NAME" ]; then
  APP="$HOME/Applications/$APP_NAME"
elif [ -d "$HERE/$APP_NAME" ]; then
  echo "  ⚠️  앱이 아직 '응용 프로그램' 에 없습니다."
  echo ""
  echo "     이 창의 왼쪽 창(DMG)에서 $APP_NAME 을"
  echo "     '응용 프로그램' 폴더로 끌어다 놓은 뒤, 이 파일을 다시 두 번 누르세요."
  echo ""
  read -r -p "  계속하려면 Enter 를 누르세요 " _
  exit 1
else
  echo "  ⚠️  $APP_NAME 을 찾지 못했습니다."
  echo "     '응용 프로그램' 폴더에 앱을 먼저 옮겨 주세요."
  echo ""
  read -r -p "  계속하려면 Enter 를 누르세요 " _
  exit 1
fi

echo "  찾은 앱: $APP"
echo ""

# 지우기 전에 **정말 붙어 있는지** 본다 — 붙어 있지 않으면 할 일이 없다
if xattr -p com.apple.quarantine "$APP" >/dev/null 2>&1; then
  echo "  격리 표시를 지우는 중…"
  if xattr -dr com.apple.quarantine "$APP" 2>/dev/null; then
    echo "  ✅ 지웠습니다."
  else
    # 다른 사용자가 설치한 앱이면 권한이 없을 수 있다
    echo "  ⚠️  권한이 없어 지우지 못했습니다. 암호를 물어볼 수 있습니다."
    if sudo xattr -dr com.apple.quarantine "$APP"; then
      echo "  ✅ 지웠습니다."
    else
      echo "  ❌ 실패했습니다. README 의 '설치판으로 쓰기' 를 보고 직접 실행해 주세요:"
      echo "     xattr -dr com.apple.quarantine \"$APP\""
      echo ""
      read -r -p "  계속하려면 Enter 를 누르세요 " _
      exit 1
    fi
  fi
else
  echo "  ✅ 격리 표시가 없습니다 — 이미 준비된 상태입니다."
fi

echo ""
echo "  앱을 엽니다…"
open "$APP"

echo ""
echo "  ────────────────────────────────────────────"
echo "  끝났습니다. **이 준비는 한 번만** 하면 됩니다."
echo "  (새 판을 다시 설치하면 그때 한 번 더 필요합니다)"
echo ""
echo "  이 창은 닫아도 됩니다."
echo ""
