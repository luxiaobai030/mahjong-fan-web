/* 牌桌的状态机：一局怎么记、分怎么变、局数怎么走。
   浏览器（本机记分 / 连服务器）和 Node（server/rooms.js）共用这一份，
   所以「手机自己记」和「连服务器记」算出来的结果一定一样。
   这里不碰网络、不碰存储，只认一个房间对象。 */
(function (global) {
  'use strict';
  var Score = global.MJ.Score;

  var MAX_LOG = 60;

  function newRoom(settings) {
    var st = {
      mode: 'fan', perFan: 5, flat: 0, tsumoDouble: false, split: 'all', start: 0, unit: '番'
    };
    Object.keys(settings || {}).forEach(function (k) { st[k] = settings[k]; });
    var room = {
      rev: 1,
      host: 0,
      seats: [null, null, null, null],
      settings: st,
      table: { dealer: 0, wind: '东', hand: 1, honba: 0, sticks: 0 },
      scores: [st.start, st.start, st.start, st.start],
      log: []
    };
    return room;
  }

  function fail(msg) { return { ok: false, error: msg }; }

  function seatName(room, seat) {
    var s = room.seats[seat];
    return (s && s.name) || ('玩家' + (seat + 1));
  }

  function roundLabel(table) {
    return table.wind + table.hand + '局' + (table.honba ? ' ' + table.honba + '本场' : '');
  }

  /* 给页面看的快照：别人的身份信息不外发 */
  function view(room, seat, t) {
    t = t || Date.now();
    return {
      code: room.code || '',
      local: !!room.local,
      rev: room.rev,
      host: room.host,
      settings: room.settings,
      table: room.table,
      scores: room.scores,
      seats: room.seats.map(function (s, i) {
        if (!s) return null;
        return { name: s.name, online: room.local ? true : (t - (s.lastSeen || 0) < 8000), me: i === seat };
      }),
      log: room.log.map(function (e) {
        return { seq: e.seq, kind: e.kind, label: e.label, text: e.text, deltas: e.deltas, at: e.at, by: e.by };
      })
    };
  }

  function snapshot(room) {
    return {
      table: {
        dealer: room.table.dealer, wind: room.table.wind, hand: room.table.hand,
        honba: room.table.honba, sticks: room.table.sticks
      },
      scores: room.scores.slice()
    };
  }

  function pushLog(room, entry, seat) {
    entry.seq = (room.log.length ? room.log[room.log.length - 1].seq : 0) + 1;
    entry.at = Date.now();
    entry.by = seat;
    entry.before = snapshot(room);
    room.log.push(entry);
    if (room.log.length > MAX_LOG) room.log.shift();
  }

  function nextWind(w) {
    var i = Score.WINDS.indexOf(w);
    return Score.WINDS[(i + 1) % Score.WINDS.length];
  }

  function advanceHand(table) {
    table.hand++;
    if (table.hand > 4) { table.hand = 1; table.wind = nextWind(table.wind); }
  }

  /* 和牌：winner 和牌者座位；loser 放铳者座位，自摸传 null
     fan 番数、fu 符（日麻）、amount 直接点数（填了就用它） */
  /* 只算不改：界面拿它做「先看看谁给谁多少」的预览，settle 也走同一份逻辑 */
  function compute(room, input) {
    var winner = Number(input.winner);
    if (!(winner >= 0 && winner < 4)) return fail('选一下谁和牌');
    var tsumo = input.loser === null || input.loser === undefined || input.loser === '';
    var loser = tsumo ? null : Number(input.loser);
    if (!tsumo && (!(loser >= 0 && loser < 4) || loser === winner)) return fail('放铳的人不对');
    var st = room.settings;
    var result;
    if (input.amount) {
      result = Score.pointsSettle({ winner: winner, loser: loser, amount: Number(input.amount) });
    } else if (st.mode === 'riichi') {
      var fan = Number(input.fan) || 0;
      if (fan <= 0) return fail('填一下番数');
      result = Score.riichiSettle({
        fan: fan, fu: Number(input.fu) || 30, winner: winner, loser: loser,
        dealer: room.table.dealer, honba: room.table.honba, sticks: room.table.sticks
      });
    } else {
      var f = Number(input.fan) || 0;
      if (f <= 0) return fail('填一下番数');
      result = Score.fanSettle({
        fan: f, perFan: st.perFan, flat: st.flat, unit: st.unit, winner: winner, loser: loser,
        dealer: room.table.dealer, tsumoDouble: st.tsumoDouble, split: st.split
      });
    }
    var label = roundLabel(room.table) + ' ' + seatName(room, winner) +
      (tsumo ? ' 自摸' : ' 荣和 ' + seatName(room, loser)) +
      ' ' + (Number(input.amount) ? input.amount + ' 分' : (Number(input.fan) || 0) + st.unit) +
      ' · ' + result.text;
    return { ok: true, winner: winner, loser: loser, deltas: result.deltas, text: result.text, label: label };
  }

  function settle(room, seat, input) {
    var c = compute(room, input);
    if (!c.ok) return c;
    pushLog(room, {
      kind: 'win', winner: c.winner, loser: c.loser, deltas: c.deltas, text: c.text, label: c.label
    }, seat);
    for (var i = 0; i < 4; i++) room.scores[i] += c.deltas[i];
    if (room.settings.mode === 'riichi') room.table.sticks = 0;
    if (c.winner === room.table.dealer) {
      room.table.honba++;
    } else {
      room.table.dealer = (room.table.dealer + 1) % 4;
      room.table.honba = 0;
      advanceHand(room.table);
    }
    return { ok: true };
  }

  function apply(room, seat, input) {
    switch (input.action) {
      case 'settle': return settle(room, seat, input);
      case 'draw':
        pushLog(room, { kind: 'draw', deltas: [0, 0, 0, 0], label: roundLabel(room.table) + ' 流局' }, seat);
        room.table.honba++;
        return { ok: true };
      case 'riichi':
        if (room.settings.mode !== 'riichi') return fail('立直棒是日麻的规矩，先把记分方式切成日麻');
        room.scores[seat] -= 1000;
        room.table.sticks++;
        pushLog(room, { kind: 'riichi', deltas: [0, 0, 0, 0], label: seatName(room, seat) + ' 立直 −1000' }, seat);
        return { ok: true };
      case 'undo': {
        var last = room.log.pop();
        if (!last) return fail('还没有可撤销的记录');
        room.table = last.before.table;
        room.scores = last.before.scores;
        return { ok: true };
      }
      case 'reset':
        room.scores = [room.settings.start, room.settings.start, room.settings.start, room.settings.start];
        room.table = { dealer: 0, wind: '东', hand: 1, honba: 0, sticks: 0 };
        room.log = [];
        return { ok: true };
      case 'settings': {
        var st = room.settings;
        if (input.mode === 'riichi' || input.mode === 'fan') st.mode = input.mode;
        if (input.unit) st.unit = String(input.unit).slice(0, 2);
        ['perFan', 'flat', 'start'].forEach(function (k) {
          if (input[k] !== undefined && input[k] !== '') st[k] = Number(input[k]) || 0;
        });
        if (input.tsumoDouble !== undefined) st.tsumoDouble = !!input.tsumoDouble;
        if (input.split === 'all' || input.split === 'average') st.split = input.split;
        return { ok: true };
      }
      case 'table': {
        var t = room.table;
        if (input.dealer !== undefined && input.dealer !== '') {
          var d = Number(input.dealer);
          if (d >= 0 && d < 4) t.dealer = d;
        }
        if (input.wind && Score.WINDS.indexOf(input.wind) >= 0) t.wind = input.wind;
        if (input.hand !== undefined && input.hand !== '') {
          var h = Number(input.hand);
          if (h >= 1 && h <= 4) t.hand = h;
        }
        if (input.honba !== undefined && input.honba !== '') t.honba = Math.max(0, Number(input.honba) || 0);
        return { ok: true };
      }
      case 'name': {
        var s = room.seats[seat];
        if (!s) return fail('先入座');
        var name = String(input.name || '').trim().slice(0, 8);
        if (name) s.name = name;
        return { ok: true };
      }
      default:
        return fail('不认识的操作: ' + input.action);
    }
  }

  var api = {
    MAX_LOG: MAX_LOG,
    newRoom: newRoom,
    view: view,
    apply: apply,
    preview: compute,
    seatName: seatName,
    roundLabel: roundLabel,
    snapshot: snapshot
  };
  global.MJ = global.MJ || {};
  global.MJ.RoomCore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
