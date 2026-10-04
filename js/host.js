/* 手机当主机：这台设备自己起一个小 HTTP 服务器，别人连你的热点、用浏览器打开地址就能加入。
   记账逻辑还是 server/rooms.js + js/room-core.js（和电脑上跑的是同一份），
   这里只做两件事：
     1. 把外面进来的 /api 请求喂给 Rooms.call，返回值就是响应
     2. 本机页面自己的请求直接进 Rooms.call，不绕一圈网络
   监听端口、发静态文件是原生那边的事（Android 的 RoomServer.java），它收到请求后
   evaluateJavascript 调 MJ.Host.handle(请求体)。没有原生壳（网页版、iOS）时 available() 为假，
   界面会把「我当主机」收起来。 */
(function (global) {
  'use strict';
  var Rooms = global.MJ.Rooms;
  var native = global.MJNative;
  var DEFAULT_PORT = 8787;
  var seq = 0;
  var waiting = {};

  var state = { on: false, port: 0, ips: [], error: '' };

  function available() {
    return !!(native && typeof native.startServer === 'function' && Rooms);
  }

  /* iOS 的新壳把平台写成属性，安卓的老壳是个方法，两种都认 */
  function platform() {
    if (!native) return '';
    return typeof native.platform === 'function' ? String(native.platform()) : String(native.platform || '');
  }

  function url(ip, port) {
    return 'http://' + (ip || '127.0.0.1') + ':' + (port || DEFAULT_PORT);
  }

  /* 原生回来找这个函数：window.__mjNativeServer(id, {ok, port, ips}) */
  global.__mjNativeServer = function (id, res) {
    var fn = waiting[id];
    if (!fn) return;
    delete waiting[id];
    if (typeof res === 'string') {
      try { res = JSON.parse(res); } catch (e) { res = { ok: false, error: '原生返回看不懂' }; }
    }
    fn(res || { ok: false, error: '原生没返回' });
  };

  function ask(what, port) {
    return new Promise(function (resolve) {
      if (!available()) { resolve({ ok: false, error: '只有 App 里的牌桌能当主机' }); return; }
      var id = 'hs' + (++seq);
      waiting[id] = resolve;
      try {
        if (what === 'stop') native.stopServer(id);
        else if (what === 'info') native.serverInfo(id);
        else native.startServer(id, port || DEFAULT_PORT);
      } catch (e) {
        delete waiting[id];
        resolve({ ok: false, error: String(e && e.message ? e.message : e) });
      }
    });
  }

  function start(port) {
    return ask('start', port).then(function (res) {
      if (!res.ok) { state.error = res.error || '服务器起不来'; return res; }
      state.on = true;
      state.port = res.port;
      state.ips = res.ips || [];
      state.error = '';
      res.url = url(state.ips[0], state.port);
      return res;
    });
  }

  function stop() {
    return ask('stop').then(function () {
      state.on = false;
      state.port = 0;
      state.ips = [];
      return { ok: true };
    });
  }

  /* 热点开了关了 IP 会变，重新问一次原生 */
  function refresh() {
    if (!state.on) return Promise.resolve(state);
    return ask('info').then(function (res) {
      if (res && res.ok) {
        state.port = res.port || state.port;
        state.ips = res.ips || state.ips;
      }
      return state;
    });
  }

  /* 外面进来的请求 */
  function handle(body) {
    var input;
    try { input = JSON.parse(body); } catch (e) { return JSON.stringify({ ok: false, error: '请求不是 JSON' }); }
    try {
      return JSON.stringify(Rooms.call(input));
    } catch (e) {
      return JSON.stringify({ ok: false, error: '处理出错：' + (e && e.message ? e.message : e) });
    }
  }

  /* 本机页面自己用 */
  function call(payload) { return Rooms.call(payload); }

  global.MJ.Host = {
    DEFAULT_PORT: DEFAULT_PORT,
    available: available,
    platform: platform,
    start: start,
    stop: stop,
    refresh: refresh,
    handle: handle,
    call: call,
    state: state,
    url: function () { return url(state.ips[0], state.port); }
  };
})(typeof window !== 'undefined' ? window : globalThis);
