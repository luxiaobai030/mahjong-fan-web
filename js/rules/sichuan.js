/* 四川麻将（血战到底）—— 108 张，无字牌无花牌，必须缺一门，番数翻倍制
 * 番数 = 翻倍次数，最终倍数 = 2^番数
 *   平胡 0 番(1倍) / 对对胡·金钩钓 1 番(2倍) / 清一色·七对·将对·带幺九 2 番(4倍)
 *   清对·龙七对 3 番(8倍) / 清七对·清带幺 4 番(16倍) / 清龙七对·天胡·地胡 5 番(32倍)
 *   十八罗汉 6 番(64倍) / 清十八罗汉 7 番(128倍)   根: 每组四张 +1 番
 */
(function (global) {
  'use strict';
  var T = global.MJ.Tiles;
  var D = global.MJ.Decompose;
  var H = global.MJ.Hand;
  var R = global.MJ.Rules;
  var C = R.common;
  var N = T.NUM_TILES;

  function genCount(F) {
    var n = 0;
    for (var t = 0; t < 27; t++) if (F.counts[t] === 4) n++;
    return n;
  }

  function collect(F, ctx) {
    var fans = [];
    function add(name, fan, note) {
      fans.push({ name: name, value: fan, note: note || '', multiple: Math.pow(2, fan) });
    }
    var fl = ctx.flags || {};
    var pair = F.pair;
    var isChiitoi = F.special === 'chiitoi';
    var dragonPair = false;

    // ---- 形状类 ----
    var toitoi = !isChiitoi && F.runs.length === 0 && F.triplets.length === 4;
    var allTerminal = C.everySetAndPair(F, T.isTerminal);
    var all258 = C.everyTile(F, function (x) { return T.isSuit(x) && [1, 4, 7].indexOf(x % 9) >= 0; });
    var qingyise = (F.suitCount === 1);
    var longQiDui = false, qiDui = false;

    if (isChiitoi) {
      qiDui = true;
      var hasFour = false;
      for (var t = 0; t < 27; t++) if (F.counts[t] === 4) hasFour = true;
      longQiDui = hasFour;
    }
    var jingou = (F.meldCount === 4) && F.winPos && F.winPos.kind === 'pair';
    var sisi = F.kans.length >= 4;

    if (sisi) {
      add(qingyise ? '清十八罗汉' : '十八罗汉', qingyise ? 7 : 6, '四杠');
    } else if (qingyise && longQiDui && qiDui) {
      add('清龙七对', 5);
    } else if (qingyise && qiDui) {
      add('清七对', 4);
    } else if (qingyise && toitoi) {
      add('清对', 3);
    } else if (qingyise && allTerminal && !toitoi) {
      add('清带幺', 4);
    } else if (qingyise) {
      add('清一色', 2);
    }
    if (!qingyise || (!sisi && !longQiDui)) {
      if (longQiDui && !qingyise) add('龙七对', 3);
      else if (qiDui && !qingyise) add('七对', 2);
    }
    if (toitoi) {
      if (all258) add('将对', 2);
      else if (!qingyise && !sisi) add('对对胡', 1);
    }
    if (allTerminal && !toitoi && !jingou && !isChiitoi && !qingyise) add('带幺九', 2);
    if (jingou) add('金钩钓', 1);
    if (!toitoi && !qiDui && !jingou && !allTerminal && !qingyise && !sisi) {
      add('平胡', 0, '基础牌型');
    }

    // ---- 加番 ----
    var roots = genCount(F);
    if (roots > 0) add('根', roots, roots + ' 组四张相同牌');
    if (fl.rinshan) add('杠上花', 1);
    if (fl.chankan) add('抢杠胡', 1);
    if (fl.haitei) add('海底捞月', 1);
    if (fl.tenhou) add('天胡', 5);
    if (fl.chiihou) add('地胡', 5);
    if (F.tsumo && ctx.options.tsumoFan !== false) add('自摸', 1);
    return fans;
  }

  function scoreInterp(interp, ctx) {
    var F = C.buildFacts(interp, ctx);
    var fans = collect(F, ctx);
    var total = 0;
    for (var i = 0; i < fans.length; i++) total += fans[i].value;
    return {
      ok: true, total: total, unit: '番', fans: fans,
      multiple: Math.pow(2, total),
      note: ''
    };
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
    best.pointsText = '2^' + best.total + ' = ' + best.multiple + ' 倍';
    var errs = [], warns = [];
    if (ctx.suitCount === 3 && ctx.options.requireMissingSuit !== false) {
      warns.push('四川麻将需要缺一门，当前三门齐全。');
    }
    if (ctx.options.noHonors !== false) {
      for (var t = 27; t < 34; t++) if (ctx.counts[t] > 0) { errs.push('四川麻将不含字牌'); break; }
    }
    if (errs.length) { best.ok = false; best.errors = errs; }
    if (warns.length) best.warnings = warns;
    return best;
  }

  R.sichuan = {
    id: 'sichuan',
    name: '四川麻将（血战到底）',
    short: '四川',
    desc: '108 张无字牌，必须缺一门；番数翻倍制，根、金钩钓、龙七对、十八罗汉。',
    needSets: 4,
    suits: ['m', 's', 'p'],
    opts: { chiitoi: true, kokushi: false, sevenPairs: 7 },
    has: { flowers: false, winds: false, riichi: false, dora: false, kans: true, noHonors: true },
    options: [
      { key: 'requireMissingSuit', label: '必须缺一门', type: 'bool', def: true },
      { key: 'tsumoFan', label: '自摸加番', type: 'bool', def: true }
    ],
    score: score
  };
})(typeof window !== 'undefined' ? window : globalThis);
