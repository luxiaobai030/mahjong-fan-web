/* 番种大全页面：按规则列出全部番种，每条配说明和示例牌图 */
(function (global) {
  'use strict';
  var T = global.MJ.Tiles;
  var H = global.MJ.Hand;
  var Render = global.MJ.Render;
  var R = global.MJ.Rules;
  var G = global.MJ.Glossary;

  var FLAG_LABEL = {
    riichi: '立直',
    doubleRiichi: '两立直',
    ippatsu: '一发',
    rinshan: '杠后补摸',
    chankan: '抢杠',
    haitei: '海底牌',
    houtei: '河底牌',
    tenhou: '天和',
    chiihou: '地和',
    lastTile: '和绝张'
  };
  var MELD_LABEL = { chi: '吃', pon: '碰', kan: '杠', ankan: '暗杠' };

  var state = { ruleId: 'mcr', keyword: '' };
  var dlg = null;
  var tabsEl, listEl, searchEl, introEl, countEl;
  var scoreCache = {};

  function h(tag, cls, text) {
    var d = document.createElement(tag);
    if (cls) d.className = cls;
    if (text !== undefined && text !== null) d.textContent = text;
    return d;
  }
  function tileEl(t, win) {
    var d = h('span', 'g-tile' + (win ? ' is-win' : ''));
    d.innerHTML = Render.tileSVG(t, { showNumber: false });
    d.title = T.name(t);
    return d;
  }

  /* ---------- 示例牌型 ---------- */

  function exampleScore(ruleId, exId) {
    var key = ruleId + ':' + exId;
    if (scoreCache[key] !== undefined) return scoreCache[key];
    var rule = R.byId[ruleId];
    var ex = (G.data[ruleId].examples || {})[exId];
    var res = null;
    if (rule && ex && !ex.skip) {
      try {
        var ctx = H.buildContext({
          hand: T.parse(ex.hand),
          melds: (ex.melds || []).map(function (m) { return { type: m.type, tile: T.fromCode(m.tile) }; }),
          winTile: T.fromCode(ex.win),
          tsumo: !!ex.tsumo,
          seatWind: ex.seatWind || 0,
          roundWind: ex.roundWind || 0,
          flowers: (ex.flowers || []).map(T.fromCode),
          dora: (ex.dora || []).map(T.fromCode),
          uraDora: (ex.uraDora || []).map(T.fromCode),
          flags: ex.flags || {},
          options: R.optionsFor(rule, ex.opts || {})
        });
        var r = rule.score(ctx);
        if (r.ok !== false) res = r;
      } catch (e) { res = null; }
    }
    scoreCache[key] = res;
    return res;
  }

  function exampleBlock(ruleId, entry) {
    var ex = (G.data[ruleId].examples || {})[entry.ex];
    var wrap = h('div', 'g-ex');
    if (!ex) {
      wrap.appendChild(h('p', 'g-note', '（暂无示例）'));
      return wrap;
    }
    var win = T.fromCode(ex.win);

    if (ex.melds && ex.melds.length) {
      var meldRow = h('div', 'g-meld-row');
      ex.melds.forEach(function (m) {
        var g = h('span', 'g-meld');
        var tiles = m.type === 'chi' ? [T.fromCode(m.tile), T.fromCode(m.tile) + 1, T.fromCode(m.tile) + 2]
          : [T.fromCode(m.tile), T.fromCode(m.tile), T.fromCode(m.tile), T.fromCode(m.tile)];
        tiles.forEach(function (t) {
          var d = h('span', 'g-tile g-meld-tile');
          d.innerHTML = m.type === 'ankan' ? Render.backSVG() : Render.tileSVG(t, { showNumber: false });
          d.title = m.type === 'ankan' ? '暗杠' : T.name(t);
          g.appendChild(d);
        });
        g.appendChild(h('span', 'g-meld-tag', MELD_LABEL[m.type] || m.type));
        meldRow.appendChild(g);
      });
      wrap.appendChild(meldRow);
    }

    var handRow = h('div', 'g-hand-row');
    T.parse(ex.hand).forEach(function (t) { handRow.appendChild(tileEl(t, t === win)); });
    if (ex.flowers && ex.flowers.length) {
      handRow.appendChild(h('span', 'g-sep', '＋'));
      ex.flowers.forEach(function (f) { handRow.appendChild(tileEl(T.fromCode(f))); });
    }
    wrap.appendChild(handRow);

    var meta = h('div', 'g-meta');
    if (ex.melds && ex.melds.length) meta.appendChild(h('span', 'g-chip', ex.melds.length + ' 副副露'));
    meta.appendChild(h('span', 'g-chip is-win-chip', '胡牌张 ' + T.name(win)));
    if (ex.tsumo) meta.appendChild(h('span', 'g-chip', '自摸'));
    Object.keys(ex.flags || {}).forEach(function (k) {
      if (ex.flags[k] && FLAG_LABEL[k]) meta.appendChild(h('span', 'g-chip', FLAG_LABEL[k]));
    });
    if (ex.dora && ex.dora.length) meta.appendChild(h('span', 'g-chip', '宝牌指示牌 ' + ex.dora.map(function (c) { return T.name(T.fromCode(c)); }).join(' ')));
    if (ex.uraDora && ex.uraDora.length) meta.appendChild(h('span', 'g-chip', '里宝牌指示牌 ' + ex.uraDora.map(function (c) { return T.name(T.fromCode(c)); }).join(' ')));
    if (ex.seatWind) meta.appendChild(h('span', 'g-chip', '门风 ' + ['东', '南', '西', '北'][ex.seatWind]));
    if (ex.roundWind) meta.appendChild(h('span', 'g-chip', '圈风 ' + ['东', '南', '西', '北'][ex.roundWind]));
    wrap.appendChild(meta);

    if (ex.note) wrap.appendChild(h('p', 'g-note', '例：' + ex.note));

    var res = exampleScore(ruleId, entry.ex);
    if (res) {
      var line = h('p', 'g-result');
      line.appendChild(h('span', 'g-result-total', '这副示例共 ' + res.total + (res.unit || '番')));
      var parts = (res.fans || []).filter(function (f) { return !f.excluded; })
        .sort(function (a, b) { return b.value - a.value; })
        .map(function (f) { return f.name + ' ' + f.value; });
      if (parts.length > 6) parts = parts.slice(0, 6).concat(['…']);
      line.appendChild(h('span', 'g-result-list', '（' + (parts.join('、') || '无番型') + '）'));
      wrap.appendChild(line);
    }
    return wrap;
  }

  /* ---------- 列表 ---------- */

  function valueLabel(ruleId, f) {
    var data = G.data[ruleId];
    var override = data.groupLabels && data.groupLabels[String(f.value)];
    if (override) return override;
    return f.value + ' ' + (data.unit || '番');
  }

  function matches(entry, kw) {
    if (!kw) return true;
    var hay = [entry.name, entry.desc, entry.tip || ''].concat(entry.alts || []).join(' ').toLowerCase();
    return hay.indexOf(kw) >= 0;
  }

  function fanCard(ruleId, entry) {
    var card = h('article', 'fan-card');
    var head = h('div', 'fan-card-head');
    var val = h('span', 'fan-card-val');
    val.textContent = entry.variable ? (entry.valueText || '按数量') : String(entry.value);
    if (entry.variable) val.classList.add('is-variable');
    head.appendChild(val);
    var titleWrap = h('div', 'fan-card-title');
    titleWrap.appendChild(h('h3', null, entry.name));
    if (entry.variable) titleWrap.appendChild(h('span', 'fan-card-sub', entry.valueText || ''));
    else if (entry.valueText) titleWrap.appendChild(h('span', 'fan-card-sub', entry.valueText));
    head.appendChild(titleWrap);
    var btn = h('button', 'ghost-btn', '去算番');
    btn.type = 'button';
    btn.addEventListener('click', function () {
      var ex = (G.data[ruleId].examples || {})[entry.ex];
      if (ex && global.MJ.App && global.MJ.App.loadExample(ruleId, ex, entry.name)) {
        dlg.close();
        var target = document.querySelector('.result-card');
        if (target && target.scrollIntoView) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
    head.appendChild(btn);
    card.appendChild(head);
    if (entry.desc) card.appendChild(h('p', 'fan-card-desc', entry.desc));
    if (entry.tip) card.appendChild(h('p', 'fan-card-tip', '要点：' + entry.tip));
    card.appendChild(exampleBlock(ruleId, entry));
    return card;
  }

  function renderTabs() {
    tabsEl.innerHTML = '';
    R.list.forEach(function (r) {
      if (!G.data[r.id]) return;
      var b = h('button', 'rule-tab' + (r.id === state.ruleId ? ' active' : ''), r.short || r.name);
      b.type = 'button';
      b.addEventListener('click', function () {
        state.ruleId = r.id;
        state.keyword = '';
        searchEl.value = '';
        render();
      });
      tabsEl.appendChild(b);
    });
  }

  function render() {
    var data = G.data[state.ruleId];
    if (!data) return;
    renderTabs();
    introEl.textContent = data.intro || '';
    listEl.innerHTML = '';
    var kw = state.keyword.trim().toLowerCase();
    var fans = data.fans.filter(function (f) { return matches(f, kw); });
    var buckets = {}, order = [];
    fans.forEach(function (f) {
      var k = f.value;
      if (!buckets[k]) { buckets[k] = []; order.push(k); }
      buckets[k].push(f);
    });
    order.sort(function (a, b) { return b - a; });
    order.forEach(function (k) {
      var group = h('section', 'g-group');
      var gh = h('div', 'g-group-head');
      gh.appendChild(h('span', 'g-group-val', valueLabel(state.ruleId, buckets[k][0])));
      gh.appendChild(h('span', 'g-group-count', buckets[k].length + ' 个番种'));
      group.appendChild(gh);
      buckets[k].forEach(function (f) { group.appendChild(fanCard(state.ruleId, f)); });
      listEl.appendChild(group);
    });
    countEl.textContent = kw ? '匹配 ' + fans.length + ' / ' + data.fans.length + ' 个番种' : '共 ' + data.fans.length + ' 个番种';
    listEl.scrollTop = 0;
  }

  function build() {
    dlg = h('dialog', 'dlg glossary-dlg');
    var box = h('div', 'glossary-box');
    var head = h('div', 'glossary-head');
    var titleWrap = h('div', 'glossary-title');
    titleWrap.appendChild(h('h2', null, '番种大全'));
    countEl = h('p', 'glossary-count', '');
    titleWrap.appendChild(countEl);
    head.appendChild(titleWrap);
    var close = h('button', 'icon-btn', '✕');
    close.type = 'button';
    close.setAttribute('aria-label', '关闭');
    close.addEventListener('click', function () { dlg.close(); });
    head.appendChild(close);
    box.appendChild(head);

    tabsEl = h('div', 'rule-tabs glossary-tabs');
    box.appendChild(tabsEl);

    introEl = h('p', 'glossary-intro', '');
    box.appendChild(introEl);

    searchEl = h('input', 'glossary-search');
    searchEl.type = 'text';
    searchEl.placeholder = '搜索番种名称或说明，如「清一色」「门清」';
    searchEl.addEventListener('input', function () {
      state.keyword = searchEl.value;
      render();
    });
    box.appendChild(searchEl);

    listEl = h('div', 'glossary-list');
    box.appendChild(listEl);
    dlg.appendChild(box);
    document.body.appendChild(dlg);
  }

  function open(ruleId) {
    if (!dlg) build();
    state.ruleId = (ruleId && G.data[ruleId]) ? ruleId : state.ruleId;
    if (!G.data[state.ruleId]) state.ruleId = Object.keys(G.data)[0];
    render();
    if (!dlg.open) dlg.showModal();
    var body = listEl;
    if (body) body.scrollTop = 0;
  }

  function init() {
    var b1 = document.getElementById('btnGlossary');
    var b2 = document.getElementById('btnGlossary2');
    function bind(btn) {
      if (!btn) return;
      btn.addEventListener('click', function () {
        var cur = global.MJ.App && global.MJ.App.currentRuleId ? global.MJ.App.currentRuleId() : null;
        open(cur || state.ruleId);
      });
    }
    bind(b1);
    bind(b2);
  }

  global.MJ = global.MJ || {};
  global.MJ.GlossaryPage = { open: open, init: init };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})(typeof window !== 'undefined' ? window : globalThis);
