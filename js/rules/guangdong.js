/* 广东麻将（推倒胡）—— 番数相加制
 * 各地牌馆差异较大，这里采用最常见的推倒胡番表，番型可叠加。
 */
(function (global) {
  'use strict';
  var T = global.MJ.Tiles;
  var D = global.MJ.Decompose;
  var H = global.MJ.Hand;
  var R = global.MJ.Rules;
  var C = R.common;

  function collect(F, ctx) {
    var fans = [];
    function add(name, v, note) { fans.push({ name: name, value: v, note: note || '' }); }
    var fl = ctx.flags || {};
    var pair = F.pair;
    var isChiitoi = F.special === 'chiitoi';
    var isKokushi = F.special === 'kokushi';

    if (isKokushi) {
      add('十三幺', 13);
      if (F.tsumo) add('自摸', 1);
      return fans;
    }

    var pengpeng = !isChiitoi && F.runs.length === 0 && F.triplets.length === 4;
    var qingyise = F.suitCount === 1 && !F.hasHonor;
    var hunyise = F.suitCount === 1 && F.hasHonor;
    var ziyise = F.suitCount === 0 && F.hasHonor;
    var allTerminalHonor = C.everySetAndPair(F, T.isTerminalOrHonor) && C.everyTile(F, T.isTerminalOrHonor);
    var allTerminal = allTerminalHonor && !F.hasHonor;

    var dt = 0, wt = 0;
    for (var i = 0; i < 3; i++) if (C.hasTriplet(F, 31 + i)) dt++;
    for (var w = 0; w < 4; w++) if (C.hasTriplet(F, 27 + w)) wt++;
    var dragonPair = (pair !== null && T.isDragon(pair));

    if (wt === 4) add('大四喜', 13);
    else if (wt === 3 && T.isWind(pair)) add('小四喜', 8);
    if (dt === 3) add('大三元', 8);
    else if (dt === 2 && dragonPair) add('小三元', 5);

    if (ziyise) add('字一色', 8);
    else if (allTerminal) add('清幺九', 8);
    else if (allTerminalHonor) add('混幺九', 5);

    if (isChiitoi) {
      var hasFour = false;
      for (var t = 0; t < 34; t++) if (F.counts[t] === 4) hasFour = true;
      if (qingyise) add('清七对', 8);
      else if (hasFour) add('豪华七对', 8);
      else add('七对', 5);
    } else if (qingyise && pengpeng) {
      add('清碰', 8);
    } else if (hunyise && pengpeng) {
      add('混碰', 5);
    } else if (qingyise) {
      add('清一色', 5);
    } else if (hunyise) {
      add('混一色', 3);
    } else if (pengpeng) {
      add('碰碰胡', 2);
    } else {
      add('平胡', 1);
    }

    if (F.concealedHand) add('门前清', 1);
    if (F.tsumo) add('自摸', 1);
    if (fl.rinshan) add('杠上开花', 1);
    if (fl.chankan) add('抢杠胡', 1);
    if (fl.haitei) add('海底捞月', 1);
    if (fl.tenhou) add('天胡', 13);
    if (fl.chiihou) add('地胡', 13);
    if (ctx.flowers && ctx.flowers.length) add('花牌', ctx.flowers.length, ctx.flowers.length + ' 张花牌');
    return fans;
  }

  function scoreInterp(interp, ctx) {
    var F = C.buildFacts(interp, ctx);
    var fans = collect(F, ctx);
    var total = 0;
    for (var i = 0; i < fans.length; i++) total += fans[i].value;
    return { ok: true, total: total, unit: '番', fans: fans };
  }

  function score(ctx) {
    if (ctx.decomps.length === 0) {
      return { ok: false, errors: ctx.errors.length ? ctx.errors : ['这副牌没有构成和牌牌型'], total: 0, fans: [] };
    }
    var best = null;
    for (var i = 0; i < ctx.decomps.length; i++) {
      var r = scoreInterp(ctx.decomps[i], ctx);
      if (!best || r.total > best.total) best = r;
    }
    best.unit = '番';
    best.pointsText = best.total + ' 番';
    return best;
  }

  R.guangdong = {
    id: 'guangdong',
    name: '广东麻将（推倒胡）',
    short: '广东',
    desc: '常见推倒胡番表：平胡 1 番起，碰碰胡 / 混一色 / 清一色 / 混碰 / 清碰 / 十三幺，花牌计番。',
    needSets: 4,
    opts: { chiitoi: true, kokushi: true, sevenPairs: 7 },
    has: { flowers: true, winds: true, riichi: false, dora: false, kans: true },
    options: [
      { key: 'roundWind', label: '圈风', type: 'wind' },
      { key: 'seatWind', label: '门风', type: 'wind' }
    ],
    score: score
  };
})(typeof window !== 'undefined' ? window : globalThis);

