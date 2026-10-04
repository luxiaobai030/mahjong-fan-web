/* 规则引擎公共层：从「一种和牌解释」提取通用事实，供各规则复用 */
(function (global) {
  'use strict';
  var T = global.MJ.Tiles;
  var H = global.MJ.Hand;
  var N = T.NUM_TILES;

  /* 构造事实对象 F */
  function buildFacts(interp, ctx) {
    var sets = interp.sets || [];
    var pair = (interp.pair === undefined) ? null : interp.pair;
    var F = {
      interp: interp, ctx: ctx, special: interp.special,
      sets: sets, pair: pair,
      runs: [], triplets: [], kans: [],
      ankan: [], minkan: [], openSets: [], concealedSets: [],
      pairs: [], allTiles: [], counts: new Array(N).fill(0),
      winTile: ctx.winTile, tsumo: ctx.tsumo,
      winPos: interp.winPos || null,
      seatWind: ctx.seatWind, roundWind: ctx.roundWind,
      meldCount: ctx.meldCount, flowers: ctx.flowers
    };

    // 特殊牌型（七对 / 十三幺 / 全不靠 / 台湾七对）直接以整手牌为准
    var wholeHandShape = (interp.special === 'chiitoi' || interp.special === 'kokushi' ||
      interp.special === 'buka' || interp.special === 'taiwan-chiitoi');
    for (var i = 0; i < sets.length; i++) {
      var s = sets[i];
      if (s.kind === 'run') F.runs.push(s);
      if (s.kind === 'triplet' || s.kind === 'kan') F.triplets.push(s);
      if (s.kan || s.kind === 'kan' || s.type === 'kan' || s.type === 'ankan') F.kans.push(s);
      if (s.type === 'ankan') F.ankan.push(s);
      else if (s.type === 'kan') F.minkan.push(s);
      if (s.fromMeld) {
        if (s.type === 'ankan') F.concealedSets.push(s);
        else F.openSets.push(s);
      } else {
        F.concealedSets.push(s);
      }
    }
    if (wholeHandShape) {
      if (interp.special === 'chiitoi' || interp.special === 'kokushi') {
        for (var q = 0; q < N; q++) if (ctx.counts[q] === 2) F.pairs.push(q);
      }
      F.allTiles = ctx.handTiles.slice();
    } else {
      for (var i2 = 0; i2 < sets.length; i2++) F.allTiles = F.allTiles.concat(H.setToTiles(sets[i2]));
      if (pair !== null && pair !== undefined) {
        F.pairs.push(pair);
        F.allTiles.push(pair, pair);
      }
    }
    F.allTiles.sort(function (a, b) { return a - b; });
    for (var j = 0; j < F.allTiles.length; j++) F.counts[F.allTiles[j]]++;

    F.suitUsed = { m: false, s: false, p: false };
    F.hasWind = false; F.hasDragon = false; F.hasHonor = false;
    for (var t = 0; t < N; t++) {
      if (F.counts[t] === 0) continue;
      if (T.isSuit(t)) F.suitUsed['msp'[T.suitOf(t)]] = true;
      else { F.hasHonor = true; if (T.isWind(t)) F.hasWind = true; else F.hasDragon = true; }
    }
    F.suitCount = (F.suitUsed.m ? 1 : 0) + (F.suitUsed.s ? 1 : 0) + (F.suitUsed.p ? 1 : 0);
    F.missingSuits = 3 - F.suitCount;
    // 门清（暗杠不算破门清）
    F.concealedHand = F.openSets.length === 0;
    // 各花色出现的点数集合
    F.ranksInSuit = { m: [], s: [], p: [] };
    for (var u = 0; u < 27; u++) if (F.counts[u] > 0) F.ranksInSuit['msp'[Math.floor(u / 9)]].push((u % 9) + 1);

    // 暗刻判定
    F.concealedTriplets = [];
    for (var v = 0; v < F.triplets.length; v++) {
      if (H.isConcealedTriplet(F.triplets[v], ctx.winTile, ctx.tsumo)) F.concealedTriplets.push(F.triplets[v]);
    }
    return F;
  }

  /* 听形：edge 边张 / closed 坎张 / pair 单钓将 / dual 双碰 / null 不明 */
  function winShape(F) {
    var wp = F.winPos;
    if (!wp) return null;
    if (wp.kind === 'pair') return 'pair';
    if (wp.kind === 'triplet' || wp.kind === 'kan') return 'dual';
    if (wp.kind === 'run') {
      var s = F.sets[wp.index];
      if (!s) return null;
      var r = F.winTile - s.tile;
      if (r === 1) return 'closed';
      if (r === 0 && s.tile % 9 === 6) return 'edge';
      if (r === 2 && s.tile % 9 === 0) return 'edge';
      return 'open';
    }
    return null;
  }

  /* 牌组里是否有「4 张相同牌分散在不同面子」的情况（非杠） */
  function fourInHandCount(F) {
    var n = 0;
    for (var t = 0; t < N; t++) {
      if (F.counts[t] !== 4) continue;
      var isKan = false;
      for (var i = 0; i < F.kans.length; i++) if (F.kans[i].tile === t) isKan = true;
      if (!isKan) n++;
    }
    return n;
  }

  /* ---------- 面子 / 牌张通用判定 ---------- */
  function countRunsStarting(F, tile) {
    var n = 0;
    for (var i = 0; i < F.runs.length; i++) if (F.runs[i].tile === tile) n++;
    return n;
  }
  function countTripletsOf(F, tile) {
    var n = 0;
    for (var i = 0; i < F.triplets.length; i++) if (F.triplets[i].tile === tile) n++;
    return n;
  }
  function hasTriplet(F, tile) { return countTripletsOf(F, tile) > 0; }
  function runAt(F, tile) { return countRunsStarting(F, tile) > 0; }

  function everyTile(F, pred) {
    for (var i = 0; i < F.allTiles.length; i++) if (!pred(F.allTiles[i])) return false;
    return true;
  }

  /* 每个面子和将牌都满足 pred。七对子牌型下逐个对子检查。 */
  function everySetAndPair(F, pred) {
    if (F.special === 'chiitoi') {
      if (F.pairs.length === 0) return false;
      for (var q = 0; q < F.pairs.length; q++) if (!pred(F.pairs[q])) return false;
      return true;
    }
    var i, k, ts;
    for (i = 0; i < F.sets.length; i++) {
      ts = H.setToTiles(F.sets[i]);
      var hit = false;
      for (k = 0; k < ts.length; k++) if (pred(ts[k])) hit = true;
      if (!hit) return false;
    }
    if (F.pair === null || F.pair === undefined) return F.sets.length === 0;
    return pred(F.pair);
  }

  function distinctRuns(F) {
    var m = {};
    for (var i = 0; i < F.runs.length; i++) m[F.runs[i].tile] = (m[F.runs[i].tile] || 0) + 1;
    return m;
  }

  /* 役牌: 三元牌 / 场风 / 自风 */
  function isYakuhaiPair(F, tile, ctx) {
    if (T.isDragon(tile)) return true;
    if (T.isWind(tile)) return tile === 27 + ctx.roundWind || tile === 27 + ctx.seatWind;
    return false;
  }

  /* 番种互斥：按番值从高到低应用，被排除的保留在结果里并标注原因 */
  function applyExclusions(fans, table) {
    var byName = {};
    var i, j;
    for (i = 0; i < fans.length; i++) byName[fans[i].name] = fans[i];
    var sorted = fans.slice().sort(function (a, b) { return b.value - a.value; });
    var removedBy = {};
    for (i = 0; i < sorted.length; i++) {
      var ex = table[sorted[i].name];
      if (!ex) continue;
      for (j = 0; j < ex.length; j++) {
        var target = ex[j];
        if (byName[target] && !removedBy[target]) removedBy[target] = sorted[i].name;
      }
    }
    for (i = 0; i < fans.length; i++) {
      if (removedBy[fans[i].name]) {
        fans[i].excluded = true;
        fans[i].reason = '已包含在「' + removedBy[fans[i].name] + '」中，不重复计';
      }
    }
    return fans;
  }

  function sumFans(fans) {
    var s = 0;
    for (var i = 0; i < fans.length; i++) if (!fans[i].excluded) s += fans[i].value;
    return s;
  }

  /* 遍历所有和牌解释，取总分最高的一种 */
  function bestOf(ctx, evaluator) {
    var best = null;
    for (var i = 0; i < ctx.decomps.length; i++) {
      var r = evaluator(ctx.decomps[i]);
      if (!r) continue;
      if (!best || r.total > best.total) best = r;
    }
    return best;
  }

  /* 把点数/番数合计成显示文本 */
  function tilesText(tiles) { return tiles.map(T.name).join(' '); }

  var api = {
    buildFacts: buildFacts,
    winShape: winShape,
    fourInHandCount: fourInHandCount,
    countRunsStarting: countRunsStarting,
    countTripletsOf: countTripletsOf,
    hasTriplet: hasTriplet,
    runAt: runAt,
    everyTile: everyTile,
    everySetAndPair: everySetAndPair,
    distinctRuns: distinctRuns,
    isYakuhaiPair: isYakuhaiPair,
    applyExclusions: applyExclusions,
    sumFans: sumFans,
    bestOf: bestOf,
    tilesText: tilesText
  };
  global.MJ = global.MJ || {};
  global.MJ.Rules = global.MJ.Rules || {};
  global.MJ.Rules.common = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
