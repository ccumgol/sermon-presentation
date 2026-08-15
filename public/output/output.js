/*
 * 출력 페이지 스크립트. 의존성 0, 빌드 단계 없음.
 *
 * Phase 0 범위: 쿼리 파라미터 처리, 데모 렌더, 진단 배지.
 * Phase 2 에서 이 파일에 WebSocket 클라이언트를 추가한다 (아래 TODO 지점).
 *
 * 절대 원칙: 어떤 오류 상황에서도 화면을 스스로 비우지 않는다.
 * 예배 중 검은 화면은 치명적이므로, 마지막으로 성공한 렌더를 유지한다.
 */
(function () {
  'use strict';

  var params = new URLSearchParams(location.search);
  var opts = {
    layer: params.get('layer') || 'main',
    preview: params.get('preview') === '1',
    debug: params.get('debug') === '1',
    demo: params.get('demo') === '1',
    // 측정 전용 모드 — WS 에 붙지 않는다. 컨트롤 패널이 숨긴 iframe 으로 쓴다.
    measure: params.get('measure') === '1',
  };

  var el = {
    body: document.body,
    stage: document.getElementById('stage'),
    slide: document.getElementById('slide'),
    blocks: document.getElementById('blocks'),
    heading: document.getElementById('heading'),
    reference: document.getElementById('reference'),
    credit: document.getElementById('credit'),
    debug: document.getElementById('debug'),
  };

  if (opts.preview) el.body.classList.add('preview');

  // ── 진단 배지 ────────────────────────────────────────────────
  var diag = { layer: opts.layer, revision: 0, ws: 'off', lastRender: '-', errors: 0, dropped: 0, fit: '1' };

  // 현재 템플릿. behavior(절 번호 표시 여부 등)와 언어별 override 에 쓴다.
  var template = null;
  var lastSlide = null;
  var lastFit = { overflow: false, scale: 1 };

  function renderDebug() {
    if (!opts.debug) return;
    el.debug.hidden = false;
    el.debug.textContent = Object.keys(diag)
      .map(function (k) {
        return k + ': ' + diag[k];
      })
      .join('\n');
  }

  // 출력 페이지에서 발생한 오류는 서버로 보고해 컨트롤 패널에 경고를 띄운다.
  // (Phase 2 에서 WS 로 실제 전송. 지금은 수집만 한다.)
  var pendingErrors = [];
  window.addEventListener('error', function (e) {
    diag.errors++;
    pendingErrors.push({ message: String(e.message), stack: e.error && e.error.stack, url: location.href });
    renderDebug();
  });

  // ── 앵커 → CSS 변수 ──────────────────────────────────────────
  var ANCHOR_MAP = {
    'top-left': ['start', 'start'],
    'top-center': ['center', 'start'],
    'top-right': ['end', 'start'],
    'mid-left': ['start', 'center'],
    center: ['center', 'center'],
    'mid-right': ['end', 'center'],
    'bottom-left': ['start', 'end'],
    'bottom-center': ['center', 'end'],
    'bottom-right': ['end', 'end'],
  };

  function applyAnchor(anchor) {
    var pair = ANCHOR_MAP[anchor] || ANCHOR_MAP['bottom-center'];
    document.documentElement.style.setProperty('--justify', pair[0]);
    document.documentElement.style.setProperty('--align', pair[1]);
  }

  /** 서버가 보내는 CSS 변수 패치를 그대로 적용한다. DOM 재구성 없음. */
  function applyStylePatch(patch) {
    var root = document.documentElement;
    Object.keys(patch).forEach(function (key) {
      if (key === 'anchor') {
        applyAnchor(patch[key]);
        return;
      }
      root.style.setProperty(key, String(patch[key]));
    });
  }

  /**
   * 언어·역본별 스타일 override 를 블록에 인라인으로 적용한다.
   *
   * CSS 변수는 문서 전역이라 "헬라어 블록만 다른 폰트"를 표현할 수 없다.
   * 그래서 해당 블록 요소에만 직접 붙인다 (역본 지정이 언어 지정보다 구체적이므로 나중에 덮는다).
   */
  function applyBlockOverrides(node, role, translationId, lang) {
    if (!template) return;
    var byLang = (template.overridesByLang || {})[lang];
    var byTranslation = (template.overridesByTranslation || {})[translationId];
    if (!byLang && !byTranslation) return;

    var merged = {};
    if (byLang) Object.keys(byLang).forEach(function (k) { merged[k] = byLang[k]; });
    if (byTranslation) Object.keys(byTranslation).forEach(function (k) { merged[k] = byTranslation[k]; });

    if (merged.fontFamily) node.style.fontFamily = merged.fontFamily;
    if (merged.fontSize) node.style.fontSize = merged.fontSize + 'px';
    if (merged.fontWeight) node.style.fontWeight = String(merged.fontWeight);
    if (merged.lineHeight) node.style.lineHeight = String(merged.lineHeight);
    if (merged.color) node.style.color = merged.color;
    if (merged.italic !== undefined) node.style.fontStyle = merged.italic ? 'italic' : 'normal';
    if (merged.wordBreak) node.style.wordBreak = merged.wordBreak;
  }

  // ── 렌더 ─────────────────────────────────────────────────────

  function clearChildren(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  /** 성경 본문 블록 렌더 */
  function renderBible(payload) {
    clearChildren(el.blocks);
    var behavior = (template && template.behavior) || {};
    var showNums = behavior.showVerseNumbers !== false;

    payload.blocks.forEach(function (block, index) {
      var div = document.createElement('div');
      div.className = 'block ' + (index === 0 ? 'line-primary' : 'line-secondary');
      div.setAttribute('dir', block.direction === 'rtl' ? 'rtl' : 'ltr');
      div.setAttribute('data-translation', block.translationId);
      div.setAttribute('data-lang', block.lang);
      applyBlockOverrides(div, index === 0 ? 'primary' : 'secondary', block.translationId, block.lang);

      if (block.unavailable) {
        // 역본에 해당 본문이 없을 때(헬라어로 구약 조회 등) 화면에 오류를 띄우지 않는다.
        // 블록 자체를 비워 조용히 넘긴다 — 송출 화면에 기술적 메시지가 보이면 안 된다.
        return;
      }

      block.verses.forEach(function (v) {
        var span = document.createElement('span');
        span.className = 'verse';
        if (showNums) {
          var num = document.createElement('span');
          num.className = 'verse-num';
          num.textContent = String(v.verse);
          span.appendChild(num);
        }
        span.appendChild(document.createTextNode(v.text + ' '));
        div.appendChild(span);
      });

      el.blocks.appendChild(div);
    });

    setOptional(el.heading, behavior.showHeadings === false ? null : payload.heading);
    setOptional(el.reference, behavior.showReference === 'none' ? null : payload.reference);
    setOptional(el.credit, null);

    // 참조를 위에 둘지 아래에 둘지 — DOM 순서를 바꿔 반영한다
    if (behavior.showReference === 'top') el.slide.insertBefore(el.reference, el.blocks);
    else el.slide.appendChild(el.reference);
  }

  /** 찬양 가사 렌더 — 각 줄은 언어별 페어 묶음 */
  function renderSong(payload) {
    clearChildren(el.blocks);

    payload.lines.forEach(function (pair) {
      var lineWrap = document.createElement('div');
      lineWrap.className = 'song-line';

      pair.forEach(function (part, i) {
        var div = document.createElement('div');
        div.className = i === 0 ? 'line-primary' : 'line-secondary';
        div.setAttribute('data-lang', part.lang);
        applyBlockOverrides(div, i === 0 ? 'primary' : 'secondary', '', part.lang);
        div.textContent = part.text;
        lineWrap.appendChild(div);
      });

      el.blocks.appendChild(lineWrap);
    });

    setOptional(el.heading, null);
    setOptional(el.reference, null);
    setOptional(el.credit, payload.credit);
  }

  function renderText(payload) {
    clearChildren(el.blocks);
    payload.lines.forEach(function (line) {
      var div = document.createElement('div');
      div.className = 'line-primary';
      div.textContent = line;
      el.blocks.appendChild(div);
    });
    setOptional(el.heading, null);
    setOptional(el.reference, null);
    setOptional(el.credit, null);
  }

  function setOptional(node, value) {
    if (value) {
      node.textContent = value;
      node.hidden = false;
    } else {
      node.textContent = '';
      node.hidden = true;
    }
  }

  var RENDERERS = { bible: renderBible, song: renderSong, text: renderText };

  /**
   * 슬라이드를 그린다. 렌더 중 예외가 나면 이전 화면을 그대로 둔다.
   * @returns {boolean} 성공 여부
   */
  function render(payload) {
    if (!payload || payload.kind === 'blank') {
      el.body.classList.add('blanked');
      diag.lastRender = 'blank';
      renderDebug();
      return true;
    }

    var fn = RENDERERS[payload.kind];
    if (!fn) {
      diag.errors++;
      renderDebug();
      return false;
    }

    try {
      fn(payload);
      el.slide.dataset.empty = 'false';
      el.body.classList.remove('blanked');
      // 렌더 직후 실측해 넘치면 배율로 줄인다
      lastFit = applyAutoFit();
      diag.lastRender = payload.kind;
      renderDebug();
      return true;
    } catch (err) {
      // 화면을 비우지 않는다 — 이전 렌더 상태 유지
      diag.errors++;
      pendingErrors.push({ message: String(err && err.message), stack: err && err.stack, url: location.href });
      renderDebug();
      return false;
    }
  }

  /**
   * 실제 렌더 높이를 측정한다. 자동 분할·자동 축소는 서버 추정이 아니라
   * 이 실측값을 기준으로 판단한다 (계획서 §11).
   *
   * 측정은 배율을 1로 되돌린 상태에서 해야 의미가 있다 —
   * 축소된 상태의 높이를 재면 "이미 맞다"는 잘못된 결론이 나온다.
   */
  function measure() {
    var stage = el.stage;
    var available = stage.clientHeight - paddingOf(stage);
    var previous = el.slide.style.getPropertyValue('--fit-scale');
    el.slide.style.setProperty('--fit-scale', '1');
    var used = el.slide.scrollHeight;
    if (previous) el.slide.style.setProperty('--fit-scale', previous);
    else el.slide.style.removeProperty('--fit-scale');
    return { overflow: used > available, height: used, available: available };
  }

  function paddingOf(node) {
    var cs = getComputedStyle(node);
    return parseFloat(cs.paddingTop || '0') + parseFloat(cs.paddingBottom || '0');
  }

  /**
   * 넘치는 본문을 배율로 줄여 화면에 맞춘다.
   *
   * 서버에 되물어 다시 나누는 방식(피드백 루프)은 진동 위험이 있어 쓰지 않는다.
   * 여기서는 순수히 로컬 계산으로 한 번에 결정하고, 최소 배율에서도 넘치면
   * 그 사실을 서버에 보고해 컨트롤 패널이 '더 잘게 나누라'고 안내할 수 있게 한다.
   */
  function applyAutoFit() {
    var behavior = (template && template.behavior) || {};
    if (behavior.autoFit === false) {
      el.slide.style.removeProperty('--fit-scale');
      diag.fit = 'off';
      return { overflow: false, scale: 1 };
    }

    el.slide.style.setProperty('--fit-scale', '1');
    var m = measure();
    if (!m.overflow || m.height <= 0) {
      diag.fit = '1';
      return { overflow: false, scale: 1 };
    }

    var minScale = typeof behavior.autoFitMinScale === 'number' ? behavior.autoFitMinScale : 0.6;
    // 여유 2% — 반올림 때문에 스크롤바가 생기는 것을 막는다
    var needed = (m.available / m.height) * 0.98;
    var scale = Math.max(minScale, Math.min(1, needed));

    el.slide.style.setProperty('--fit-scale', String(scale));
    diag.fit = scale.toFixed(2);

    // 최소 배율로도 부족한가
    return { overflow: needed < minScale, scale: scale };
  }

  // ── 외부 인터페이스 ──────────────────────────────────────────
  // Phase 2 의 WebSocket 클라이언트와 컨트롤 패널의 iframe 미리보기가
  // 공통으로 사용하는 진입점.
  window.SermonOutput = {
    render: render,
    applyStylePatch: applyStylePatch,
    applyAnchor: applyAnchor,
    measure: measure,
    /**
     * 슬라이드 후보를 그려 보고 높이만 재서 돌려준다 (컨트롤 패널 자동 분할용).
     * 측정이 끝나면 이전 화면으로 되돌린다 — 측정 때문에 송출이 흔들리면 안 된다.
     */
    measureSlide: function (payload, candidateTemplate) {
      var savedTemplate = template;
      var savedSlide = lastSlide;
      if (candidateTemplate) template = candidateTemplate;
      try {
        var fn = RENDERERS[payload && payload.kind];
        if (!fn) return null;
        fn(payload);
        var m = measure();
        return m;
      } catch (err) {
        return null;
      } finally {
        template = savedTemplate;
        if (savedSlide) { lastSlide = savedSlide; render(savedSlide); }
      }
    },
    applyTemplate: applyTemplate,
    setBlank: function (on) {
      el.body.classList.toggle('blanked', !!on);
    },
    diag: diag,
    drainErrors: function () {
      var out = pendingErrors.slice();
      pendingErrors.length = 0;
      return out;
    },
  };

  // 컨트롤 패널이 iframe(미리보기·측정)으로 이 페이지를 쓸 때의 통로
  window.addEventListener('message', function (e) {
    var msg = e.data;
    if (!msg || typeof msg !== 'object') return;

    if (msg.t === 'render') {
      lastSlide = msg.payload;
      render(msg.payload);
    } else if (msg.t === 'style') {
      applyStylePatch(msg.patch);
      lastFit = applyAutoFit();
      renderDebug();
    } else if (msg.t === 'template') {
      applyTemplate(msg.payload);
    } else if (msg.t === 'blank') {
      window.SermonOutput.setBlank(msg.on);
    } else if (msg.t === 'measure') {
      // 요청한 슬라이드를 그려 높이만 재서 돌려준다 (자동 분할용)
      var result = window.SermonOutput.measureSlide(msg.payload, msg.template);
      if (e.source && typeof e.source.postMessage === 'function') {
        e.source.postMessage({ t: 'measure:result', id: msg.id, payload: result }, '*');
      }
    }
  });

  // ── WebSocket 클라이언트 ─────────────────────────────────────
  //
  // 예배 운영의 핵심 세 가지가 여기에 들어 있다:
  //   1. 접속 시 서버가 전체 스냅샷을 보내므로 **새로고침해도 화면이 복구된다**
  //   2. 끊기면 지수 백오프로 재연결하되 **화면은 절대 비우지 않는다**
  //   3. revision 이 현재값보다 작은 메시지는 버린다 (연타 시 순서 뒤바뀜 방지)

  var RECONNECT_MIN = 250;
  var RECONNECT_MAX = 5000;

  var socket = null;
  var reconnectDelay = RECONNECT_MIN;
  var reconnectTimer = null;
  var knownRevision = -1;

  function wsUrl() {
    var scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return scheme + '//' + location.host + '/ws';
  }

  function scheduleReconnect() {
    if (reconnectTimer) return;
    reconnectTimer = setTimeout(function () {
      reconnectTimer = null;
      connect();
    }, reconnectDelay);
    // 지수 백오프 — 서버가 오래 죽어 있어도 재연결 시도가 폭주하지 않는다
    reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX);
  }

  function applyState(live) {
    // 순서가 뒤바뀐 오래된 메시지는 버린다
    if (typeof live.revision === 'number') {
      if (live.revision < knownRevision) {
        diag.dropped++;
        renderDebug();
        return;
      }
      knownRevision = live.revision;
      diag.revision = live.revision;
    }

    if (live.slide === null || live.slide === undefined) {
      // 서버가 '내용 없음'을 알린 것이므로 비우는 것이 맞다.
      // 연결 끊김과는 다른 상황이다.
      clearChildren(el.blocks);
      setOptional(el.heading, null);
      setOptional(el.reference, null);
      setOptional(el.credit, null);
      el.slide.dataset.empty = 'true';
      diag.lastRender = 'empty';
    } else {
      lastSlide = live.slide;
      render(live.slide);
    }

    window.SermonOutput.setBlank(Boolean(live.blank));
    renderDebug();
    reportErrors();
    reportMeasure();
  }

  function connect() {
    try {
      socket = new WebSocket(wsUrl());
    } catch (err) {
      diag.ws = 'fail';
      renderDebug();
      scheduleReconnect();
      return;
    }

    diag.ws = 'connecting';
    renderDebug();

    socket.onopen = function () {
      diag.ws = 'open';
      reconnectDelay = RECONNECT_MIN;
      renderDebug();
      sendMsg({ t: 'hello', role: 'output', layer: opts.layer });
    };

    socket.onmessage = function (event) {
      var msg;
      try {
        msg = JSON.parse(event.data);
      } catch (err) {
        diag.errors++;
        renderDebug();
        return;
      }
      if (!msg || typeof msg.t !== 'string') return;

      if (msg.t === 'state') {
        applyState(msg.payload);
      } else if (msg.t === 'style:patch') {
        applyStylePatch(msg.payload);
        // 글자 크기·여백이 바뀌면 넘침 여부가 달라지므로 다시 맞춘다.
        // 이걸 빼면 편집으로 글자를 키웠을 때 화면을 넘긴 채 방치된다.
        lastFit = applyAutoFit();
        renderDebug();
        reportMeasure();
      } else if (msg.t === 'template') {
        applyTemplate(msg.payload);
      }
    };

    socket.onclose = function () {
      // 화면은 그대로 둔다. 예배 중 검은 화면이 나가는 것이 최악이다.
      diag.ws = 'closed';
      renderDebug();
      scheduleReconnect();
    };

    socket.onerror = function () {
      diag.ws = 'error';
      renderDebug();
    };
  }

  function sendMsg(msg) {
    if (!socket || socket.readyState !== 1) return false;
    try {
      socket.send(JSON.stringify(msg));
      return true;
    } catch (err) {
      return false;
    }
  }

  /** 모아 둔 오류를 서버로 올려 컨트롤 패널에 경고가 뜨게 한다 */
  function reportErrors() {
    if (pendingErrors.length === 0) return;
    var batch = pendingErrors.slice(0, 5);
    for (var i = 0; i < batch.length; i++) {
      if (sendMsg({ t: 'client:error', payload: batch[i] })) pendingErrors.shift();
      else break;
    }
  }

  /**
   * 실측 결과를 보고한다.
   * overflow 는 '최소 배율로도 넘친다'는 뜻이다 — 컨트롤 패널이
   * '화면 넘김 단위를 더 잘게' 안내할 근거가 된다.
   */
  function reportMeasure() {
    var m = measure();
    sendMsg({
      t: 'measure:report',
      payload: { overflow: lastFit.overflow, height: m.height, revision: knownRevision },
    });
  }

  /**
   * 템플릿을 받는다. CSS 변수는 서버가 style:patch 로 따로 보내므로
   * 여기서는 behavior·override 처럼 렌더 방식이 달라지는 부분만 반영한다.
   * 렌더 방식이 바뀌었으니 현재 슬라이드를 다시 그린다.
   */
  function applyTemplate(next) {
    if (!next) return;
    template = next;
    if (lastSlide) render(lastSlide);
    else lastFit = applyAutoFit();
    renderDebug();
  }

  // OBS 브라우저 소스 크기를 바꾸면 가용 높이가 달라지므로 다시 맞춘다
  var resizeTimer = null;
  window.addEventListener('resize', function () {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      resizeTimer = null;
      lastFit = applyAutoFit();
      renderDebug();
    }, 120);
  });

  // 데모 모드에서는 연결하지 않는다 — 서버 상태가 데모 화면을 덮어쓰면
  // 스타일·폰트 확인이 불가능해진다.
  if (!opts.demo && !opts.measure) connect();

  // ── 데모 (?demo=1) ───────────────────────────────────────────
  if (opts.demo) {
    applyStylePatch({
      anchor: 'bottom-center',
      '--safe-bottom': '96px',
      '--safe-left': '120px',
      '--safe-right': '120px',
      '--primary-size': '68px',
      '--primary-stroke': '3px #000000',
      '--secondary-size': '44px',
      '--secondary-color': '#ffe9a8',
      '--secondary-stroke': '2px #000000',
      '--reference-stroke': '2px #000000',
    });
    render({
      kind: 'bible',
      reference: '요한복음 3:16',
      blocks: [
        {
          translationId: 'nkrv',
          translationName: '개역개정',
          lang: 'ko',
          direction: 'ltr',
          verses: [
            {
              book: 43,
              chapter: 3,
              verse: 16,
              text: '하나님이 세상을 이처럼 사랑하사 독생자를 주셨으니 이는 그를 믿는 자마다 멸망하지 않고 영생을 얻게 하려 하심이라',
            },
          ],
        },
        {
          translationId: 'niv',
          translationName: 'NIV',
          lang: 'en',
          direction: 'ltr',
          verses: [
            {
              book: 43,
              chapter: 3,
              verse: 16,
              text: 'For God so loved the world that he gave his one and only Son, that whoever believes in him shall not perish but have eternal life.',
            },
          ],
        },
      ],
    });
  }

  renderDebug();
})();
