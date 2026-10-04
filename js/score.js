/* 牌桌记分：把一局的结果换算成四家各自的得失分。
   规则引擎算的是「这手牌值多少番」，这里算「谁给谁多少钱」。
   服务端（server/rooms.js）和网页（js/lan.js）共用这一份，保证两边算得一样。
   座位号就是出牌顺序：座位 s 的下家是 (s + 1) % 4。 */
(function (global) {
  'use strict';

  var WINDS = ['东', '南', '西', '北'];

  function zeros(n) { var a = []; for (var i = 0; i < n; i++) a.push(0); return a; }
  function ceil100(n) { return Math.ceil(n / 100) * 100; }
  function sum(a) { var t = 0; for (var i = 0; i < a.length; i++) t += a[i]; return t; }

  /* 座位 -> 风位（按庄家轮转） */
  function windOf(seat, dealer, n) {
    n = n || 4;
    return WINDS[((seat - dealer) % n + n) % n];
  }

  /* ---------------- 日麻：番 + 符 -> 点数 ---------------- */

  function riichiBase(han, fu) {
    if (han >= 13) return { base: 8000, limit: '役满' };
    if (han >= 11) return { base: 6000, limit: '三倍满' };
    if (han >= 8) return { base: 4000, limit: '倍满' };
    if (han >= 6) return { base: 3000, limit: '跳满' };
    if (han >= 5) return { base: 2000, limit: '满贯' };
    var raw = fu * Math.pow(2, 2 + han);
    if (raw > 2000) return { base: 2000, limit: '满贯' };
    return { base: raw, limit: '' };
  }

  /* 只看点数，不看谁付：给界面显示用
     isDealer 庄家，自摸时返回每家付多少 */
  function riichiPoints(fan, fu, isDealer, tsumo) {
    var lim = riichiBase(fan, fu);
    var r = { limit: lim.limit, base: lim.base, dealer: !!isDealer, fan: fan, fu: fu };
    r.ron = ceil100(lim.base * (isDealer ? 6 : 4));
    if (isDealer) {
      r.tsumoEach = ceil100(lim.base * 2);
      r.tsumoTotal = r.tsumoEach * 3;
    } else {
      r.tsumoChild = ceil100(lim.base * 1);
      r.tsumoDealer = ceil100(lim.base * 2);
      r.tsumoTotal = r.tsumoChild * 2 + r.tsumoDealer;
    }
    r.text = (lim.limit ? lim.limit + ' ' : '') +
      (tsumo ? r.tsumoTotal + ' 点（自摸）' : r.ron + ' 点');
    return r;
  }

  /* 日麻一局结算
     opts: { fan, fu, winner, loser(自摸传 null), dealer, honba, sticks }
     供托（立直棒）是别人立直时先扣进池子的，这里只算「和牌者收池」，
     所以 deltas 之和会等于 1000 × sticks，不是 0 —— 这是对的。 */
  function riichiSettle(o) {
    var n = 4;
    var pts = riichiPoints(o.fan, o.fu, o.winner === o.dealer, o.loser === null || o.loser === undefined);
    var deltas = zeros(n);
    var tsumo = (o.loser === null || o.loser === undefined);
    if (tsumo) {
      for (var s = 0; s < n; s++) {
        if (s === o.winner) continue;
        var pay = pts.dealer ? pts.tsumoEach
          : (s === o.dealer ? pts.tsumoDealer : pts.tsumoChild);
        if (o.honba) pay += 100 * o.honba;
        deltas[s] -= pay;
        deltas[o.winner] += pay;
      }
    } else {
      var ron = pts.ron + 300 * (o.honba || 0);
      deltas[o.loser] -= ron;
      deltas[o.winner] += ron;
    }
    var pot = 1000 * (o.sticks || 0);
    if (pot) deltas[o.winner] += pot;
    return {
      ok: true, deltas: deltas, pot: pot, points: pts,
      text: pts.text + (o.honba ? ' · ' + o.honba + ' 本场' : '') + (pot ? ' · 供托 ' + pot : '')
    };
  }

  /* ---------------- 番 / 台 结算 ----------------
     opts: { fan, perFan, flat, winner, loser(自摸传 null), dealer,
             tsumoDouble, split('all' = 三家各付 / 'average' = 三家平摊), honba, honbaEach } */
  function fanSettle(o) {
    var n = 4;
    var deltas = zeros(n);
    var fan = Number(o.fan) || 0;
    var perFan = o.perFan === undefined ? 1 : Number(o.perFan);
    var flat = Number(o.flat) || 0;
    var hand = fan * perFan + flat;
    var tsumo = (o.loser === null || o.loser === undefined);
    var head = fan + (o.unit || '番') + (flat ? ' + 底 ' + flat : '') +
      (fan && perFan !== 1 ? '（每' + (o.unit || '番') + ' ' + perFan + '）' : '');
    if (tsumo) {
      var unit = o.tsumoDouble ? hand * 2 : hand;
      var each = o.split === 'average' ? Math.round(unit / (n - 1)) : unit;
      var got = 0;
      for (var s = 0; s < n; s++) {
        if (s === o.winner) continue;
        var pay = each + (o.honbaEach || 0) * (o.honba || 0);
        deltas[s] -= pay;
        got += pay;
      }
      deltas[o.winner] += got;
      return {
        ok: true, deltas: deltas, pot: 0,
        text: head + ' 自摸' + (o.tsumoDouble ? ' ×2' : '') +
          (o.split === 'average' ? ' 平摊 ' + each : ' 每家 ' + unit)
      };
    }
    var total = hand + (o.honbaEach || 0) * (o.honba || 0);
    deltas[o.loser] -= total;
    deltas[o.winner] += total;
    return { ok: true, deltas: deltas, pot: 0, text: head + ' 荣和 ' + total };
  }

  /* 直接给赢家一个点数（手填） */
  function pointsSettle(o) {
    var n = 4;
    var deltas = zeros(n);
    var amount = Number(o.amount) || 0;
    var tsumo = (o.loser === null || o.loser === undefined);
    if (tsumo) {
      var each = Math.round(amount / (n - 1));
      var got = 0;
      for (var s = 0; s < n; s++) {
        if (s === o.winner) continue;
        deltas[s] -= each;
        got += each;
      }
      deltas[o.winner] += got;
    } else {
      deltas[o.loser] -= amount;
      deltas[o.winner] += amount;
    }
    return { ok: true, deltas: deltas, pot: 0, text: (tsumo ? '自摸 ' : '荣和 ') + amount + ' 分' };
  }

  var api = {
    WINDS: WINDS,
    windOf: windOf,
    sum: sum,
    riichiBase: riichiBase,
    riichiPoints: riichiPoints,
    riichiSettle: riichiSettle,
    fanSettle: fanSettle,
    pointsSettle: pointsSettle
  };
  global.MJ = global.MJ || {};
  global.MJ.Score = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
