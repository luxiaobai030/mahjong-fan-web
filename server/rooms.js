/* 牌桌房间的服务端：代号、座位、令牌、持久化。
   真正的记账逻辑在 js/room-core.js（和网页共用一份），这里只管「谁是谁」。
   同一份代码三种跑法：
     - 电脑上 node tools/serve.js       -> 房间存临时文件
     - 手机 App 里当主机（js/host.js）  -> 房间存 localStorage
     - test/lan.test.js 直接调           -> 房间存临时文件
   浏览器里没有 require，所以模块自己认环境。 */
(function (global) {
  'use strict';

  var isNode = typeof module !== 'undefined' && !!module.exports && typeof require === 'function';
  var NodeFs = null, NodeOs = null, NodePath = null, NodeCrypto = null;
  var RoomCore = null;

  if (isNode) {
    NodeFs = require('fs');
    NodeOs = require('os');
    NodePath = require('path');
    NodeCrypto = require('crypto');
    require('../js/score.js');          /* room-core.js 依赖 MJ.Score，必须先加载 */
    RoomCore = require('../js/room-core.js');
  } else {
    RoomCore = global.MJ && global.MJ.RoomCore;
  }

  var ONLINE_MS = 8000;
  var IDLE_MS = 8 * 3600 * 1000;
  var STORAGE_KEY = 'mahjong-rooms-v1';
  var DATA_FILE = isNode
    ? (process.env.MJ_ROOM_DATA || NodePath.join(NodeOs.tmpdir(), 'mahjong-rooms.json'))
    : '';

  var rooms = Object.create(null);

  function now() { return Date.now(); }
  function fail(msg) { return { ok: false, error: msg }; }

  /* ---------------- 存哪儿 ---------------- */

  function readRaw() {
    if (NodeFs) { try { return NodeFs.readFileSync(DATA_FILE, 'utf8'); } catch (e) { return ''; } }
    if (global.localStorage) { try { return global.localStorage.getItem(STORAGE_KEY) || ''; } catch (e) { return ''; } }
    return '';
  }

  function writeRaw(text) {
    if (NodeFs) { try { NodeFs.writeFileSync(DATA_FILE, text); } catch (e) { /* 写不进就算了 */ } return; }
    if (global.localStorage) { try { global.localStorage.setItem(STORAGE_KEY, text); } catch (e) { /* 满了也不影响用 */ } }
  }

  function load() {
    try {
      var data = JSON.parse(readRaw() || 'null');
      Object.keys(data || {}).forEach(function (code) {
        var r = data[code];
        if (r && r.code && r.seats && r.seats.length === 4 && r.settings && r.table) rooms[code] = r;
      });
    } catch (e) { /* 第一次跑没有存档，正常 */ }
  }

  var saveTimer = null;
  function save() {
    if (saveTimer) return;
    saveTimer = setTimeout(function () {
      saveTimer = null;
      writeRaw(JSON.stringify(rooms));
    }, 200);
    if (saveTimer.unref) saveTimer.unref();
  }

  /* ---------------- 房间 ---------------- */

  function newCode() {
    for (var i = 0; i < 200; i++) {
      var code = String(Math.floor(100000 + Math.random() * 900000));
      if (!rooms[code]) return code;
    }
    return String(now()).slice(-6);
  }

  function newToken() {
    if (NodeCrypto) return NodeCrypto.randomBytes(12).toString('hex');
    var out = '';
    if (global.crypto && global.crypto.getRandomValues) {
      var buf = new Uint8Array(12);
      global.crypto.getRandomValues(buf);
      for (var i = 0; i < buf.length; i++) out += (buf[i] + 256).toString(16).slice(1);
      return out;
    }
    for (var j = 0; j < 24; j++) out += Math.floor(Math.random() * 16).toString(16);
    return out;
  }

  function cleanName(name, fallback) {
    var s = String(name === undefined || name === null ? '' : name).trim().slice(0, 8);
    return s || fallback;
  }

  /* 超过 8 小时没人动的房间清掉 */
  function sweep() {
    var t = now();
    Object.keys(rooms).forEach(function (code) {
      if (t - (rooms[code].updatedAt || 0) > IDLE_MS) delete rooms[code];
    });
  }

  function seatOf(room, token) {
    for (var i = 0; i < 4; i++) {
      if (room.seats[i] && room.seats[i].token === token) return i;
    }
    return -1;
  }

  function touch(room, seat) {
    room.rev = (room.rev || 0) + 1;
    room.updatedAt = now();
    if (seat >= 0 && room.seats[seat]) room.seats[seat].lastSeen = now();
    save();
  }

  function create(input) {
    sweep();
    var code = newCode();
    var token = newToken();
    var mode = input.mode === 'riichi' ? 'riichi' : 'fan';
    var room = RoomCore.newRoom({
      mode: mode,
      start: mode === 'riichi' ? 25000 : 0,
      perFan: input.perFan === undefined ? 5 : Number(input.perFan),
      unit: input.unit || '番'
    });
    room.code = code;
    room.createdAt = now();
    room.updatedAt = now();
    room.seats[0] = { name: cleanName(input.name, '房主'), token: token, lastSeen: now() };
    rooms[code] = room;
    save();
    return { ok: true, code: code, token: token, seat: 0, room: RoomCore.view(room, 0) };
  }

  function join(input) {
    var room = rooms[String(input.code || '').trim()];
    if (!room) return fail('没有这个房间号，确认一下是不是输错了');
    var seat = room.seats.indexOf(null);
    if (seat < 0) return fail('这桌已经坐满了');
    var token = newToken();
    room.seats[seat] = { name: cleanName(input.name, '玩家' + (seat + 1)), token: token, lastSeen: now() };
    touch(room, seat);
    return { ok: true, code: room.code, token: token, seat: seat, room: RoomCore.view(room, seat) };
  }

  function leave(room, seat) {
    room.seats[seat] = null;
    if (room.host === seat) room.host = room.seats.findIndex(function (s) { return !!s; });
    touch(room, -1);
    return { ok: true, room: RoomCore.view(room, -1) };
  }

  /* 一个入口：页面只发 {action, code, token, ...} 这一种请求 */
  function call(input) {
    input = input || {};
    var action = input.action;
    if (action === 'create') return create(input);
    var room = rooms[String(input.code || '').trim()];
    if (!room) return fail('房间不存在（服务器可能重启过，或者房主退出了）');
    var seat = seatOf(room, input.token);
    if (action === 'join') {
      if (seat >= 0) return { ok: true, seat: seat, room: RoomCore.view(room, seat) };
      return join(input);
    }
    if (seat < 0) return fail('你已经不在这个房间里了，重新加入一下');
    if (action === 'view') {
      touch(room, seat);
      return { ok: true, seat: seat, room: RoomCore.view(room, seat) };
    }
    if (action === 'leave') return leave(room, seat);
    var out = RoomCore.apply(room, seat, input);
    if (!out.ok) return out;
    touch(room, seat);
    return { ok: true, seat: seat, room: RoomCore.view(room, seat) };
  }

  var api = {
    call: call,
    rooms: rooms,
    dataFile: DATA_FILE,
    onlineMs: ONLINE_MS,
    _mode: NodeFs ? 'file' : (global.localStorage ? 'local' : 'memory'),
    _reset: function () { Object.keys(rooms).forEach(function (c) { delete rooms[c]; }); },
    _load: load
  };

  global.MJ = global.MJ || {};
  global.MJ.Rooms = api;
  if (isNode) module.exports = api;
  load();
})(typeof window !== 'undefined' ? window : globalThis);
