/* 牌桌：开房间、加入、一起记分，也能一台手机本机记分。
   在 App 外壳里（安卓 WebView / iOS WKWebView）走原生桥发请求，在浏览器里走 fetch ——
   App 里的页面来自 appassets / mjapp scheme，直接 fetch 局域网的 http 会被混合内容拦掉。 */
(function (global) {
  'use strict';
  var S = global.MJ.Score;
  var RC = global.MJ.RoomCore;
  var REC = global.MJ.Recognize;

  var CONFIG_KEY = 'mahjong-table-config-v1';
  var SESSION_KEY = 'mahjong-table-session-v1';
  var POLL_MS = 1500;

  var $ = function (id) { return document.getElementById(id); };
  var cfg = { server: '', name: '' };
  var session = null;
  var localRoom = null;
  var room = null;
  var mySeat = -1;
  var isLocal = false;
  var viaHost = false;
  var timer = null;
  var polling = false;
  var busy = 0;
  var pick = { winner: -1, tsumo: true, loser: -1 };
  var settingsBuilt = false;

  /* ---------------- 记在本地 ---------------- */

  function defaultServer() {
    if (/^https?:$/.test(location.protocol) && location.hostname !== 'appassets.androidplatform.net') {
      return location.origin;
    }
    return '';
  }

  function loadCfg() {
    try {
      var raw = localStorage.getItem(CONFIG_KEY);
      if (raw) {
        var d = JSON.parse(raw) || {};
        cfg.server = d.server || '';
        cfg.name = d.name || '';
      }
      var s = localStorage.getItem(SESSION_KEY);
      if (s) session = JSON.parse(s);
    } catch (e) { /* 隐私模式也不影响用 */ }
    if (!cfg.server) cfg.server = defaultServer();
  }

  function saveCfg() {
    try { localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg)); } catch (e) { /* 忽略 */ }
  }

  function saveSession() {
    try {
      if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
      else localStorage.removeItem(SESSION_KEY);
    } catch (e) { /* 忽略 */ }
  }

  /* ---------------- 跟服务器说话 ---------------- */

  function parse(text) {
    try { return JSON.parse(text); } catch (e) {
      return { ok: false, error: '服务器没回 JSON：' + String(text).slice(0, 80) };
    }
  }

  function api(payload, base) {
    /* 自己是主机：页面里的房间仓库就在本机，直接进，不绕一圈网络 */
    if (base === undefined && viaHost && global.MJ.Host) {
      return new Promise(function (resolve) {
        setTimeout(function () { resolve(global.MJ.Host.call(payload)); }, 0);
      });
    }
    var root = String(base === undefined ? cfg.server : base).replace(/\/+$/, '');
    if (!root) return Promise.reject(new Error('还没填服务器地址'));
    var body = JSON.stringify(payload);
    if (global.MJNative && typeof global.MJNative.post === 'function' &&
        REC && typeof REC.httpPost === 'function') {
      return REC.httpPost(root + '/api', { 'Content-Type': 'application/json' }, body)
        .then(function (res) { return parse(res.text); });
    }
    return fetch(root + '/api', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body
    }).then(function (res) { return res.text(); }).then(parse);
  }

  function call(payload) {
    var p = { code: session ? session.code : '', token: session ? session.token : '' };
    Object.keys(payload).forEach(function (k) { p[k] = payload[k]; });
    return api(p);
  }

  function hint(text, bad) {
    var el = $('tbHint');
    el.textContent = text || '';
    el.className = 'hint' + (bad ? ' is-bad' : '');
  }

  /* ---------------- 进出牌桌 ---------------- */

  function enterRoom(snapshot, seat, local) {
    busy++;
    room = snapshot;
    mySeat = seat;
    isLocal = !!local;
    settingsBuilt = false;
    $('tbLobby').hidden = true;
    $('tbRoom').hidden = false;
    $('tbCode').textContent = room.code ? '#' + room.code : '本机';
    $('tbMore').open = false;
    hint('');
    renderRoom();
    startPoll();
  }

  function backToLobby(msg) {
    busy++;
    stopPoll();
    room = null;
    $('tbLobby').hidden = false;
    $('tbRoom').hidden = true;
    $('tbCode').textContent = '';
    hint(msg || '', !!msg);
  }

  function startPoll() {
    stopPoll();
    if (isLocal) return;
    timer = setInterval(refresh, POLL_MS);
  }

  function stopPoll() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  function refresh() {
    if (!session || polling || document.hidden || !room) return;
    polling = true;
    var at = busy;
    api({ action: 'view', code: session.code, token: session.token }).then(function (res) {
      polling = false;
      if (at !== busy) return;
      if (res.ok) {
        room = res.room;
        mySeat = res.seat;
        renderRoom();
        return;
      }
      if (/不在这个房间|房间不存在/.test(res.error || '')) {
        session = null;
        saveSession();
        backToLobby(res.error + '，重新开一间或者加入别人的');
        return;
      }
      setWho(res.error, true);
    }).catch(function () {
      polling = false;
      if (at !== busy) return;
      setWho('连不上服务器，检查 WiFi 和地址', true);
    });
  }

  function doCreate() {
    viaHost = false;
    cfg.name = $('tbName').value.trim();
    cfg.server = $('tbServer').value.trim() || defaultServer();
    saveCfg();
    hint('正在开房…');
    var mode = global.MJ.App && global.MJ.App.currentRuleId() === 'riichi' ? 'riichi' : 'fan';
    api({ action: 'create', name: cfg.name, mode: mode }).then(function (res) {
      if (!res.ok) { hint(res.error || '开房失败', true); return; }
      session = { server: cfg.server, code: res.code, token: res.token };
      saveSession();
      enterRoom(res.room, res.seat, false);
    }).catch(function (e) { hint('连不上 ' + cfg.server + '：' + e.message, true); });
  }

  function doJoin() {
    viaHost = false;
    var code = $('tbJoinCode').value.trim();
    if (!/^\d{6}$/.test(code)) { hint('房间号是 6 位数字', true); return; }
    cfg.name = $('tbName').value.trim();
    var base = $('tbServer').value.trim() || defaultServer();
    cfg.server = base;
    saveCfg();
    hint('正在加入 ' + code + ' …');
    api({ action: 'join', code: code, name: cfg.name }, base).then(function (res) {
      if (!res.ok) { hint(res.error || '加入失败', true); return; }
      session = { server: base, code: res.code, token: res.token };
      saveSession();
      enterRoom(res.room, res.seat, false);
    }).catch(function (e) { hint('连不上 ' + base + '：' + e.message, true); });
  }

  function doTest() {
    var base = $('tbServer').value.trim() || defaultServer();
    if (!base) { hint('先填服务器地址，比如 http://192.168.1.5:8000', true); return; }
    hint('正在连 ' + base + ' …');
    api({ action: 'view', code: '', token: '' }, base).then(function (res) {
      hint(res.ok || /房间不存在/.test(res.error || '') ? '连上了：' + base : ('有响应但不对：' + res.error), !res.ok && !/房间不存在/.test(res.error || ''));
    }).catch(function (e) { hint('连不上：' + e.message, true); });
  }

  function doLocalTable() {
    viaHost = false;
    localRoom = RC.newRoom({});
    localRoom.local = true;
    var me = $('tbName').value.trim();
    localRoom.seats = ['东家', '南家', '西家', '北家'].map(function (n, i) {
      return { name: (i === 0 && me) ? me : n, lastSeen: Date.now() };
    });
    enterRoom(RC.view(localRoom, 0), 0, true);
  }

  /* ---------------- 手机当主机 ---------------- */

  function showHostBox() {
    var box = $('tbHostBox');
    var host = global.MJ.Host;
    var st = host.state;
    var ios = host.platform() === 'ios';
    var extra = ios ? ' iPhone 第一次会问「是否允许查找本地网络设备」，点允许。' : '';
    $('tbHostUrl').textContent = host.url() || '（没检测到地址）';
    $('tbHostTip').textContent = st.ips.length
      ? '先开「个人热点」（设置里搜一下就有），让他们连上你的热点，再用浏览器打开上面的地址 —— 不用装 App，输房间号就能一起记分。' + extra
      : '还没检测到热点地址：去设置里打开「个人热点」，然后点「复制地址」重新读一次。' + extra;
    box.hidden = false;
  }

  function doHost() {
    var host = global.MJ.Host;
    if (!host || !host.available()) {
      hint('只有当主机的那台手机装了 App 才能开；网页里开不了，这种情况让电脑跑 node tools/serve.js', true);
      return;
    }
    cfg.name = $('tbName').value.trim();
    saveCfg();
    hint('正在起服务器…');
    host.start().then(function (res) {
      if (!res.ok) { hint('起不来：' + res.error, true); return; }
      viaHost = true;
      cfg.server = res.url;
      saveCfg();
      showHostBox();
      hint('');
      /* iPhone 第一次碰本地网络会弹权限框，主动连一次自己既能把弹窗叫出来，也顺手验了地址通不通 */
      if (host.platform() === 'ios' && global.fetch) {
        fetch(res.url + '/api/info').catch(function () {
          hint('连不上自己的地址：去「设置 → 隐私与安全性 → 本地网络」里允许一下', true);
        });
      }
      var mode = global.MJ.App && global.MJ.App.currentRuleId() === 'riichi' ? 'riichi' : 'fan';
      api({ action: 'create', name: cfg.name, mode: mode }).then(function (r) {
        if (!r.ok) { hint(r.error || '开房失败', true); return; }
        session = { code: r.code, token: r.token };
        saveSession();
        enterRoom(r.room, r.seat, false);
        toast('房间开好了：' + r.code);
      });
    });
  }

  function stopHost() {
    if (!global.MJ.Host.state.on) return;
    if (!confirm('停掉主机？别人就连不上了，这桌的分数还在你手机上。')) return;
    global.MJ.Host.stop().then(function () {
      $('tbHostBox').hidden = true;
      toast('已停止当主机');
    });
  }

  function copyHostUrl() {
    global.MJ.Host.refresh().then(function () {
      var host = global.MJ.Host;
      var text = host.url() + (room && room.code ? '  房间号 ' + room.code : '');
      $('tbHostUrl').textContent = host.url();
      copyText(text, function (ok) { toast(ok ? '地址已复制，发给他们' : '复制失败，长按选中吧'); });
    });
  }

  function leaveRoom() {
    var done = function () {
      session = null;
      saveSession();
      localRoom = null;
      backToLobby('已退出牌桌');
    };
    if (isLocal || !session) { done(); return; }
    call({ action: 'leave' }).then(done, done);
  }

  /* ---------------- 发动作 ---------------- */

  function send(payload, okMsg) {
    if (!payload.action) payload.action = 'settle';
    if (isLocal) {
      var out = RC.apply(localRoom, mySeat, payload);
      if (!out.ok) { hint(out.error, true); return false; }
      room = RC.view(localRoom, mySeat);
      renderRoom();
      if (okMsg) toast(okMsg);
      return true;
    }
    call(payload).then(function (res) {
      if (!res.ok) { hint(res.error || '没记上', true); return; }
      hint('');
      room = res.room;
      mySeat = res.seat;
      renderRoom();
      if (okMsg) toast(okMsg);
    }).catch(function (e) { hint('没发出去：' + e.message, true); });
    return true;
  }

  function collect() {
    return {
      winner: pick.winner,
      loser: pick.tsumo ? null : pick.loser,
      fan: $('tbFan').value,
      fu: $('tbFu').value,
      amount: $('tbAmount').value
    };
  }

  function doWin() {
    var input = collect();
    if (!send(input, '记上了')) return;
    $('tbAmount').value = '';
    pick.winner = -1;
    pick.tsumo = true;
    pick.loser = -1;
    renderPickers();
    renderPreview();
  }

  /* ---------------- 画面 ---------------- */

  function toast(text) {
    var el = $('toast');
    el.textContent = text;
    el.className = 'toast is-on';
    clearTimeout(toast.timer);
    toast.timer = setTimeout(function () { el.className = 'toast'; }, 1400);
  }

  function setWho(text, bad) {
    var el = $('tbWho');
    el.textContent = text || '';
    el.className = 'hint' + (bad ? ' is-bad' : '');
  }

  function lastDeltas() {
    if (!room || !room.log.length) return null;
    var last = room.log[room.log.length - 1];
    return last.kind === 'win' ? last.deltas : null;
  }

  function renderRoom() {
    if (!room) return;
    var st = room.settings;
    $('tbRound').textContent = RC.roundLabel(room.table);
    $('tbPot').hidden = !room.table.sticks;
    $('tbPot').textContent = '供托 ' + (room.table.sticks * 1000);
    /* 当主机的时候，地址要一直看得见：别人问「连哪个地址」全靠它 */
    var hostPill = $('tbHostPill');
    hostPill.hidden = !(global.MJ.Host && global.MJ.Host.state.on);
    if (!hostPill.hidden) {
      hostPill.textContent = global.MJ.Host.url().replace(/^http:\/\//, '') + ' · 点一下复制';
    }
    setWho(isLocal ? '本机记分（没连服务器）'
      : (st.mode === 'riichi' ? '日麻点数 · 番 + 符' : st.unit + ' × 底分 ' + st.perFan));
    $('tbFu').hidden = st.mode !== 'riichi';
    renderSeats();
    renderPickers();
    renderLog();
    renderPreview();
    renderSettingsOnce();
  }

  function renderSeats() {
    var box = $('tbSeats');
    box.innerHTML = '';
    var deltas = lastDeltas();
    for (var i = 0; i < 4; i++) {
      var s = room.seats[i];
      var row = document.createElement('button');
      row.type = 'button';
      row.className = 'seat' + (i === mySeat ? ' is-me' : '') +
        (i === room.table.dealer ? ' is-dealer' : '') + (s ? '' : ' is-empty');
      row.dataset.seat = String(i);
      var wind = document.createElement('b');
      wind.className = 'seat-wind';
      wind.textContent = S.windOf(i, room.table.dealer);
      var name = document.createElement('span');
      name.className = 'seat-name';
      name.textContent = s ? s.name : '空位';
      var dot = document.createElement('i');
      dot.className = 'seat-dot' + (s && s.online ? ' is-on' : '');
      var score = document.createElement('span');
      score.className = 'seat-score' + (room.scores[i] > 0 ? ' is-up' : (room.scores[i] < 0 ? ' is-down' : ''));
      score.textContent = room.scores[i] > 0 ? '+' + room.scores[i] : String(room.scores[i]);
      row.appendChild(wind);
      row.appendChild(name);
      row.appendChild(dot);
      row.appendChild(score);
      if (deltas) {
        var dd = document.createElement('span');
        dd.className = 'seat-delta' + (deltas[i] > 0 ? ' is-up' : (deltas[i] < 0 ? ' is-down' : ''));
        dd.textContent = deltas[i] > 0 ? '+' + deltas[i] : (deltas[i] < 0 ? String(deltas[i]) : '—');
        row.appendChild(dd);
      }
      row.addEventListener('click', onSeatClick);
      box.appendChild(row);
    }
  }

  function onSeatClick(e) {
    var i = Number(e.currentTarget.dataset.seat);
    var s = room.seats[i];
    if (!s) {
      if (isLocal || i === mySeat) return;
      hint('座位按加入顺序排，点「加入房间」就能坐上');
      return;
    }
    if (!isLocal && i !== mySeat) return;
    var v = prompt('改成什么名字？', s.name);
    if (v === null) return;
    var name = v.trim().slice(0, 8);
    if (!name || name === s.name) return;
    if (isLocal) {
      s.name = name;
      room = RC.view(localRoom, mySeat);
      renderSeats();
      return;
    }
    send({ action: 'name', name: name });
  }

  function segButton(text, on, onClick) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = on ? 'active' : '';
    b.textContent = text;
    b.addEventListener('click', onClick);
    return b;
  }

  function seatLabel(i) {
    var s = room.seats[i];
    return S.windOf(i, room.table.dealer) + ' ' + (s ? s.name : '空位');
  }

  function renderPickers() {
    if (!room) return;
    var win = $('tbWinner');
    win.innerHTML = '';
    for (var i = 0; i < 4; i++) {
      win.appendChild(segButton(seatLabel(i), pick.winner === i, (function (n) {
        return function () {
          pick.winner = n;
          if (pick.loser === n) pick.loser = -1;
          renderPickers();
          renderPreview();
        };
      })(i)));
    }
    var lose = $('tbLoser');
    lose.innerHTML = '';
    lose.appendChild(segButton('自摸', pick.tsumo, function () {
      pick.tsumo = true;
      pick.loser = -1;
      renderPickers();
      renderPreview();
    }));
    if (pick.winner >= 0) {
      for (var j = 0; j < 4; j++) {
        if (j === pick.winner) continue;
        lose.appendChild(segButton('放铳 ' + seatLabel(j), !pick.tsumo && pick.loser === j, (function (n) {
          return function () {
            pick.tsumo = false;
            pick.loser = n;
            renderPickers();
            renderPreview();
          };
        })(j)));
      }
    }
  }

  function renderPreview() {
    var box = $('tbPreview');
    box.innerHTML = '';
    if (!room) return;
    if (pick.winner < 0) {
      box.className = 'points-preview is-hint';
      box.textContent = '先选谁和牌，这里会先把谁给谁多少算一遍，确认了再记。';
      return;
    }
    var out = RC.preview(room, collect());
    if (!out.ok) {
      box.className = 'points-preview is-hint';
      box.textContent = out.error;
      return;
    }
    box.className = 'points-preview';
    var head = document.createElement('div');
    head.className = 'pp-head';
    head.textContent = out.text;
    box.appendChild(head);
    var grid = document.createElement('div');
    grid.className = 'pp-grid';
    for (var i = 0; i < 4; i++) {
      if (!out.deltas[i]) continue;
      var cell = document.createElement('span');
      cell.className = 'pp-cell ' + (out.deltas[i] > 0 ? 'is-up' : 'is-down');
      cell.textContent = seatLabel(i) + ' ' + (out.deltas[i] > 0 ? '+' : '') + out.deltas[i];
      grid.appendChild(cell);
    }
    box.appendChild(grid);
  }

  function renderLog() {
    var box = $('tbLog');
    box.innerHTML = '';
    if (!room.log.length) {
      var p = document.createElement('p');
      p.className = 'empty-tip';
      p.textContent = '还没有记录，打一局记一条。';
      box.appendChild(p);
      return;
    }
    room.log.slice(-20).reverse().forEach(function (e, idx) {
      var row = document.createElement('div');
      row.className = 'log-row' + (idx === 0 ? ' is-last' : '');
      var t = document.createElement('span');
      t.className = 'log-text';
      t.textContent = e.label;
      var d = document.createElement('span');
      d.className = 'log-delta';
      var plus = 0;
      for (var i = 0; i < 4; i++) if (e.deltas[i] > 0) plus += e.deltas[i];
      d.textContent = e.kind === 'win' ? '+' + plus : '';
      row.appendChild(t);
      row.appendChild(d);
      if (idx === 0) {
        row.title = '点一下撤销这一局';
        row.addEventListener('click', function () {
          if (confirm('撤销「' + e.label + '」？')) send({ action: 'undo' }, '撤销了');
        });
      }
      box.appendChild(row);
    });
  }

  /* 设置面板只搭一次，之后不再重建，免得输入到一半被刷掉 */
  function renderSettingsOnce() {
    if (settingsBuilt || !room) return;
    settingsBuilt = true;
    var box = $('tbSettings');
    box.innerHTML = '';
    var st = room.settings;

    function group(label) {
      var g = document.createElement('div');
      g.className = 'cond-group';
      var l = document.createElement('span');
      l.className = 'label';
      l.textContent = label;
      var seg = document.createElement('div');
      seg.className = 'seg';
      g.appendChild(l);
      g.appendChild(seg);
      box.appendChild(g);
      return seg;
    }
    function num(label, key, value, step) {
      var seg = group(label);
      var input = document.createElement('input');
      input.className = 'num-input';
      input.type = 'number';
      input.step = step || '1';
      input.value = value;
      input.addEventListener('change', function () {
        var p = { action: 'settings' };
        p[key] = input.value;
        send(p);
      });
      seg.appendChild(input);
      return seg;
    }
    function pickOne(label, key, value, opts, after) {
      var seg = group(label);
      opts.forEach(function (o) {
        seg.appendChild(segButton(o[1], value === o[0], function () {
          var p = { action: 'settings' };
          p[key] = o[0];
          send(p);
          if (after) after();
        }));
      });
      return seg;
    }

    pickOne('记分方式', 'mode', st.mode, [[ 'fan', '番/台 × 底分' ], [ 'riichi', '日麻点数' ]], function () {
      settingsBuilt = false;
    });
    num('每番/台多少分', 'perFan', st.perFan, '1');
    num('底（固定分）', 'flat', st.flat, '1');
    num('起分', 'start', st.start, '1000');
    pickOne('自摸', 'tsumoDouble', st.tsumoDouble, [[false, '不加倍'], [true, '翻倍']]);
    pickOne('自摸怎么付', 'split', st.split, [['all', '三家各付'], ['average', '三家平摊']]);
    pickOne('单位', 'unit', st.unit, [['番', '番'], ['台', '台']]);

    var seatRow = group('谁做庄');
    for (var i = 0; i < 4; i++) {
      seatRow.appendChild(segButton(S.windOf(i, room.table.dealer), room.table.dealer === i, (function (n) {
        return function () {
          send({ action: 'table', dealer: n });
          settingsBuilt = false;
        };
      })(i)));
    }
    var windRow = group('场风');
    S.WINDS.forEach(function (w) {
      windRow.appendChild(segButton(w, room.table.wind === w, function () {
        send({ action: 'table', wind: w });
        settingsBuilt = false;
      }));
    });
  }

  function copyRecord() {
    if (!room) return;
    copyText(recordText(), function (ok) {
      toast(ok ? '战绩已复制' : '复制失败，长按选中吧');
    });
  }

  function recordText() {
    var lines = ['麻将算番 · 牌桌 ' + (room.code ? '#' + room.code : '（本机）') + '  ' + RC.roundLabel(room.table), ''];
    for (var i = 0; i < 4; i++) {
      var s = room.seats[i];
      lines.push(S.windOf(i, room.table.dealer) + ' ' + (s ? s.name : '空位') + '  ' +
        (room.scores[i] > 0 ? '+' : '') + room.scores[i]);
    }
    lines.push('');
    room.log.forEach(function (e) { lines.push(e.label); });
    return lines.join('\n');
  }

  function copyText(text, done) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(false); });
      return;
    }
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    document.body.removeChild(ta);
    done(ok);
  }

  /* 把算番结果带进来：番数和符数 */
  function prefillFromScore() {
    var label = $('tbNeed');
    var cur = global.MJ.App && global.MJ.App.currentScore ? global.MJ.App.currentScore() : null;
    if (!cur) {
      label.textContent = '选谁和牌';
      return;
    }
    label.textContent = '已代入算番结果：' + cur.fan + cur.unit + (cur.fu ? ' ' + cur.fu + ' 符' : '');
    if (!$('tbFan').value) $('tbFan').value = cur.fan;
    if (cur.fu && !$('tbFu').value) $('tbFu').value = cur.fu;
  }

  function open() {
    var dlg = $('dlgTable');
    $('tbName').value = cfg.name || '';
    $('tbServer').value = cfg.server || defaultServer();
    $('tbJoinCode').value = '';
    prefillFromScore();
    if (global.MJ.Host && global.MJ.Host.state.on) showHostBox();
    if (isLocal && localRoom) {
      room = RC.view(localRoom, mySeat);
      renderRoom();
      startPoll();
    } else if (session) {
      var at = busy;
      $('tbLobby').hidden = true;
      $('tbRoom').hidden = false;
      setWho('正在连回房间…');
      api({ action: 'view', code: session.code, token: session.token }).then(function (res) {
        if (at !== busy) return;
        if (!res.ok) {
          session = null;
          saveSession();
          backToLobby(res.error || '房间没了');
          return;
        }
        enterRoom(res.room, res.seat, false);
      }).catch(function () {
        if (at !== busy) return;
        backToLobby('连不上 ' + (session ? session.server : '') + '，检查 WiFi 和地址');
      });
    } else {
      $('tbLobby').hidden = false;
      $('tbRoom').hidden = true;
      $('tbCode').textContent = '';
      hint('');
    }
    if (!dlg.open) dlg.showModal();
  }

  function init() {
    loadCfg();
    var dlg = $('dlgTable');
    $('btnTable').addEventListener('click', open);
    $('tbCreate').addEventListener('click', doCreate);
    $('tbJoin').addEventListener('click', doJoin);
    $('tbTest').addEventListener('click', doTest);
    $('tbLocal').addEventListener('click', doLocalTable);
    $('tbHost').addEventListener('click', doHost);
    $('tbHostPill').addEventListener('click', copyHostUrl);
    $('tbHostCopy').addEventListener('click', copyHostUrl);
    $('tbHostStop').addEventListener('click', stopHost);
    /* 网页版当不了主机（浏览器开不了监听端口），这个按钮就别摆了 */
    if (!global.MJ.Host || !global.MJ.Host.available()) $('tbHost').hidden = true;
    $('tbJoinCode').addEventListener('keydown', function (e) { if (e.key === 'Enter') doJoin(); });
    $('tbClose').addEventListener('click', function () { dlg.close(); });
    $('tbLeave').addEventListener('click', function () {
      if (confirm('退出牌桌？别人还记着这一局，你随时可以再加回来。')) leaveRoom();
    });
    $('tbReset').addEventListener('click', function () {
      if (confirm('清空战绩和流水？分数会回到起分。')) send({ action: 'reset' }, '已清空');
    });
    $('tbCopy').addEventListener('click', copyRecord);
    $('tbDraw').addEventListener('click', function () { send({ action: 'draw' }, '记了流局'); });
    $('tbRiichi').addEventListener('click', function () { send({ action: 'riichi' }, '记了立直棒'); });
    $('tbWin').addEventListener('click', doWin);
    ['tbFan', 'tbFu', 'tbAmount'].forEach(function (id) {
      $(id).addEventListener('input', renderPreview);
    });
    dlg.addEventListener('close', stopPoll);
    dlg.addEventListener('cancel', stopPoll);
    global.addEventListener('online', function () { if (room && !isLocal) refresh(); });
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden && room && !isLocal) refresh();
    });
  }

  global.MJ = global.MJ || {};
  global.MJ.Table = {
    open: open,
    current: function () { return room; }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})(typeof window !== 'undefined' ? window : globalThis);
