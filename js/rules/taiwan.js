/* 台湾麻将（十六张）—— 底台制
 * 手牌 16 张，和牌 17 张 = 5 副面子 + 1 对将。
 * 台数相加，最终得分 = 底 + 台。花牌 1 台/张，正花再加 1 台/张。
 */
(function (global) {
  'use strict';
  var T = global.MJ.Tiles;
  var D = global.MJ.Decompose;
  var H = global.MJ.Hand;
  var R = global.MJ.Rules;
  var C = R.common;
  var N = T.NUM_TILES;

  /* 台湾「七对」= 七对 + 一刻（17 张的必然形态） */
  function taiwanPairs(counts) {
    for (var t = 0; t < N; t++) {
      if (counts[t] < 3) continue;
      var c = counts.slice();
      c[t] -= 3;
      var pairs = 0, ok = true;
      for (var k = 0; k < N; k++) {
        if (c[k] === 0) continue;
        if (c[k] % 2 !== 0) { ok = false; break; }
        pairs += c[k] / 2;
      }
      if (ok && pairs === 7) return t;
    }
    return -1;
  }

  function collect(F, ctx) {
    var fans = [];
    function add(name, v, note) { fans.push({ name: name, value: v, note: note || '' }); }
    var fl = ctx.flags || {};
    var pair = F.pair;
    var isPairs = (F.special === 'taiwan-chiitoi');

    var pengpeng = !isPairs && F.runs.length === 0 && F.triplets.length === 5;
    var qingyise = F.suitCount === 1 && !F.hasHonor;
    var hunyise = F.suitCount === 1 && F.hasHonor;
    var ziyise = F.suitCount === 0 && F.hasHonor;

    var dt = 0, wt = 0;
    for (var i = 0; i < 3; i++) if (C.hasTriplet(F, 31 + i)) dt++;
    for (var w = 0; w < 4; w++) if (C.hasTriplet(F, 27 + w)) wt++;

    if (wt === 4) add('大四喜', 16);
    else if (wt === 3 && T.isWind(pair)) add('小四喜', 8);
    if (dt === 3) add('大三元', 8);
    else if (dt === 2 && pair !== null && T.isDragon(pair)) add('小三元', 4);
    if (ziyise) add('字一色', 16);
    if (isPairs) add('七对', 7);
    if (qingyise) add('清一色', 8);
    else if (hunyise) add('混一色', 4);
    if (pengpeng) add('碰碰胡', 4);
    var ankou = F.concealedTriplets.length;
    if (ankou >= 5) add('五暗刻', 8);
    else if (ankou === 4) add('四暗刻', 5);
    else if (ankou === 3) add('三暗刻', 2);

    // 平胡：全顺子、无字牌、无花、非自摸
    if (!isPairs && F.runs.length === 5 && !F.hasHonor && !F.tsumo &&
      !(ctx.flowers || []).length) add('平胡', 2);

    // 门风 / 圈风 / 三元牌
    if (C.hasTriplet(F, 27 + ctx.seatWind)) add('门风 ' + ['东', '南', '西', '北'][ctx.seatWind], 1);
    if (C.hasTriplet(F, 27 + ctx.roundWind) && ctx.roundWind !== ctx.seatWind) {
      add('圈风 ' + ['东', '南', '西', '北'][ctx.roundWind], 1);
    }
    for (var d = 31; d <= 33; d++) if (C.hasTriplet(F, d)) add('三元牌 ' + T.name(d), 1);

    // 花牌
    var fls = ctx.flowers || [];
    if (fls.length) {
      add('花牌', fls.length, fls.length + ' 张花牌');
      var zheng = 0;
      for (var f = 0; f < fls.length; f++) if (T.isMatchingFlower(fls[f], ctx.seatWind)) zheng++;
      if (zheng > 0) add('正花', zheng, zheng + ' 张正花');
      if (fls.length === 8) add('八仙过海', 8);
    }

    if (F.concealedHand) add('门清', 1);
    if (F.tsumo) add('自摸', 1);
    if (fl.rinshan) add('杠上开花', 1);
    if (fl.chankan) add('抢杠胡', 1);
    if (fl.haitei) add('海底捞月', 1);
    if (fl.tenhou) add('天胡', 24);
    else if (fl.chiihou) add('地胡', 16);
    // 独听：只听一种牌
    if (ctx.options.duTing !== false && ctx.winWaits === 1) add('独听', 1);
    return fans;
  }

  function scoreInterp(interp, ctx) {
    var F = C.buildFacts(interp, ctx);
    var fans = collect(F, ctx);
    var total = 0;
    for (var i = 0; i < fans.length; i++) total += fans[i].value;
    return { ok: true, total: total, unit: '台', fans: fans };
  }

  function score(ctx) {
    var candidates = ctx.decomps.slice();
    // 台湾七对（七对 + 一刻）
    if (ctx.meldCount === 0) {
      var tri = taiwanPairs(ctx.counts);
      if (tri >= 0) {
        candidates.push({
          sets: [{ kind: 'triplet', tile: tri }], pair: null,
          winPos: null, special: 'taiwan-chiitoi'
        });
      }
    }
    if (candidates.length === 0) {
      return { ok: false, errors: ctx.errors.length ? ctx.errors : ['这副牌没有构成和牌牌型'], total: 0, fans: [] };
    }
    var best = null;
    for (var i = 0; i < candidates.length; i++) {
      var r = scoreInterp(candidates[i], ctx);
      if (!best || r.total > best.total) best = r;
    }
    var base = ctx.options.baseTai === undefined ? 1 : ctx.options.baseTai;
    best.unit = '台';
    best.base = base;
    best.pointsText = '底 ' + base + ' 台 + ' + best.total + ' 台 = ' + (base + best.total) + ' 台';
    return best;
  }

  R.taiwan = {
    id: 'taiwan',
    name: '台湾麻将（十六张）',
    short: '台湾',
    desc: '16 张手牌、和牌 17 张（5 副 + 1 将）；底台制，花牌/正花/独听/八仙过海。',
    needSets: 5,
    opts: { chiitoi: false, kokushi: false, sevenPairs: 8 },
    has: { flowers: true, winds: true, riichi: false, dora: false, kans: true },
    options: [
      { key: 'roundWind', label: '圈风', type: 'wind' },
      { key: 'seatWind', label: '门风', type: 'wind' },
      { key: 'baseTai', label: '底台', type: 'number', def: 1 },
      { key: 'duTing', label: '算独听', type: 'bool', def: true }
    ],
    score: score
  };
})(typeof window !== 'undefined' ? window : globalThis);

