/* 日本立直麻将 —— 役种判定 + 符计算 + 点数换算
 * 采用标准日麻规则：食い下がり、平和ツモ 20 符、切り上げ満貫可选。
 */
(function (global) {
  'use strict';
  var T = global.MJ.Tiles;
  var D = global.MJ.Decompose;
  var H = global.MJ.Hand;
  var R = global.MJ.Rules;
  var C = R.common;
  var N = T.NUM_TILES;

  var DRAGON_NAMES = { 31: '中', 32: '发', 33: '白' };
  var WIND_NAMES = ['东', '南', '西', '北'];

  /* 宝牌指示牌 -> 实际宝牌 */
  function nextDora(t) {
    if (T.isSuit(t)) return Math.floor(t / 9) * 9 + ((t % 9 + 1) % 9);
    if (T.isWind(t)) return 27 + ((t - 27 + 1) % 4);
    if (t === 31) return 33;   // 中 -> 白
    if (t === 32) return 31;   // 发 -> 中
    if (t === 33) return 32;   // 白 -> 发
    return -1;
  }

  var isYakuhaiPair = C.isYakuhaiPair;
  var hasTriplet = C.hasTriplet;
  var runAt = C.runAt;
  var everyTile = C.everyTile;
  var everySetAndPair = C.everySetAndPair;

  /* ---------- 役种 ---------- */
  function collectYaku(F, ctx) {
    var out = [];
    function add(name, han, note) { out.push({ name: name, value: han, note: note || '' }); }
    var closed = F.concealedHand;             // 暗杠不破门清
    var menzen = F.openSets.length === 0;
    var fl = ctx.flags || {};
    var pair = F.pair;
    var shape = C.winShape(F);

    /* ===== 役满 ===== */
    var yakuman = [];
    function ym(name, note) { yakuman.push({ name: name, value: 13, yakuman: true, note: note || '' }); }

    if (fl.tenhou) ym('天和');
    if (fl.chiihou) ym('地和');
    if (F.special === 'kokushi') {
      var kokushiWaits = ctx.counts ? countKokushiWaits(F, ctx) : 1;
      if (kokushiWaits > 1) ym('国士无双十三面', '十三面听');
      else ym('国士无双');
    }
    if (F.special !== 'kokushi' && F.special !== 'chiitoi') {
      if (F.concealedTriplets.length === 4) {
        if (shape === 'pair') ym('四暗刻单骑', '四暗刻单骑为双倍役满，此处按役满计');
        else ym('四暗刻');
      }
      if (hasTriplet(F, 31) && hasTriplet(F, 32) && hasTriplet(F, 33)) ym('大三元');
      var winds = 0;
      for (var w = 0; w < 4; w++) if (hasTriplet(F, 27 + w)) winds++;
      if (winds === 4) ym('大四喜', '大四喜通常为双倍役满，此处按役满计');
      else if (winds === 3 && T.isWind(pair)) ym('小四喜');
      if (F.hasHonor && everyTile(F, T.isHonor)) ym('字一色');
      if (everyTile(F, T.isGreen)) ym('绿一色');
      if (everyTile(F, T.isTerminal)) ym('清老头');
      if (F.kans.length === 4) ym('四槓子');
      if (F.suitCount === 1 && !F.hasHonor) {
        var s0 = F.suitUsed.m ? 0 : (F.suitUsed.s ? 1 : 2);
        var base13 = T.countsFrom([]);
        var ok9 = F.counts[s0 * 9] >= 3 && F.counts[s0 * 9 + 8] >= 3;
        for (var i = 1; i <= 7; i++) if (F.counts[s0 * 9 + i] < 1) ok9 = false;
        if (ok9) {
          // 纯正九莲：去掉胡牌张后正好是 1112345678999
          var pure = (ctx.winTile !== null);
          var cc = F.counts.slice();
          cc[ctx.winTile]--;
          if (!(cc[s0 * 9] === 3 && cc[s0 * 9 + 8] === 3)) pure = false;
          for (var j = 1; j <= 7; j++) if (cc[s0 * 9 + j] !== 1) pure = false;
          if (pure) ym('纯正九莲宝灯', '九面听');
          else ym('九莲宝灯');
        }
      }
    }
    if (yakuman.length) {
      for (var y = 0; y < yakuman.length; y++) out.push(yakuman[y]);
      return out;
    }

    /* ===== 通常役 ===== */
    if (fl.riichi) add(fl.doubleRiichi ? '两立直' : '立直', fl.doubleRiichi ? 2 : 1);
    if (fl.ippatsu && fl.riichi) add('一发', 1);
    if (menzen && F.tsumo) add('门前清自摸和', 1);

    // 役牌
    for (var d = 31; d <= 33; d++) if (hasTriplet(F, d)) add('役牌 ' + DRAGON_NAMES[d], 1);
    if (hasTriplet(F, 27 + ctx.roundWind)) add('场风 ' + WIND_NAMES[ctx.roundWind], 1);
    if (hasTriplet(F, 27 + ctx.seatWind)) add('自风 ' + WIND_NAMES[ctx.seatWind], 1);

    // 平和：门清 + 四顺子 + 非役牌雀头 + 两面听
    if (menzen && F.runs.length === 4 && pair !== null && !isYakuhaiPair(F, pair, ctx) &&
      (shape === 'open' || shape === null)) add('平和', 1);

    if (everyTile(F, T.isSimple)) add('断幺九', 1);

    // 一盃口 / 二盃口
    if (menzen) {
      var byStart = {}, dupPairs = 0;
      for (var r = 0; r < F.runs.length; r++) byStart[F.runs[r].tile] = (byStart[F.runs[r].tile] || 0) + 1;
      for (var k in byStart) dupPairs += Math.floor(byStart[k] / 2);
      if (dupPairs >= 2) add('二盃口', 3);
      else if (dupPairs === 1) add('一盃口', 1);
    }

    // 三色同顺
    for (var rr = 0; rr < 7; rr++) {
      if (runAt(F, rr) && runAt(F, 9 + rr) && runAt(F, 18 + rr)) {
        add('三色同顺', menzen ? 2 : 1); break;
      }
    }
    // 一气通贯
    for (var ss = 0; ss < 3; ss++) {
      if (runAt(F, ss * 9) && runAt(F, ss * 9 + 3) && runAt(F, ss * 9 + 6)) {
        add('一气通贯', menzen ? 2 : 1); break;
      }
    }
    // 三色同刻
    for (var rk = 0; rk < 9; rk++) {
      if (hasTriplet(F, rk) && hasTriplet(F, 9 + rk) && hasTriplet(F, 18 + rk)) { add('三色同刻', 2); break; }
    }
    if (F.concealedTriplets.length === 3) add('三暗刻', 2);
    if (F.kans.length === 3) add('三槓子', 2);
    if (F.runs.length === 0 && F.triplets.length === 4) add('对对和', 2);
    (function () {
      var dt = 0;
      for (var i = 0; i < 3; i++) if (hasTriplet(F, 31 + i)) dt++;
      if (dt === 2 && pair !== null && T.isDragon(pair)) add('小三元', 2);
    })();

    // 全帯幺系
    var chantaShape = (F.special === 'chiitoi' || F.sets.length === 4);
    if (chantaShape && everySetAndPair(F, T.isTerminalOrHonor)) {
      if (!F.hasHonor) add('纯全带幺九', menzen ? 3 : 2);
      else add('混全带幺九', menzen ? 2 : 1);
    }
    // 混老头 / 清老头（清老头上面已作役满）
    if (everyTile(F, T.isTerminalOrHonor) && F.hasHonor) add('混老头', 2);

    if (F.special === 'chiitoi') add('七对子', 2);

    if (F.suitCount === 1 && !F.hasHonor) add('清一色', menzen ? 6 : 5);
    else if (F.suitCount === 1 && F.hasHonor) add('混一色', menzen ? 3 : 2);

    if (fl.rinshan) add('岭上开花', 1);
    if (fl.chankan) add('抢槓', 1);
    if (fl.haitei) add('海底摸月', 1);
    if (fl.houtei) add('河底捞鱼', 1);
    return out;
  }

  function countKokushiWaits(F, ctx) {
    // 去掉胡牌张后是否已是完整的十三种各一张 -> 十三面听
    var cc = F.counts.slice();
    if (ctx.winTile !== null) cc[ctx.winTile]--;
    var kinds = 0, dup = 0;
    for (var k = 0; k < D.ORPHANS.length; k++) {
      if (cc[D.ORPHANS[k]] === 1) kinds++;
      else if (cc[D.ORPHANS[k]] === 2) dup++;
    }
    return (kinds === 13 && dup === 0) ? 13 : 1;
  }

  /* ---------- 符 ---------- */
  function isTerminalHonorTile(t) { return T.isTerminalOrHonor(t); }

  function calcFu(F, ctx, yaku, isChiitoi) {
    if (isChiitoi) return 25;
    var menzen = F.openSets.length === 0;
    var fu = 20;
    if (menzen && !F.tsumo) fu += 10;
    if (F.tsumo) fu += 2;

    var pair = F.pair;
    if (pair !== null && pair !== undefined) {
      if (T.isDragon(pair)) fu += 2;
      else if (T.isWind(pair)) {
        if (pair === 27 + ctx.roundWind) fu += 2;
        if (pair === 27 + ctx.seatWind) fu += 2;
      }
    }
    var shape = C.winShape(F);
    if (shape === 'closed' || shape === 'edge' || shape === 'pair') fu += 2;

    for (var i = 0; i < F.sets.length; i++) {
      var s = F.sets[i];
      if (s.kind !== 'triplet' && s.kind !== 'kan') continue;
      var simple = T.isSimple(s.tile) ? 0 : 1;
      var isKan = (s.kan || s.kind === 'kan' || s.type === 'kan' || s.type === 'ankan');
      var concealedSet = H.isConcealedTriplet(s, ctx.winTile, ctx.tsumo);
      if (isKan) fu += concealedSet ? (simple ? 16 : 32) : (simple ? 8 : 16);
      else fu += concealedSet ? (simple ? 4 : 8) : (simple ? 2 : 4);
    }

    var hasPinfu = yaku.some(function (y) { return y.name === '平和'; });
    if (hasPinfu && F.tsumo) return 20;
    if (fu <= 20) fu = 30;   // 喰い平和形等按 30 符
    return Math.ceil(fu / 10) * 10;
  }

  /* ---------- 点数 ---------- */
  function ceil100(x) { return Math.ceil(x / 100) * 100; }

  function calcPoints(han, fu, ctx, opt) {
    var isDealer = ctx.seatWind === 0;
    var base;
    var limit = '';
    if (han >= 13) { base = 8000; limit = '役满'; }
    else if (han >= 11) { base = 6000; limit = '三倍满'; }
    else if (han >= 8) { base = 4000; limit = '倍满'; }
    else if (han >= 6) { base = 3000; limit = '跳满'; }
    else if (han >= 5) { base = 2000; limit = '满贯'; }
    else {
      base = fu * Math.pow(2, 2 + han);
      if (base > 2000) { base = 2000; limit = '满贯'; }
    }
    var r = { limit: limit, han: han, fu: fu, dealer: isDealer };
    if (isDealer) {
      r.ron = ceil100(base * 6);
      r.tsumoEach = ceil100(base * 2);
      r.tsumoTotal = r.tsumoEach * 3;
      r.text = (limit ? limit + ' ' : '') + r.ron + ' 点（自摸 ' + r.tsumoEach + ' 点all）';
    } else {
      r.ron = ceil100(base * 4);
      r.tsumoChild = ceil100(base * 1);
      r.tsumoDealer = ceil100(base * 2);
      r.tsumoTotal = r.tsumoChild * 2 + r.tsumoDealer;
      r.text = (limit ? limit + ' ' : '') + r.ron + ' 点（自摸 ' + r.tsumoChild + '/' + r.tsumoDealer + '）';
    }
    return r;
  }

  /* ---------- 计分 ---------- */
  function scoreInterp(interp, ctx) {
    var F = C.buildFacts(interp, ctx);
    var yaku = collectYaku(F, ctx);
    var isYakuman = yaku.length > 0 && yaku[0].yakuman;
    var han = 0;
    for (var i = 0; i < yaku.length; i++) han += yaku[i].value;

    var doraCount = 0;
    if (!isYakuman && ctx.dora) {
      for (var d = 0; d < ctx.dora.length; d++) {
        var real = nextDora(ctx.dora[d]);
        if (real >= 0) doraCount += F.counts[real] || 0;
      }
    }
    var uraCount = 0;
    if (!isYakuman && ctx.uraDora && ctx.flags && ctx.flags.riichi) {
      for (var u = 0; u < ctx.uraDora.length; u++) {
        var realUra = nextDora(ctx.uraDora[u]);
        if (realUra >= 0) uraCount += F.counts[realUra] || 0;
      }
    }
    if (doraCount > 0) yaku.push({ name: '宝牌', value: doraCount, note: '每张 +1 番，不计入起和役' });
    if (uraCount > 0) yaku.push({ name: '里宝牌', value: uraCount, note: '每张 +1 番' });

    var totalHan = han + doraCount + uraCount;
    var fu = calcFu(F, ctx, yaku, interp.special === 'chiitoi');
    var pts = calcPoints(isYakuman ? 13 : totalHan, isYakuman ? 0 : fu, ctx, ctx.options);

    return {
      ok: true, total: isYakuman ? han : totalHan, unit: '番',
      fans: yaku, han: han, dora: doraCount + uraCount,
      fu: isYakuman ? 0 : fu, points: pts, yakuman: isYakuman,
      hasYaku: han > 0
    };
  }

  function score(ctx) {
    if (ctx.decomps.length === 0) {
      return { ok: false, errors: ctx.errors.length ? ctx.errors : ['这副牌没有构成和牌牌型'], total: 0, fans: [] };
    }
    var best = null;
    for (var i = 0; i < ctx.decomps.length; i++) {
      var r = scoreInterp(ctx.decomps[i], ctx);
      if (!best) { best = r; continue; }
      var better = false;
      if (r.yakuman && !best.yakuman) better = true;
      else if (r.yakuman === best.yakuman && r.points.ron > best.points.ron) better = true;
      if (better) best = r;
    }
    if (!best) return { ok: false, errors: ['无法解析这副牌'], total: 0, fans: [] };
    if (!best.hasYaku) {
      best.ok = false;
      best.errors = ['没有役，不能和牌' + (best.dora ? '（宝牌不算役）' : '')];
    }
    best.unit = '番';
    return best;
  }

  R.riichi = {
    id: 'riichi',
    name: '日本立直麻将',
    short: '日麻',
    desc: '标准日麻（立直麻将）：役种 + 符计算 + 点数换算，含宝牌/里宝牌与役满。',
    needSets: 4,
    opts: { chiitoi: true, kokushi: true, sevenPairs: 7 },
    has: { flowers: false, winds: true, riichi: true, dora: true, kans: true, aka: true },
    options: [
      { key: 'roundWind', label: '场风', type: 'wind' },
      { key: 'seatWind', label: '自风', type: 'wind' }
    ],
    score: score
  };
})(typeof window !== 'undefined' ? window : globalThis);
