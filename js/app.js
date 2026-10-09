/* 应用主逻辑 */
(function () {
  'use strict';
  var T = globalThis.MJ.Tiles;
  var D = globalThis.MJ.Decompose;
  var H = globalThis.MJ.Hand;
  var Render = globalThis.MJ.Render;
  var R = globalThis.MJ.Rules;
  var REC = globalThis.MJ.Recognize;
  var V = globalThis.MJ.VisionLocal;

  var STORE_KEY = 'mahjong-fan-v1';

  var state = {
    ruleId: 'mcr',
    hand: [],
    melds: [],
    flowers: [],
    winTile: null,
    tsumo: false,
    flags: {},
    roundWind: 0,
    seatWind: 0,
    dora: [],
    uraDora: [],
    ruleOpts: {},
    mode: 'hand',
    showNumber: true,
    recog: null,
    dockOpen: false,
    ai: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o', apiKey: '', providerId: 'openai' }
  };
  var history = [];

  var $ = function (id) { return document.getElementById(id); };
  var elRuleTabs = $('ruleTabs');
  var elRuleDesc = $('ruleDesc');
  var elHandRow = $('handRow');
  var elMeldRow = $('meldRow');
  var elFlowerRow = $('flowerRow');
  var elFlowersZone = $('flowersZone');
  var elHandHint = $('handHint');
  var elPalette = $('palette');
  var elModeTabs = $('modeTabs');
  var elCondBody = $('condBody');
  var elResult = $('result');
  var elAiStatus = $('aiStatus');
  var elPreview = $('photoPreview');
  var elDockPanel = $('dockPanel');
  var elDockGrip = $('dockGrip');
  var elDockBar = $('dockBar');
  var elDockToggle = $('btnDockToggle');
  var elDockHand = $('dockHand');
  var elDockMeld = $('dockMeld');
  var elDockFlower = $('dockFlower');
  var elDockFlowerStat = $('dockFlowerStat');
  var elToast = $('toast');
  var elRecogTabs = $('recogTabs');
  var elLocalTools = $('localTools');
  var elLocalCrops = $('localCrops');
  var elLocalCount = $('localCount');
  var elLocalN = $('localN');

  var MODES = [
    { id: 'hand', label: '手牌' },
    { id: 'chi', label: '吃' },
    { id: 'pon', label: '碰' },
    { id: 'kan', label: '杠' },
    { id: 'ankan', label: '暗杠' }
  ];

  /* ---------------- 状态与持久化 ---------------- */

  function rule() { return R.byId[state.ruleId] || R.list[0]; }

  function save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({
        ruleId: state.ruleId, ai: state.ai, showNumber: state.showNumber,
        ruleOpts: state.ruleOpts, recog: state.recog, dockOpen: state.dockOpen,
        hand: state.hand, melds: state.melds, flowers: state.flowers,
        winTile: state.winTile, tsumo: state.tsumo, flags: state.flags,
        roundWind: state.roundWind, seatWind: state.seatWind, dora: state.dora, uraDora: state.uraDora
      }));
    } catch (e) { /* 隐私模式下忽略 */ }
  }

  function isTile(t) { return typeof t === 'number' && t >= 0 && t < 42; }

  function load() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (!raw) return;
      var d = JSON.parse(raw);
      if (d.ruleId && R.byId[d.ruleId]) state.ruleId = d.ruleId;
      if (d.ai) state.ai = Object.assign(state.ai, d.ai);
      if (typeof d.showNumber === 'boolean') state.showNumber = d.showNumber;
      if (d.recog === 'ai' || d.recog === 'local') state.recog = d.recog;
      if (typeof d.dockOpen === 'boolean') state.dockOpen = d.dockOpen;
      if (d.ruleOpts) state.ruleOpts = d.ruleOpts;
      if (Array.isArray(d.hand)) state.hand = d.hand.filter(isTile);
      if (Array.isArray(d.melds)) state.melds = d.melds.filter(function (m) {
        return m && isTile(m.tile) && /^(chi|pon|kan|ankan)$/.test(m.type || '');
      });
      if (Array.isArray(d.flowers)) state.flowers = d.flowers.filter(isTile);
      if (isTile(d.winTile)) state.winTile = d.winTile;
      if (typeof d.tsumo === 'boolean') state.tsumo = d.tsumo;
      if (d.flags && typeof d.flags === 'object') state.flags = d.flags;
      if (typeof d.roundWind === 'number') state.roundWind = d.roundWind;
      if (typeof d.seatWind === 'number') state.seatWind = d.seatWind;
      if (Array.isArray(d.dora)) state.dora = d.dora.filter(isTile);
      if (Array.isArray(d.uraDora)) state.uraDora = d.uraDora.filter(isTile);
    } catch (e) { /* 忽略损坏数据 */ }
  }

  function snapshot() {
    history.push(JSON.stringify({
      hand: state.hand, melds: state.melds, flowers: state.flowers,
      winTile: state.winTile, tsumo: state.tsumo, flags: state.flags,
      roundWind: state.roundWind, seatWind: state.seatWind, dora: state.dora, uraDora: state.uraDora
    }));
    if (history.length > 60) history.shift();
  }

  function undo() {
    var last = history.pop();
    if (!last) return;
    var d = JSON.parse(last);
    state.hand = d.hand; state.melds = d.melds; state.flowers = d.flowers;
    state.winTile = d.winTile; state.tsumo = d.tsumo; state.flags = d.flags;
    state.roundWind = d.roundWind; state.seatWind = d.seatWind; state.dora = d.dora;
    state.uraDora = d.uraDora || [];
    renderAll();
  }

  function effectiveWinTile() {
    if (state.winTile !== null) return state.winTile;
    return state.hand.length ? state.hand[state.hand.length - 1] : null;
  }

  function fullCounts() {
    var c = T.countsFrom(state.hand);
    for (var i = 0; i < state.melds.length; i++) {
      var m = state.melds[i];
      var tiles = meldTilesOf(m);
      for (var j = 0; j < tiles.length; j++) c[tiles[j]]++;
    }
    return c;
  }

  function meldTilesOf(m) {
    if (m.type === 'chi') return [m.tile, m.tile + 1, m.tile + 2];
    if (m.type === 'kan' || m.type === 'ankan') return [m.tile, m.tile, m.tile, m.tile];
    return [m.tile, m.tile, m.tile];
  }

  /* ---------------- 录入反馈 ---------------- */

  var pendingFlash = null;
  var toastTimer = null;
  var statTimer = null;

  function haptic(ms) {
    if (navigator.vibrate) { try { navigator.vibrate(ms || 12); } catch (e) { /* 桌面浏览器忽略 */ } }
  }

  function countOf(arr, t) {
    var n = 0;
    for (var i = 0; i < arr.length; i++) if (arr[i] === t) n++;
    return n;
  }

  /* 让刚加进去的那张牌在下一次渲染时闪一下 */
  function markFlash(kind, tile, index) {
    pendingFlash = { kind: kind, tile: tile, index: index };
  }

  function bumpStat(el) {
    if (!el) return;
    var stat = el.parentNode;
    stat.classList.remove('is-bump');
    void stat.offsetWidth;
    stat.classList.add('is-bump');
    clearTimeout(statTimer);
    statTimer = setTimeout(function () { stat.classList.remove('is-bump'); }, 400);
  }

  function showToast(text, tile, kind) {
    elToast.innerHTML = '';
    if (typeof tile === 'number') {
      var box = document.createElement('span');
      box.className = 'toast-svg';
      box.innerHTML = Render.tileSVG(tile, { showNumber: false });
      elToast.appendChild(box);
    }
    elToast.appendChild(document.createTextNode(text));
    elToast.className = 'toast is-on' + (kind === 'warn' ? ' is-warn' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { elToast.className = 'toast'; }, 1500);
  }

  function rejectAdd(msg) {
    haptic(24);
    showToast(msg, null, 'warn');
  }

  function commitAdd(text, tile, statEl, flashKind, flashIndex) {
    if (flashKind) markFlash(flashKind, tile, flashIndex);
    haptic(12);
    renderAll();
    bumpStat(statEl);
    showToast(text, tile);
  }

  function tapTile(d) {
    d.classList.remove('is-tapped');
    void d.offsetWidth;
    d.classList.add('is-tapped');
    setTimeout(function () { d.classList.remove('is-tapped'); }, 260);
  }

  /* ---------------- 渲染：规则 ---------------- */

  function renderRuleTabs() {
    elRuleTabs.innerHTML = '';
    R.list.forEach(function (r) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'rule-tab' + (r.id === state.ruleId ? ' active' : '');
      b.textContent = r.short || r.name;
      b.addEventListener('click', function () {
        if (state.ruleId === r.id) return;
        snapshot();
        state.ruleId = r.id;
        // 换规则时清掉不适用的牌
        var allowed = allowedTiles(r);
        state.hand = state.hand.filter(function (t) { return allowed.indexOf(t) >= 0; });
        state.melds = state.melds.filter(function (m) {
          return allowed.indexOf(m.tile) >= 0;
        });
        state.flowers = state.flowers.filter(function (t) {
          return allowed.indexOf(t) >= 0 && T.isFlower(t);
        });
        var w = effectiveWinTile();
        if (w !== null && allowed.indexOf(w) < 0) state.winTile = null;
        if (!r.has.flowers) { state.flowers = []; }
        if (state.mode === 'flower' && !r.has.flowers) state.mode = 'hand';
        save();
        renderAll();
      });
      elRuleTabs.appendChild(b);
    });
    var r = rule();
    elRuleDesc.textContent = r.name + ' · ' + r.desc;
  }

  function allowedTiles(r) {
    var out = [];
    for (var t = 0; t < 34; t++) {
      if (T.isHonor(t) && r.has && r.has.noHonors) continue;
      out.push(t);
    }
    if (r.has && r.has.flowers) for (var f = 34; f < 42; f++) out.push(f);
    return out;
  }

  /* ---------------- 渲染：牌面 ---------------- */

  function tileEl(tile, opts) {
    opts = opts || {};
    var d = document.createElement('div');
    d.className = 'tile' + (opts.win ? ' is-win' : '') + (opts.cls ? ' ' + opts.cls : '');
    d.innerHTML = Render.tileSVG(tile, { showNumber: state.showNumber });
    if (opts.badge) {
      var b = document.createElement('span');
      b.className = 'badge';
      b.textContent = opts.badge;
      d.appendChild(b);
    }
    if (opts.title) d.title = opts.title;
    return d;
  }

  function renderHand() {
    elHandRow.innerHTML = '';
    var win = effectiveWinTile();
    var sorted = T.sortTiles(state.hand);
    var seen = 0;
    sorted.forEach(function (t) {
      var d = tileEl(t, { win: t === win, badge: '×' });
      if (pendingFlash && pendingFlash.kind === 'hand' && t === pendingFlash.tile) {
        if (seen++ === pendingFlash.index) d.classList.add('is-new');
      }
      d.title = T.name(t) + '（点一下设为胡牌张）';
      d.addEventListener('click', function () {
        snapshot();
        if (state.winTile === t) state.winTile = null;
        else state.winTile = t;
        renderAll();
      });
      d.querySelector('.badge').addEventListener('click', function (ev) {
        ev.stopPropagation();
        snapshot();
        var i = state.hand.indexOf(t);
        if (i >= 0) state.hand.splice(i, 1);
        if (state.winTile === t && state.hand.indexOf(t) < 0) state.winTile = null;
        renderAll();
      });
      elHandRow.appendChild(d);
    });
    var r = rule();
    var complete = (r.needSets - state.melds.length) * 3 + 2;
    elHandHint.textContent = '刚和牌应有 ' + complete + ' 张，当前 ' + state.hand.length + ' 张';
  }

  var MELD_LABEL = { chi: '吃', pon: '碰', kan: '杠', ankan: '暗杠' };

  function renderMelds() {
    elMeldRow.innerHTML = '';
    state.melds.forEach(function (m, idx) {
      var g = document.createElement('div');
      g.className = 'meld-group' + (m.type === 'ankan' ? ' is-ankan' : '');
      if (pendingFlash && pendingFlash.kind === 'meld' && idx === pendingFlash.index) g.classList.add('is-new');
      meldTilesOf(m).forEach(function (t) {
        var d = tileEl(t, { cls: m.type === 'ankan' ? 'is-back' : '' });
        if (m.type === 'ankan') d.innerHTML = Render.backSVG();
        g.appendChild(d);
      });
      var tag = document.createElement('span');
      tag.className = 'tag';
      tag.textContent = MELD_LABEL[m.type] || m.type;
      g.appendChild(tag);
      g.title = '点一下删除这组副露';
      g.addEventListener('click', function () {
        snapshot();
        state.melds.splice(idx, 1);
        renderAll();
      });
      elMeldRow.appendChild(g);
    });
  }

  function renderFlowers() {
    var r = rule();
    elFlowersZone.hidden = !(r.has && r.has.flowers);
    elFlowerRow.innerHTML = '';
    var seen = 0;
    state.flowers.slice().sort(function (a, b) { return a - b; }).forEach(function (t) {
      var d = tileEl(t, { badge: '×' });
      if (pendingFlash && pendingFlash.kind === 'flower' && t === pendingFlash.tile) {
        if (seen++ === pendingFlash.index) d.classList.add('is-new');
      }
      d.addEventListener('click', function () {
        snapshot();
        var i = state.flowers.indexOf(t);
        if (i >= 0) state.flowers.splice(i, 1);
        renderAll();
      });
      elFlowerRow.appendChild(d);
    });
  }

  /* ---------------- 渲染：点牌盘 ---------------- */

  function renderModeTabs() {
    var r = rule();
    elModeTabs.innerHTML = '';
    MODES.forEach(function (m) {
      if (m.id === 'flower' && !(r.has && r.has.flowers)) return;
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'mode-tab' + (state.mode === m.id ? ' active' : '');
      b.textContent = m.label;
      b.addEventListener('click', function () {
        state.mode = m.id;
        renderModeTabs();
      });
      elModeTabs.appendChild(b);
    });
  }

  function renderPalette() {
    var r = rule();
    elPalette.innerHTML = '';
    var groups = [
      { label: '万', tiles: range(0, 9) },
      { label: '条', tiles: range(9, 18) },
      { label: '饼', tiles: range(18, 27) }
    ];
    if (!(r.has && r.has.noHonors)) groups.push({ label: '字', tiles: range(27, 34) });
    if (r.has && r.has.flowers) groups.push({ label: '花', tiles: range(34, 42) });

    groups.forEach(function (g) {
      var wrap = document.createElement('div');
      wrap.className = 'palette-group';
      var lab = document.createElement('span');
      lab.className = 'group-label';
      lab.textContent = g.label;
      wrap.appendChild(lab);
      g.tiles.forEach(function (t) {
        var d = tileEl(t);
        d.title = T.name(t);
        d.addEventListener('click', function () { tapTile(d); addTile(t); });
        wrap.appendChild(d);
      });
      elPalette.appendChild(wrap);
    });
  }

  function range(a, b) { var o = []; for (var i = a; i < b; i++) o.push(i); return o; }

  function addTile(t) {
    var r = rule();
    var label = T.name(t);

    /* 花牌不用先切模式，点一下就进花牌区 */
    if (T.isFlower(t)) {
      if (!(r.has && r.has.flowers)) {
        rejectAdd('「' + (r.short || r.name) + '」不算花牌，已忽略 ' + label);
        return;
      }
      snapshot();
      state.flowers.push(t);
      commitAdd('已加入花牌 ' + label, t, elDockFlower, 'flower', countOf(state.flowers, t) - 1);
      return;
    }

    if (state.mode === 'hand') {
      snapshot();
      state.hand.push(t);
      commitAdd('已加入 ' + label, t, elDockHand, 'hand', countOf(state.hand, t) - 1);
      return;
    }

    if (state.mode === 'chi') {
      if (!(T.isSuit(t) && t % 9 <= 6)) {
        rejectAdd('吃要选顺子的第一张，比如 123 饼里的 1 饼');
        return;
      }
      snapshot();
      state.melds.push({ type: 'chi', tile: t });
      commitAdd('已加入 吃 ' + label + T.name(t + 1) + T.name(t + 2), t, elDockMeld, 'meld', state.melds.length - 1);
      return;
    }

    snapshot();
    state.melds.push({ type: state.mode, tile: t });
    commitAdd('已加入 ' + (MELD_LABEL[state.mode] || state.mode) + ' ' + label, t,
      elDockMeld, 'meld', state.melds.length - 1);
  }

  /* ---------------- 渲染：和牌条件 ---------------- */

  function renderConditions() {
    var r = rule();
    elCondBody.innerHTML = '';

    addSeg('和牌方式', [
      { label: '自摸', on: state.tsumo, act: function () { state.tsumo = true; renderAll(); } },
      { label: '点炮', on: !state.tsumo, act: function () { state.tsumo = false; renderAll(); } }
    ]);

    if (r.has && r.has.winds) {
      addSeg('圈风', ['东', '南', '西', '北'].map(function (w, i) {
        return { label: w, on: state.roundWind === i, act: function () { state.roundWind = i; renderAll(); } };
      }));
      addSeg('门风', ['东', '南', '西', '北'].map(function (w, i) {
        return { label: w, on: state.seatWind === i, act: function () { state.seatWind = i; renderAll(); } };
      }));
    }

    var flagDefs = [];
    if (r.has && r.has.riichi) {
      flagDefs.push(['riichi', '立直']);
      flagDefs.push(['doubleRiichi', '两立直']);
      flagDefs.push(['ippatsu', '一发']);
    }
    flagDefs.push(['rinshan', '杠上开花']);
    flagDefs.push(['chankan', '抢杠']);
    flagDefs.push(['haitei', '海底自摸']);
    flagDefs.push(['houtei', '河底点炮']);
    flagDefs.push(['tenhou', '天和']);
    flagDefs.push(['chiihou', '地和']);
    if (r.id === 'mcr') flagDefs.push(['lastTile', '和绝张']);
    addSwitchRow('特殊事件', flagDefs);

    if (r.has && r.has.dora) {
      addDoraRow('宝牌', 'dora');
      if (state.flags.riichi) addDoraRow('里宝牌', 'uraDora');
    }

    // 规则自定义选项
    (r.options || []).forEach(function (o) {
      if (o.type === 'bool') {
        addSwitchRow(o.label, [[o.key, o.label]], o.def !== false);
      } else if (o.type === 'number') {
        addNumberRow(o);
      }
    });

    function addSeg(label, items) {
      var g = document.createElement('div');
      g.className = 'cond-group';
      var l = document.createElement('span');
      l.className = 'label';
      l.textContent = label;
      g.appendChild(l);
      var seg = document.createElement('div');
      seg.className = 'seg';
      items.forEach(function (it) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = it.on ? 'active' : '';
        b.textContent = it.label;
        b.addEventListener('click', function () { snapshot(); it.act(); });
        seg.appendChild(b);
      });
      g.appendChild(seg);
      elCondBody.appendChild(g);
    }

    function addSwitchRow(label, defs) {
      var g = document.createElement('div');
      g.className = 'cond-group';
      var l = document.createElement('span');
      l.className = 'label';
      l.textContent = label;
      g.appendChild(l);
      var seg = document.createElement('div');
      seg.className = 'seg';
      defs.forEach(function (d) {
        var key = d[0], text = d[1];
        var lab = document.createElement('label');
        lab.className = 'switch';
        var cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = !!state.flags[key];
        cb.addEventListener('change', function () {
          snapshot();
          state.flags[key] = cb.checked;
          renderAll();
        });
        var sp = document.createElement('span');
        sp.textContent = text;
        lab.appendChild(cb);
        lab.appendChild(sp);
        seg.appendChild(lab);
      });
      g.appendChild(seg);
      elCondBody.appendChild(g);
    }

    function addNumberRow(o) {
      var g = document.createElement('div');
      g.className = 'cond-group';
      var l = document.createElement('span');
      l.className = 'label';
      l.textContent = o.label;
      g.appendChild(l);
      var inp = document.createElement('input');
      inp.type = 'number';
      inp.min = '0';
      inp.style.cssText = 'width:80px;padding:6px 10px;border-radius:8px;border:1px solid var(--line);background:#0f1a16;color:inherit';
      var cur = state.ruleOpts[o.key];
      inp.value = (cur === undefined ? o.def : cur);
      inp.addEventListener('change', function () {
        snapshot();
        state.ruleOpts[o.key] = Number(inp.value);
        save();
        renderAll();
      });
      g.appendChild(inp);
      elCondBody.appendChild(g);
    }

    function addDoraRow(label, key) {
      var g = document.createElement('div');
      g.className = 'cond-group';
      var l = document.createElement('span');
      l.className = 'label';
      l.textContent = label;
      g.appendChild(l);
      var wrap = document.createElement('div');
      wrap.className = 'seg';
      wrap.style.alignItems = 'center';
      state[key].forEach(function (t, i) {
        var d = tileEl(t, { cls: 'mini-tile', badge: '×', title: T.name(t) });
        d.style.width = '30px';
        d.addEventListener('click', function () {
          snapshot();
          state[key].splice(i, 1);
          renderAll();
        });
        wrap.appendChild(d);
      });
      var addBtn = document.createElement('button');
      addBtn.type = 'button';
      addBtn.textContent = '＋ 添加指示牌';
      addBtn.addEventListener('click', function () { openPicker(function (t) {
        snapshot();
        state[key].push(t);
        renderAll();
      }); });
      wrap.appendChild(addBtn);
      g.appendChild(wrap);
      elCondBody.appendChild(g);
    }
  }

  /* 通用选牌弹层 */
  function openPicker(cb, opts) {
    opts = opts || {};
    var r = rule();
    var overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:50;display:flex;' +
      'align-items:flex-end;justify-content:center;padding:0 0 env(safe-area-inset-bottom)';
    var box = document.createElement('div');
    box.style.cssText = 'background:var(--card);border:1px solid var(--line);border-radius:16px 16px 0 0;' +
      'padding:14px;width:100%;max-width:760px;max-height:70vh;overflow:auto';
    var title = document.createElement('div');
    title.textContent = opts.title || '选择一张牌';
    title.style.cssText = 'color:var(--gold);font-size:13px;letter-spacing:.1em;margin-bottom:10px';
    box.appendChild(title);
    box.className = 'palette';
    var groups = [
      { label: '万', tiles: range(0, 9) }, { label: '条', tiles: range(9, 18) },
      { label: '饼', tiles: range(18, 27) }
    ];
    if (!(r.has && r.has.noHonors)) groups.push({ label: '字', tiles: range(27, 34) });
    if (opts.flowers && r.has && r.has.flowers) groups.push({ label: '花', tiles: range(34, 42) });
    groups.forEach(function (g) {
      var wrap = document.createElement('div');
      wrap.className = 'palette-group';
      var lab = document.createElement('span');
      lab.className = 'group-label';
      lab.textContent = g.label;
      wrap.appendChild(lab);
      g.tiles.forEach(function (t) {
        var d = tileEl(t);
        d.addEventListener('click', function () { document.body.removeChild(overlay); cb(t); });
        wrap.appendChild(d);
      });
      box.appendChild(wrap);
    });
    overlay.appendChild(box);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) document.body.removeChild(overlay); });
    document.body.appendChild(overlay);
  }

  /* ---------------- 算番 ---------------- */

  function buildCtx() {
    var r = rule();
    var win = effectiveWinTile();
    return H.buildContext({
      hand: state.hand,
      melds: state.melds,
      winTile: win === null ? undefined : win,
      tsumo: state.tsumo,
      seatWind: state.seatWind,
      roundWind: state.roundWind,
      flowers: state.flowers,
      dora: state.dora,
      uraDora: state.uraDora,
      flags: state.flags,
      options: R.optionsFor(r, state.ruleOpts)
    });
  }

  function analyze(ctx) {
    var r = rule();
    var complete = (r.needSets - ctx.meldCount) * 3 + 2;
    var n = ctx.handTiles.length;
    var out = { complete: complete, count: n, needSets: r.needSets, meldCount: ctx.meldCount };
    if (n === 0) return out;
    if (n > complete) { out.tooMany = true; return out; }
    out.shanten = D.shanten(ctx.counts, ctx.meldCount, ctx.options);
    if (out.shanten === 0 && n === complete - 1) {
      out.waits = D.waits(ctx.counts, ctx.meldCount, ctx.options);
    } else if (out.shanten > 0) {
      out.improve = D.improvements(ctx.counts, ctx.meldCount, ctx.options).tiles;
    }
    return out;
  }

  function renderResult() {
    elResult.innerHTML = '';
    if (state.hand.length === 0) {
      elResult.innerHTML = '<p class="empty-tip">先拍照识牌，或用下方点牌盘录入手牌。</p>';
      return;
    }
    if (state.melds.length > rule().needSets) {
      elResult.innerHTML = '<p class="empty-tip">副露数量超过了 ' + rule().needSets + ' 副。</p>';
      return;
    }
    var ctx = buildCtx();
    var res = rule().score(ctx);
    var info = analyze(ctx);

    if (res.ok !== false && res.total !== undefined) {
      elResult.appendChild(scoreHead(res));
      elResult.appendChild(fanList(res));
    }

    var alerts = [];
    if (res.errors) alerts = alerts.concat(res.errors);
    if (res.warnings) alerts = alerts.concat(res.warnings);
    if (res.ok === false && ctx.decomps.length === 0 && info.count > 0) {
      alerts = alerts.filter(function (a) { return a.indexOf('和牌牌型') < 0; });
    }
    alerts.forEach(function (a) {
      var cls = /不够|不能|不含|张数|没有构成|不在手牌/.test(a) ? 'err' : 'warn';
      elResult.appendChild(alertBox(a, cls));
    });
    if (res.note) elResult.appendChild(alertBox(res.note, res.reachMinimum === false ? 'warn' : 'info'));

    // 未和牌时给听牌 / 向听分析
    if (info.count > 0 && (ctx.decomps.length === 0 || res.ok === false)) {
      elResult.appendChild(tenpaiBox(info));
    } else if (info.count > 0 && info.waits && info.waits.length) {
      elResult.appendChild(tenpaiBox(info));
    }
  }

  function scoreHead(res) {
    var head = document.createElement('div');
    head.className = 'score-head' + (res.reachMinimum === false || res.ok === false ? ' is-bad' : '');
    var big = document.createElement('span');
    big.className = 'score-big';
    big.textContent = res.total;
    var unit = document.createElement('span');
    unit.className = 'score-unit';
    unit.textContent = res.unit || '番';
    head.appendChild(big);
    head.appendChild(unit);

    var sub = document.createElement('span');
    sub.className = 'score-sub';
    var parts = [];
    if (res.multiple) parts.push('＝ ' + res.multiple + ' 倍');
    if (res.points && res.points.text) parts.push(res.points.text);
    if (res.fu) parts.push(res.fu + ' 符');
    if (res.dora) parts.push('宝牌 ' + res.dora + ' 番');
    if (parts.length === 0 && res.pointsText) parts.push(res.pointsText);
    sub.textContent = parts.join(' · ');
    head.appendChild(sub);
    return head;
  }

  function fanList(res) {
    var ul = document.createElement('ul');
    ul.className = 'fan-list';
    var shown = (res.fans || []).slice().sort(function (a, b) {
      if (!!a.excluded !== !!b.excluded) return a.excluded ? 1 : -1;
      return b.value - a.value;
    });
    if (!shown.length) {
      var p = document.createElement('li');
      p.className = 'empty-tip';
      p.textContent = '没有匹配到任何番型。';
      ul.appendChild(p);
      return ul;
    }
    shown.forEach(function (f) {
      var li = document.createElement('li');
      li.className = 'fan-item' + (f.excluded ? ' dropped' : '');
      var v = document.createElement('span');
      v.className = 'fan-val';
      v.textContent = (f.value > 0 ? '+' : '') + f.value;
      var n = document.createElement('span');
      n.className = 'fan-name';
      n.textContent = f.name;
      li.appendChild(v);
      li.appendChild(n);
      var noteText = f.reason || f.note;
      if (noteText) {
        var note = document.createElement('span');
        note.className = 'fan-note';
        note.textContent = noteText;
        li.appendChild(note);
      }
      ul.appendChild(li);
    });
    return ul;
  }

  function alertBox(text, cls) {
    var d = document.createElement('div');
    d.className = 'alert ' + (cls || 'info');
    d.textContent = text;
    return d;
  }

  function tenpaiBox(info) {
    var wrap = document.createElement('div');
    if (info.tooMany) {
      wrap.appendChild(alertBox('手牌张数超过了上限，请检查是否多录。', 'warn'));
      return wrap;
    }
    var head = document.createElement('div');
    head.className = 'alert info';
    var text;
    if (info.waits && info.waits.length) {
      text = '已听牌，等待这些牌即可和：';
    } else if (info.shanten === 0) {
      text = '向听数 0 但还差一张，请检查胡牌张设置。';
    } else {
      text = '距离听牌还有 ' + info.shanten + ' 向听';
      if (info.improve && info.improve.length) text += '，有效进张如下';
    }
    head.textContent = text;
    wrap.appendChild(head);

    var list = info.waits && info.waits.length ? info.waits : (info.improve || []);
    if (list.length) {
      var row = document.createElement('div');
      row.className = 'tenpai-row';
      list.forEach(function (t) {
        var d = tileEl(t, { title: T.name(t) });
        d.style.width = '32px';
        row.appendChild(d);
      });
      wrap.appendChild(row);
    }
    return wrap;
  }

  /* ---------------- 牌谱解析 ---------------- */

  function parseNotation(str) {
    var hand = [], melds = [], flowers = [];
    var tokens = String(str).replace(/[，,、]/g, ' ').trim().split(/\s+/);
    tokens.forEach(function (tk) {
      if (!tk) return;
      var m = tk.match(/^\[(.+)\]$/);
      if (m) {
        var inner = m[1].replace(/^-/, '');
        var dark = /^-/.test(m[1]);
        var tiles = T.parse(inner);
        if (tiles.length === 4) melds.push({ type: dark ? 'ankan' : 'kan', tile: tiles[0] });
        else if (tiles.length === 3) {
          var same = tiles[0] === tiles[1] && tiles[1] === tiles[2];
          melds.push({ type: same ? 'pon' : 'chi', tile: same ? tiles[0] : Math.min.apply(null, tiles) });
        }
        return;
      }
      T.parse(tk).forEach(function (t) {
        if (T.isFlower(t)) flowers.push(t);
        else hand.push(t);
      });
    });
    return { hand: hand, melds: melds, flowers: flowers };
  }

  function applyNotation() {
    var inp = $('notation');
    var txt = inp.value.trim();
    if (!txt) return;
    try {
      var p = parseNotation(txt);
      snapshot();
      state.hand = T.sortTiles(p.hand);
      state.melds = state.melds.concat(p.melds);
      state.flowers = state.flowers.concat(p.flowers);
      state.winTile = null;
      inp.value = '';
      renderAll();
    } catch (e) {
      elResult.innerHTML = '';
      elResult.appendChild(alertBox('牌谱解析失败：' + e.message, 'err'));
    }
  }

  /* ---------------- 拍照识别 ---------------- */

  function setAiStatus(text, cls) {
    elAiStatus.hidden = !text;
    elAiStatus.className = 'ai-status' + (cls ? ' ' + cls : '');
    elAiStatus.innerHTML = text;
  }

  function handleFiles(files) {
    if (state.recog === 'local') { runLocalSlice(files); return; }
    elPreview.innerHTML = '';
    Array.prototype.slice.call(files).slice(0, 4).forEach(function (f) {
      if (!/^image\//.test(f.type)) return;
      var img = document.createElement('img');
      img.src = URL.createObjectURL(f);
      elPreview.appendChild(img);
    });
    if (!state.ai.apiKey) {
      setAiStatus('还没有配置识别服务，点「识别设置」填写接口地址、模型名和 API Key。', 'error');
      return;
    }
    setAiStatus('<span class="spinner"></span>正在识别…', 'loading');
    REC.recognizeFiles(files, state.ai).then(function (res) {
      snapshot();
      var r = rule();
      var allowed = allowedTiles(r);
      state.hand = res.hand.filter(function (t) { return allowed.indexOf(t) >= 0; });
      state.melds = res.melds.filter(function (m) { return allowed.indexOf(m.tile) >= 0; });
      state.flowers = res.flowers.filter(function (t) { return allowed.indexOf(t) >= 0; });
      state.winTile = (res.winTile !== null && allowed.indexOf(res.winTile) >= 0) ? res.winTile : null;
      var msg = '识别完成：手牌 ' + res.hand.length + ' 张';
      if (res.melds.length) msg += '，副露 ' + res.melds.length + ' 组';
      if (res.confidence) msg += '，置信度 ' + res.confidence;
      if (res.notes) msg += '。' + res.notes;
      if (res.badCodes && res.badCodes.length) msg += '（这些记号看不懂已忽略：' + res.badCodes.join(' ') + '）';
      msg += '　请核对后再看结果。';
      setAiStatus(msg, 'ok');
      renderAll();
    }).catch(function (err) {
      setAiStatus('识别失败：' + err.message, 'error');
    });
  }

  /* ---------------- 底部悬浮抽屉 ---------------- */

  var dockY = null;
  var dockDrag = null;

  function dockLimits() {
    var peek = elDockGrip.offsetHeight + elDockBar.offsetHeight;
    return { min: 0, max: Math.max(0, elDockPanel.offsetHeight - peek) };
  }

  function placeDock(y, animate) {
    var m = dockLimits();
    dockY = Math.max(m.min, Math.min(m.max, y));
    elDockPanel.style.transition = animate === false ? 'none' : '';
    elDockPanel.style.transform = 'translateY(' + dockY + 'px)';
  }

  function dockToggleLabel(open) {
    elDockToggle.textContent = open ? '▼' : '▲';
    elDockToggle.setAttribute('aria-label', open ? '收起点牌录入' : '上拉展开点牌录入');
  }

  function setDockOpen(open) {
    state.dockOpen = !!open;
    placeDock(state.dockOpen ? dockLimits().min : dockLimits().max);
    dockToggleLabel(state.dockOpen);
    save();
  }

  function initDock() {
    placeDock(state.dockOpen ? dockLimits().min : dockLimits().max, false);
    dockToggleLabel(state.dockOpen);

    elDockGrip.addEventListener('pointerdown', function (e) {
      dockDrag = { y0: e.clientY, base: dockY, y: null };
      elDockPanel.style.transition = 'none';
      elDockGrip.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    elDockGrip.addEventListener('pointermove', function (e) {
      if (!dockDrag) return;
      var m = dockLimits();
      dockDrag.y = Math.max(m.min, Math.min(m.max, dockDrag.base + (e.clientY - dockDrag.y0)));
      dockY = dockDrag.y;
      elDockPanel.style.transform = 'translateY(' + dockY + 'px)';
    });
    function endDrag() {
      if (!dockDrag) return;
      var m = dockLimits();
      var cur = dockDrag.y === null ? dockDrag.base : dockDrag.y;
      var moved = cur - dockDrag.base;
      var open;
      if (moved < -60) open = true;
      else if (moved > 60) open = false;
      else open = dockDrag.base < (m.min + m.max) / 2;
      dockDrag = null;
      elDockPanel.style.transition = '';
      setDockOpen(open);
    }
    elDockGrip.addEventListener('pointerup', endDrag);
    elDockGrip.addEventListener('pointercancel', endDrag);
    elDockGrip.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setDockOpen(!state.dockOpen); }
    });

    elDockToggle.addEventListener('click', function () { setDockOpen(!state.dockOpen); });
    elDockBar.addEventListener('click', function (e) {
      if (e.target && e.target.closest && e.target.closest('button')) return;
      setDockOpen(!state.dockOpen);
    });

    window.addEventListener('resize', function () {
      placeDock(state.dockOpen ? dockLimits().min : dockLimits().max, false);
    });
  }

  /* ---------------- 本地切图：不联网、不调模型 ---------------- */

  var slices = [];
  var sliceSrc = null;

  function clearSlices() {
    slices = [];
    if (sliceSrc && sliceSrc.url) URL.revokeObjectURL(sliceSrc.url);
    sliceSrc = null;
    renderSlices();
  }

  function applyRects(rects) {
    var pad = Math.max(2, Math.round(sliceSrc.w * 0.012));
    slices = rects.map(function (r) {
      var rect = V.padRect(r, pad, sliceSrc.w, sliceSrc.h);
      return { rect: rect, url: V.cropDataUrl(sliceSrc.img, rect, sliceSrc.scale), tile: null };
    });
  }

  /* 本地模型的结果本身就带牌名和边框，直接拿来用，省掉逐张点选 */
  function applyDetections(dets) {
    var pad = Math.max(2, Math.round(sliceSrc.w * 0.012));
    slices = dets.map(function (d) {
      var rect = V.padRect({
        x0: Math.round(d.x1), y0: Math.round(d.y1),
        x1: Math.round(d.x2), y1: Math.round(d.y2)
      }, pad, sliceSrc.w, sliceSrc.h);
      var t = T.fromCode(d.tile);
      return {
        rect: rect,
        url: V.cropDataUrl(sliceSrc.img, rect, sliceSrc.scale),
        tile: (t === undefined || t === null) ? null : t,
        score: d.score
      };
    });
  }

  function nextUnset(from) {
    for (var i = from; i < slices.length; i++) if (slices[i].tile === null) return i;
    return -1;
  }

  function pickSlice(i) {
    openPicker(function (t) {
      slices[i].tile = t;
      haptic(12);
      renderSlices();
      showToast('第 ' + (i + 1) + ' 格 → ' + T.name(t), t);
      var next = nextUnset(i);
      var el = next >= 0 ? elLocalCrops.children[next] : null;
      if (el && el.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    }, { flowers: true, title: '第 ' + (i + 1) + ' 格是什么牌' });
  }

  function renderSlices() {
    elLocalTools.hidden = !slices.length;
    elLocalCrops.innerHTML = '';
    var set = 0;
    slices.forEach(function (s) { if (s.tile !== null) set++; });
    if (slices.length) {
      elLocalCount.textContent = '切出 ' + slices.length + ' 张，已选 ' + set + ' / ' + slices.length;
    }
    var next = nextUnset(0);
    slices.forEach(function (s, i) {
      var item = document.createElement('div');
      item.className = 'crop-item' + (s.tile !== null ? ' is-set' : '') + (i === next ? ' is-next' : '');

      var shot = document.createElement('div');
      shot.className = 'crop-shot';
      var img = document.createElement('img');
      img.src = s.url;
      img.alt = '第 ' + (i + 1) + ' 格';
      shot.appendChild(img);
      if (s.tile !== null) {
        var hit = document.createElement('div');
        hit.className = 'crop-hit';
        hit.innerHTML = Render.tileSVG(s.tile, { showNumber: false });
        shot.appendChild(hit);
      }
      var del = document.createElement('button');
      del.type = 'button';
      del.className = 'crop-del';
      del.textContent = '×';
      del.title = '删掉这一格';
      del.addEventListener('click', function (ev) {
        ev.stopPropagation();
        slices.splice(i, 1);
        renderSlices();
      });
      shot.appendChild(del);
      item.appendChild(shot);

      var name = document.createElement('div');
      name.className = 'crop-name';
      if (s.tile === null) {
        name.textContent = '点一下选牌';
      } else {
        name.textContent = T.name(s.tile) +
          (s.score === undefined ? '' : ' ' + Math.round(s.score * 100) + '%');
        if (s.score !== undefined && s.score < 0.5) item.classList.add('is-unsure');
      }
      item.appendChild(name);

      item.addEventListener('click', function () { pickSlice(i); });
      elLocalCrops.appendChild(item);
    });
  }

  function runLocalSlice(files) {
    var file = files[0];
    if (!file) return;
    var extra = files.length > 1 ? '（选了 ' + files.length + ' 张图，本地切图只用第一张）' : '';
    elPreview.innerHTML = '';
    clearSlices();
    var ML = globalThis.MJ.VisionML;
    setAiStatus('<span class="spinner"></span>' + (ML && ML.recognize ? '正在用本地模型识牌…' : '正在本地切图…'), 'loading');
    V.analyzeFile(file).then(function (res) {
      sliceSrc = res;
      if (!ML || !ML.recognize) return null;
      return ML.recognize(res.img, { conf: 0.25 }).catch(function () { return null; });
    }).then(function (ml) {
      if (ml && ml.tiles && ml.tiles.length >= 4) {
        applyDetections(ml.tiles);
        var sure = ml.tiles.filter(function (d) { return d.score >= 0.5; }).length;
        setAiStatus('本地模型认出 ' + slices.length + ' 张牌（' + sure + ' 张很有把握），已经替你填好了。' +
          '点小图可以改，核对完点「填入手牌」。' + extra,
          sure * 2 >= slices.length ? 'ok' : 'warn');
      } else if (sliceSrc.ok && sliceSrc.cols.length >= 2 && sliceSrc.confidence >= 0.3) {
        applyRects(sliceSrc.cols);
        setAiStatus('本地切出 ' + slices.length + ' 张，牌宽挺齐（把握 ' +
          Math.round(sliceSrc.confidence * 100) + '%）。点小图选牌名，全选完点「填入手牌」。' + extra,
          sliceSrc.confidence >= 0.5 ? 'ok' : 'warn');
      } else if (sliceSrc.ok && sliceSrc.cols.length >= 2) {
        applyRects(sliceSrc.cols);
        setAiStatus('这照片切得不太齐（把握 ' + Math.round(sliceSrc.confidence * 100) +
          '%），可能是桌面全景或牌有重叠。请在张数里填好张数点「重切」，或换一张只拍一排牌的。' + extra, 'warn');
      } else {
        applyRects(V.splitEven(sliceSrc.box, 14));
        setAiStatus('没认出一整行牌，先按 14 张均分。填个「张数」再点「重切」可纠正。' + extra, 'warn');
      }
      renderSlices();
    }).catch(function (err) {
      setAiStatus('切图失败：' + err.message, 'error');
    });
  }

  function reslice() {
    if (!sliceSrc) return;
    var n = parseInt(elLocalN.value, 10);
    if (n > 0 && n <= 30) {
      applyRects(V.splitEven(sliceSrc.box, n));
      setAiStatus('已按 ' + n + ' 张均分，重新点小图选牌名。', 'ok');
    } else if (sliceSrc.cols && sliceSrc.cols.length) {
      applyRects(sliceSrc.cols);
      elLocalN.value = '';
      setAiStatus('已恢复自动切图：' + slices.length + ' 张。', 'ok');
    } else {
      setAiStatus('先在输入框填个张数，再点「重切」。', 'warn');
      return;
    }
    renderSlices();
  }

  function fillFromSlices() {
    var picked = [], i;
    for (i = 0; i < slices.length; i++) if (slices[i].tile !== null) picked.push(slices[i].tile);
    if (!picked.length) { rejectAdd('还没选牌，先点小图选牌名'); return; }
    var allowed = allowedTiles(rule());
    var kept = picked.filter(function (t) { return allowed.indexOf(t) >= 0; });
    snapshot();
    kept.forEach(function (t) {
      if (T.isFlower(t)) state.flowers.push(t);
      else state.hand.push(t);
    });
    haptic(16);
    renderAll();
    var msg = '已填入 ' + kept.length + ' 张';
    if (kept.length !== picked.length) msg += '，忽略 ' + (picked.length - kept.length) + ' 张本规则不认的牌';
    showToast(msg);
    clearSlices();
    setAiStatus('已填入手牌 ' + kept.length + ' 张，核对后看结果。', 'ok');
  }

  function setRecogMode(mode) {
    state.recog = mode;
    Array.prototype.slice.call(elRecogTabs.querySelectorAll('button')).forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-recog') === mode);
    });
    $('btnAiCfg').hidden = (mode === 'local');
    if (mode === 'local') {
      renderSlices();
      setAiStatus(slices.length ? '' : '本地切图：照片只在本机处理，不联网、不用配 Key。', '');
    } else {
      elLocalTools.hidden = true;
      setAiStatus(state.ai.apiKey ? '' : 'AI 识别要先点「识别设置」填接口地址和 Key。',
        state.ai.apiKey ? '' : 'warn');
    }
    save();
  }

  function initRecog() {
    Array.prototype.slice.call(elRecogTabs.querySelectorAll('button')).forEach(function (b) {
      b.addEventListener('click', function () { setRecogMode(b.getAttribute('data-recog')); });
    });
    $('btnReslice').addEventListener('click', reslice);
    $('btnLocalFill').addEventListener('click', fillFromSlices);
    elLocalN.addEventListener('keydown', function (e) { if (e.key === 'Enter') reslice(); });
    setRecogMode(state.recog || (state.ai.apiKey ? 'ai' : 'local'));
  }

  /* 装了 Service Worker 就能离线打开（file:// 和 WebView 里没有，跳过） */
  function initOffline() {
    if (!navigator.serviceWorker) return;
    if (location.protocol !== 'http:' && location.protocol !== 'https:') return;
    navigator.serviceWorker.register('sw.js').catch(function () {});
  }

  /* 供番种大全调用：把示例牌型原样填进界面 */
  function loadExample(ruleId, ex, label) {
    if (!R.byId[ruleId] || !ex || !ex.hand) return false;
    snapshot();
    state.ruleId = ruleId;
    state.hand = T.sortTiles(T.parse(ex.hand));
    state.melds = (ex.melds || []).map(function (m) { return { type: m.type, tile: T.fromCode(m.tile) }; });
    state.flowers = (ex.flowers || []).map(T.fromCode);
    state.dora = (ex.dora || []).map(T.fromCode);
    state.uraDora = (ex.uraDora || []).map(T.fromCode);
    state.winTile = ex.win ? T.fromCode(ex.win) : null;
    state.tsumo = !!ex.tsumo;
    state.flags = {};
    for (var k in (ex.flags || {})) state.flags[k] = ex.flags[k];
    state.seatWind = ex.seatWind || 0;
    state.roundWind = ex.roundWind || 0;
    state.ruleOpts = ex.opts ? JSON.parse(JSON.stringify(ex.opts)) : {};
    state.mode = 'hand';
    renderAll();
    setDockOpen(true);
    haptic(12);
    showToast('已把「' + (label || '示例') + '」填进牌面');
    return true;
  }

  function renderAll() {
    renderRuleTabs();
    renderHand();
    renderMelds();
    renderFlowers();
    renderDock();
    renderModeTabs();
    renderPalette();
    renderConditions();
    renderResult();
    pendingFlash = null;
    save();
  }

  function renderDock() {
    var r = rule();
    elDockHand.textContent = state.hand.length;
    elDockMeld.textContent = state.melds.length;
    elDockFlower.textContent = state.flowers.length;
    elDockFlowerStat.hidden = !(r.has && r.has.flowers);
  }

  function setupDialog() {
    var dlg = $('dlgAi');
    var sel = $('aiProvider');
    REC.PROVIDERS.forEach(function (p) {
      var o = document.createElement('option');
      o.value = p.id;
      o.textContent = p.name;
      sel.appendChild(o);
    });
    sel.value = state.ai.providerId || 'openai';
    sel.addEventListener('change', function () {
      var p = REC.PROVIDERS.filter(function (x) { return x.id === sel.value; })[0];
      if (p && p.baseUrl) {
        $('aiBaseUrl').value = p.baseUrl;
        $('aiModel').value = p.model;
      }
    });

    $('btnSettings').addEventListener('click', function () {
      $('aiBaseUrl').value = state.ai.baseUrl || '';
      $('aiModel').value = state.ai.model || '';
      $('aiKey').value = state.ai.apiKey || '';
      sel.value = state.ai.providerId || 'openai';
      dlg.showModal();
    });
    $('btnAiCfg').addEventListener('click', function () { $('btnSettings').click(); });

    dlg.addEventListener('close', function () {
      if (dlg.returnValue !== 'save') return;
      state.ai.providerId = sel.value;
      state.ai.baseUrl = $('aiBaseUrl').value.trim();
      state.ai.model = $('aiModel').value.trim();
      state.ai.apiKey = $('aiKey').value.trim();
      if ($('aiRemember').checked) save();
      setAiStatus('识别设置已保存。', 'ok');
    });
  }

  /* 当前算番结果的摘要，牌桌记分要拿它预填番数/符数 */
  function currentScore() {
    if (!state.hand.length) return null;
    var ctx = buildCtx();
    var res = rule().score(ctx);
    if (res.ok === false || res.total === undefined) return null;
    return {
      ruleId: state.ruleId,
      fan: res.total,
      fu: res.fu || 0,
      unit: res.unit || '番',
      tsumo: state.tsumo,
      points: res.points || null,
      text: (res.points && res.points.text) || ''
    };
  }

  function init() {
    load();
    $('showNumber').checked = state.showNumber;

    $('showNumber').addEventListener('change', function () {
      state.showNumber = $('showNumber').checked;
      save();
      renderAll();
    });

    $('btnUndo').addEventListener('click', undo);
    $('btnClear').addEventListener('click', function () {
      snapshot();
      state.hand = []; state.melds = []; state.flowers = [];
      state.winTile = null; state.dora = []; state.uraDora = [];
      state.flags = {}; state.tsumo = false;
      elPreview.innerHTML = '';
      clearSlices();
      setAiStatus('', '');
      renderAll();
      showToast('已清空');
    });

    $('fileInput').addEventListener('change', function (e) {
      if (e.target.files && e.target.files.length) handleFiles(e.target.files);
      e.target.value = '';
    });

    $('btnApplyNotation').addEventListener('click', applyNotation);
    $('notation').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') applyNotation();
    });

    setupDialog();
    initDock();
    initRecog();
    initOffline();
    renderAll();
  }

  globalThis.MJ = globalThis.MJ || {};
  globalThis.MJ.App = {
    loadExample: loadExample,
    currentRuleId: function () { return state.ruleId; },
    currentScore: currentScore
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
