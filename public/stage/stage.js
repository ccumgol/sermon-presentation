/*
 * 강사 모니터 — WebSocket 으로 상태와 덱을 받아 '지금/다음' 을 보여 준다.
 *
 * ## 왜 별도 페이지인가 (2026-08-18, (다))
 *
 * 강단 화면은 OBS 로 나가지만, 강사에게 필요한 것은 **조작자용 정보**다 —
 * 지금 뭐가 나가는지, 다음이 뭔지, 몇 장 남았는지, 지금 몇 시인지.
 * 이건 OBS 를 거칠 이유가 없다. 브라우저 창 하나를 강단 모니터에 전체화면으로 띄운다.
 * (ProPresenter 의 Stage Display, EasyWorship 의 Foldback 과 같은 방식이다.)
 *
 * ## 출력 페이지와 같은 원칙
 *
 * **의존성 0.** 예배 중 이 화면이 죽으면 설교자가 다음을 모른다.
 * 연결이 끊겨도 **마지막 화면을 그대로 둔다** — 빈 화면보다 낫다.
 */
(function () {
  'use strict';

  /** 서버가 이 layer 를 보고 덱을 보내 준다 (`server/ws.ts` 의 STAGE_LAYER) */
  var LAYER = 'stage';

  var el = {
    zoomValue: document.getElementById('zoom-value'),
    group: document.getElementById('group'),
    progress: document.getElementById('progress'),
    clock: document.getElementById('clock'),
    now: document.getElementById('now'),
    next: document.getElementById('next'),
    nextLabel: document.getElementById('next-label'),
    conn: document.getElementById('conn'),
    blank: document.getElementById('blank'),
    upcoming: document.getElementById('upcoming'),
  };

  var deck = null;
  var live = null;
  var knownRevision = -1;

  // ── 글자 크기 ───────────────────────────────────────────
  //
  // 이 화면은 예배당 **뒷벽**에 붙어 강사·찬양팀이 멀리서 본다. 모니터 크기와 거리가
  // 교회마다 달라 고정할 수 없다 (2026-08-18 사용자 요청).
  //
  // **이 PC 에 저장한다** — 강단 모니터의 크기·거리는 그 자리의 성질이고,
  // 다른 PC 에서 열었을 때 따라오면 오히려 틀린다.

  var ZOOM_KEY = 'sermon.stage.zoom';
  var ZOOM_MIN = 0.6;
  var ZOOM_MAX = 2.6;
  var ZOOM_STEP = 0.1;
  var zoom = 1;

  function clampZoom(value) {
    if (!isFinite(value)) return 1;
    return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(value * 100) / 100));
  }

  function applyZoom(next, remember) {
    zoom = clampZoom(next);
    document.documentElement.style.setProperty('--zoom', String(zoom));
    if (el.zoomValue) el.zoomValue.textContent = Math.round(zoom * 100) + '%';
    if (remember) {
      try {
        localStorage.setItem(ZOOM_KEY, String(zoom));
      } catch (err) {
        // 저장에 실패해도 이번 세션에는 적용된다
      }
    }
  }

  (function restoreZoom() {
    var saved = 1;
    try {
      var raw = localStorage.getItem(ZOOM_KEY);
      if (raw) saved = parseFloat(raw);
    } catch (err) {
      // 못 읽으면 기본값
    }
    applyZoom(saved, false);
  })();

  document.getElementById('zoom-in').addEventListener('click', function () {
    applyZoom(zoom + ZOOM_STEP, true);
  });
  document.getElementById('zoom-out').addEventListener('click', function () {
    applyZoom(zoom - ZOOM_STEP, true);
  });

  // 키보드로도 — 모니터가 손에서 멀면 마우스를 쓰기 어렵다
  window.addEventListener('keydown', function (event) {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key === '+' || event.key === '=') applyZoom(zoom + ZOOM_STEP, true);
    else if (event.key === '-' || event.key === '_') applyZoom(zoom - ZOOM_STEP, true);
    else if (event.key === '0') applyZoom(1, true);
    else return;
    event.preventDefault();
  });

  // ── 시계 ────────────────────────────────────────────────
  //
  // 설교 시간 관리에 쓰는 정보라 **현재 시각**을 보여 준다. 경과 시간이 아니라
  // 시각인 이유는, 설교자가 아는 것은 '몇 시에 끝내야 한다' 이기 때문이다.

  function tickClock() {
    var now = new Date();
    var hh = String(now.getHours()).padStart(2, '0');
    var mm = String(now.getMinutes()).padStart(2, '0');
    var ss = String(now.getSeconds()).padStart(2, '0');
    el.clock.textContent = hh + ':' + mm + ':' + ss;
  }
  tickClock();
  setInterval(tickClock, 1000);

  // ── 슬라이드를 글로 옮긴다 ──────────────────────────────
  //
  // 출력 페이지처럼 템플릿을 따르지 않는다. 강사 모니터는 **읽는 것**이 목적이므로
  // 스타일을 고정하고 글자만 크게 둔다.

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function line(text, className) {
    var div = document.createElement('div');
    if (className) div.className = className;
    div.textContent = text;
    return div;
  }

  /** 슬라이드 하나를 주어진 칸에 그린다 */
  function paint(node, slide) {
    clear(node);
    if (!slide) {
      node.appendChild(line('—', 'empty'));
      return;
    }

    switch (slide.kind) {
      case 'bible': {
        // 주 역본만 보여 준다 — 강사는 다역본을 다 읽지 않는다
        var block = slide.blocks && slide.blocks[0];
        if (!block) break;
        /*
         * 절 번호는 **항목이 끄면 끈다.**
         *
         * 인용구는 참조를 본문 앞에 붙여 보내므로(`고전 1:3 하나님 우리…`) 절 번호를
         * 또 붙이면 `3 고전 1:3 하나님…` 이 된다. 예전에는 여기서 늘 붙였고, 그래서
         * 네 화면이 서로 다른 글을 보였다 (사용자 지적 2026-08-20).
         *
         * 출력 페이지와 같은 규칙을 여기에도 적는다 — 이 파일은 **의존성 0** 이라
         * 바깥 모듈을 불러올 수 없다 (그 원칙을 지키는 검사가 이 주석의 낱말까지 본다).
         * 두 곳이 갈라지지 않게 `tests/unit/quote-consistency.test.ts` 가 묶어 둔다.
         */
        var nums = !(slide.display && slide.display.verseNumbers === false);
        block.verses.forEach(function (verse) {
          node.appendChild(line(nums ? verse.verse + ' ' + verse.text : verse.text));
        });
        if (slide.reference) {
          var ref = line(slide.reference, 'ref');
          node.appendChild(ref);
        }
        break;
      }
      case 'song': {
        slide.lines.forEach(function (group) {
          group.forEach(function (l) {
            node.appendChild(line(l.text));
          });
        });
        break;
      }
      case 'text': {
        slide.lines.forEach(function (l) {
          node.appendChild(line(l));
        });
        break;
      }
      case 'reading': {
        node.appendChild(line(slide.leader));
        if (slide.people) node.appendChild(line(slide.people, 'people'));
        if (slide.reference) node.appendChild(line(slide.reference, 'ref'));
        break;
      }
      case 'order': {
        node.appendChild(line(slide.title));
        if (slide.presenter) node.appendChild(line(slide.presenter, 'people'));
        break;
      }
      case 'blank': {
        node.appendChild(line('(공백)', 'empty'));
        break;
      }
      default:
        node.appendChild(line('—', 'empty'));
    }
  }

  /**
   * 지금 위치가 어느 항목(그룹)인지.
   *
   * 항목 하나만 단독으로 올린 경우에는 `groups` 가 없다. 그때는 덱 이름을 쓴다 —
   * '—' 만 띄우면 강사가 지금 무엇을 하는 중인지 알 수 없다.
   */
  function groupLabelAt(index) {
    if (!deck) return '';
    if (deck.groups && deck.groups.length > 0) {
      var name = '';
      for (var i = 0; i < deck.groups.length; i += 1) {
        if (deck.groups[i].startIndex <= index) name = deck.groups[i].label;
        else break;
      }
      if (name) return name;
    }
    return deck.reference || '';
  }

  function render() {
    var total = deck && deck.slides ? deck.slides.length : 0;
    var index = deck ? deck.index : 0;

    // 지금 화면은 **상태**에서 온다 (덱 없이 한 장만 띄운 경우도 있다)
    paint(el.now, live && live.slide);

    var nextSlide = total > 0 && index < total - 1 ? deck.slides[index + 1] : null;
    paint(el.next, nextSlide);
    el.nextLabel.textContent =
      total === 0 ? '' : nextSlide ? '▸ ' + (deck.labels[index + 1] || '') : '— 마지막';

    el.group.textContent = groupLabelAt(index) || '—';
    el.progress.textContent = total > 0 ? index + 1 + ' / ' + total : '—';

    // 그 다음 것들 — 손을 미리 준비하는 데 쓴다
    var rest = [];
    for (var at = index + 2; at < total && rest.length < 4; at += 1) {
      rest.push(deck.labels[at] || at + 1);
    }
    el.upcoming.textContent = rest.length > 0 ? '이후 ▸ ' + rest.join(' · ') : '';

    el.blank.hidden = !(live && live.blank);
  }

  function applyState(next) {
    // 순서가 뒤바뀐 오래된 메시지는 버린다 (출력 페이지와 같은 규칙)
    if (typeof next.revision === 'number') {
      if (next.revision < knownRevision) return;
      knownRevision = next.revision;
    }
    live = next;
    render();
  }

  // ── 연결 ────────────────────────────────────────────────

  var socket = null;
  var retry = null;

  function setConn(text, cls) {
    el.conn.textContent = text;
    el.conn.className = 'pill' + (cls ? ' ' + cls : '');
  }

  function wsUrl() {
    var scheme = location.protocol === 'https:' ? 'wss' : 'ws';
    return scheme + '://' + location.host + '/ws';
  }

  function connect() {
    try {
      socket = new WebSocket(wsUrl());
    } catch (err) {
      setConn('연결 실패', 'off');
      scheduleReconnect();
      return;
    }

    socket.onopen = function () {
      setConn('연결됨', 'ok');
      socket.send(JSON.stringify({ t: 'hello', role: 'output', layer: LAYER }));
    };

    socket.onmessage = function (event) {
      var msg;
      try {
        msg = JSON.parse(event.data);
      } catch (err) {
        return;
      }
      if (msg.t === 'state') applyState(msg.payload);
      else if (msg.t === 'state:patch') applyState(Object.assign({}, live || {}, msg.payload));
      else if (msg.t === 'deck') {
        deck = msg.payload;
        render();
      }
    };

    socket.onclose = function () {
      // **화면은 그대로 둔다.** 설교 중 화면이 비면 다음을 알 수 없다.
      setConn('연결 끊김 — 다시 시도합니다', 'off');
      scheduleReconnect();
    };

    socket.onerror = function () {
      setConn('연결 오류', 'off');
    };
  }

  function scheduleReconnect() {
    if (retry) return;
    retry = setTimeout(function () {
      retry = null;
      connect();
    }, 1500);
  }

  render();
  connect();
})();
