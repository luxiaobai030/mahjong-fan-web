/* 香港麻将（新章）—— 番数相加制
 * 一番起糊，番型叠加，花牌另计。
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
    var all = C.everyTile(F, T.isTerminalOrHonor);
    var allNoHonor = all && !F.hasHonor;

    var dt = 0, wt = 0;
    for (var i = 0; i < 3; i++) if (C.hasTriplet(F, 31 + i)) dt++;
    for (var w = 0; w < 4; w++) if (C.hasTriplet(F, 27 + w)) wt++;

    if (wt === 4) add('大四喜', 13);
    else if (wt === 3 && T.isWind(pair)) add('小四喜', 8);
    if (dt === 3) add('大三元', 8);
    else if (dt === 2 && pair !== null && T.isDragon(pair)) add('小三元', 5);

    if (ziyise) add('字一色', 10);
    else if (allNoHonor) add('清幺九', 10);
    else if (all) add('混幺九', 5);

    if (isChiitoi) add('七对', 3);
    if (qingyise) add('清一色', 7);
    else if (hunyise) add('混一色', 3);
    if (pengpeng) add('碰碰胡', 3);
    // 平胡：全顺子、无字牌、无花、非自摸
    if (!isChiitoi && !pengpeng && F.runs.length === 4 && !F.hasHonor && !F.tsumo &&
      !(ctx.flowers || []).length) add('平胡', 1);

    if (F.concealedHand) add('门前清', 1);
    if (F.tsumo) add('自摸', 1);
    if (fl.rinshan) add('杠上开花', 1);
    if (fl.chankan) add('抢杠胡', 1);
    if (fl.haitei) add('海底捞月', 1);
    if (fl.tenhou) add('天胡', 13);
    if (fl.chiihou) add('地胡', 13);

    var fls = ctx.flowers || [];
    if (fls.length) add('花牌', fls.length, fls.length + ' 张花牌');
    else if (ctx.options.wuHua !== false) add('无花', 1);
    var zheng = 0;
    for (var f = 0; f < fls.length; f++) if (T.isMatchingFlower(fls[f], ctx.seatWind)) zheng++;
    if (zheng > 0) add('正花', zheng);

    if (fans.length === 0) add('鸡胡', 0, '无番型，按最低 1 番计');
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
    var min = ctx.options.minFan === undefined ? 1 : ctx.options.minFan;
    best.minimum = min;
    best.reachMinimum = best.total >= min;
    if (!best.reachMinimum) best.note = '香港麻将通常 ' + min + ' 番起糊，当前只有 ' + best.total + ' 番。';
    best.unit = '番';
    best.pointsText = best.total + ' 番';
    return best;
  }

  R.hongkong = {
    id: 'hongkong',
    name: '香港麻将',
    short: '香港',
    desc: '新章番表：一番起糊，清一色 7 番、大四喜 13 番、十三幺 13 番，花牌/正花另计。',
    needSets: 4,
    opts: { chiitoi: true, kokushi: true, sevenPairs: 7 },
    has: { flowers: true, winds: true, riichi: false, dora: false, kans: true },
    options: [
      { key: 'roundWind', label: '圈风', type: 'wind' },
      { key: 'seatWind', label: '门风', type: 'wind' },
      { key: 'minFan', label: '起糊番数', type: 'number', def: 1 },
      { key: 'wuHua', label: '无花算 1 番', type: 'bool', def: true }
    ],
    score: score
  };
})(typeof window !== 'undefined' ? window : globalThis);
