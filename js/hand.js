/* 手牌上下文构建：把用户输入整理成规则引擎可直接消费的结构
 *
 * 输入 input:
 *   hand      : 暗手牌（含胡牌张）tile 数组
 *   melds     : [{ type:'chi'|'pon'|'kan'|'ankan', tile, tiles? }]
 *   winTile   : 胡的那张
 *   tsumo     : 是否自摸
 *   seatWind  : 0..3 自风（0东 1南 2西 3北）
 *   roundWind : 0..3 圈风
 *   flowers   : 花牌数组
 *   flags     : { riichi, ippatsu, chankan, rinshan, haitei, houtei, tenhou, chiihou, ... }
 *   options   : { needSets, chiitoi, kokushi, sevenPairs, ... }
 *
 * 输出 ctx.decomps 中每一项都是一种「和牌解释」:
 *   { sets, pair, winPos, special }
 *   winPos = { index, kind }  index 为 sets 下标（-1 表示在将牌上）
 */
(function (global) {
  'use strict';
  var T = global.MJ.Tiles;
  var D = global.MJ.Decompose;
  var N = T.NUM_TILES;

  function meldTiles(m) {
    if (m.tiles && m.tiles.length) return m.tiles.slice();
    var t = m.tile;
    if (m.type === 'chi') return [t, t + 1, t + 2];
    if (m.type === 'kan' || m.type === 'ankan') return [t, t, t, t];
    return [t, t, t];
  }
  function isOpenMeld(m) { return m.type === 'chi' || m.type === 'pon' || m.type === 'kan'; }
  function isKanMeld(m) { return m.type === 'kan' || m.type === 'ankan'; }

  /* 把面子数组展开为具体牌张列表 */
  function setToTiles(s) {
    if (s.tiles && s.tiles.length) return s.tiles.slice();
    if (s.kind === 'run') return [s.tile, s.tile + 1, s.tile + 2];
    if (s.kind === 'triplet') return [s.tile, s.tile, s.tile];
    if (s.kind === 'kan') return [s.tile, s.tile, s.tile, s.tile];
    if (s.kind === 'pair') return [s.tile, s.tile];
    return [];
  }

  /* 判断一个暗刻是否算暗刻（点炮补全的刻子算明刻） */
  function isConcealedTriplet(set, winTile, tsumo) {
    if (set.kind !== 'triplet' && set.kind !== 'kan') return false;
    // 明副露（吃/碰/明杠）一定不算暗刻；暗杠算暗刻
    if (set.type === 'chi' || set.type === 'pon' || set.type === 'kan') return false;
    if (set.fromMeld && set.type !== 'ankan') return false;
    // 点炮补全的刻子按明刻计
    if (!tsumo && !set.fromMeld && winTile === set.tile) return false;
    return true;
  }

  function buildContext(input) {
    var opt = input.options || {};
    var needSets = opt.needSets || 4;
    var melds = (input.melds || []).map(function (m) {
      var mt = meldTiles(m);
      return {
        kind: (m.type === 'chi') ? 'run' : 'triplet',
        tile: m.type === 'chi' ? Math.min.apply(null, mt) : mt[0],
        type: m.type,
        open: isOpenMeld(m),
        kan: isKanMeld(m),
        fromMeld: true,
        tiles: mt
      };
    });
    var meldCount = melds.length;
    var handTiles = T.sortTiles(input.hand || []);
    var winTile = (input.winTile === undefined || input.winTile === null) ? null : input.winTile;
    var tsumo = !!input.tsumo;

    var counts = T.countsFrom(handTiles);
    var needConcealedSets = needSets - meldCount;

    var ctx = {
      handTiles: handTiles,
      counts: counts,
      melds: melds,
      meldCount: meldCount,
      needSets: needSets,
      winTile: winTile,
      tsumo: tsumo,
      seatWind: input.seatWind || 0,
      roundWind: input.roundWind || 0,
      flowers: (input.flowers || []).slice(),
      dora: (input.dora || []).slice(),
      uraDora: (input.uraDora || []).slice(),
      flags: input.flags || {},
      options: opt,
      decomps: [],
      errors: [],
      warnings: []
    };

    if (needConcealedSets < 0) {
      ctx.errors.push('副露数量超过了上限');
      return ctx;
    }

    var expectConcealed = needConcealedSets * 3 + 2;
    if (handTiles.length !== expectConcealed) {
      ctx.errors.push('手牌张数不对：按当前规则和副露数量应该是 ' + expectConcealed +
        ' 张，现在有 ' + handTiles.length + ' 张');
      return ctx;
    }
    if (winTile === null || counts[winTile] === undefined || counts[winTile] < 1) {
      ctx.errors.push('胡牌张不在手牌里');
      return ctx;
    }

    var concealedSets = D.decompose(counts, needConcealedSets, true);
    var i, j, d;

    // 手牌（含副露）的花色统计，供地方规则使用
    var merged = counts.slice();
    for (i = 0; i < melds.length; i++) {
      var mtiles = melds[i].tiles;
      for (j = 0; j < mtiles.length; j++) merged[mtiles[j]]++;
    }
    ctx.mergedCounts = merged;
    ctx.suitCount = (merged.slice(0, 9).some(function (x) { return x > 0; }) ? 1 : 0) +
      (merged.slice(9, 18).some(function (x) { return x > 0; }) ? 1 : 0) +
      (merged.slice(18, 27).some(function (x) { return x > 0; }) ? 1 : 0);
    ctx.hasHonor = merged.slice(27).some(function (x) { return x > 0; });

    // 听牌种数（用于「独听」判定）
    if (winTile !== null && counts[winTile] > 0) {
      var c13 = counts.slice();
      c13[winTile]--;
      ctx.winWaits = D.waits(c13, meldCount, opt).length;
    } else {
      ctx.winWaits = 0;
    }

    for (i = 0; i < concealedSets.length; i++) {
      var sets = melds.concat(concealedSets[i]);
      // 注意: 牌号 0 是一万，不能用真值判断
      var pair = null, pairFound = false;
      for (j = 0; j < sets.length; j++) {
        if (sets[j].kind === 'pair' && !sets[j].fromMeld) { pair = sets[j].tile; pairFound = true; }
      }
      var clean = [];
      for (j = 0; j < sets.length; j++) if (sets[j].kind !== 'pair') clean.push(sets[j]);
      if (!pairFound) continue;

      // 枚举胡牌张落点
      var placements = [];
      for (j = 0; j < clean.length; j++) {
        if (setToTiles(clean[j]).indexOf(winTile) >= 0) placements.push({ index: j, kind: clean[j].kind });
      }
      if (pair === winTile) placements.push({ index: -1, kind: 'pair' });
      if (placements.length === 0) placements.push({ index: -1, kind: 'unknown' });

      for (j = 0; j < placements.length; j++) {
        ctx.decomps.push({ sets: clean, pair: pair, winPos: placements[j], special: 'standard' });
      }
    }

    // 特殊型：七对 / 十三幺 / 国士无双十三面
    if (meldCount === 0) {
      if (opt.chiitoi !== false) {
        var sp = D.sevenPairs(counts, opt.sevenPairs || 7);
        if (sp) ctx.decomps.push({ sets: [], pair: null, winPos: null, special: 'chiitoi', info: sp });
      }
      if (opt.kokushi !== false) {
        var ko = D.thirteenOrphans(counts);
        if (ko) {
          var kokushiSets = [];
          for (var k = 0; k < D.ORPHANS.length; k++) {
            var t = D.ORPHANS[k];
            if (counts[t] === 2) kokushiSets.push({ kind: 'pair', tile: t });
            else if (counts[t] === 1) kokushiSets.push({ kind: 'triplet', tile: t, orphan: true });
          }
          ctx.decomps.push({ sets: [], pair: null, winPos: null, special: 'kokushi', info: ko });
        }
      }
    }

    if (ctx.decomps.length === 0) {
      ctx.errors.push(winTile === null ? '请先选好胡牌张' : '这副牌没有构成和牌牌型');
    }
    return ctx;
  }

  /* 统计工具：一组面子里各类牌出现次数 */
  function tileFrequency(sets, pair) {
    var f = new Array(N).fill(0);
    var i, k, ts;
    for (i = 0; i < sets.length; i++) {
      ts = setToTiles(sets[i]);
      for (k = 0; k < ts.length; k++) f[ts[k]]++;
    }
    if (pair !== null && pair !== undefined) f[pair] += 2;
    return f;
  }

  function hasSuit(sets, pair, suit) {
    var lo = suit * 9, hi = lo + 8, i, k, ts;
    for (i = 0; i < sets.length; i++) {
      ts = setToTiles(sets[i]);
      for (k = 0; k < ts.length; k++) if (ts[k] >= lo && ts[k] <= hi) return true;
    }
    if (pair !== null && pair !== undefined && pair >= lo && pair <= hi) return true;
    return false;
  }

  function hasHonors(sets, pair) {
    var i, k, ts;
    for (i = 0; i < sets.length; i++) {
      ts = setToTiles(sets[i]);
      for (k = 0; k < ts.length; k++) if (T.isHonor(ts[k])) return true;
    }
    if (pair !== null && pair !== undefined && T.isHonor(pair)) return true;
    return false;
  }

  var api = {
    buildContext: buildContext,
    meldTiles: meldTiles,
    setToTiles: setToTiles,
    isConcealedTriplet: isConcealedTriplet,
    isOpenMeld: isOpenMeld,
    isKanMeld: isKanMeld,
    tileFrequency: tileFrequency,
    hasSuit: hasSuit,
    hasHonors: hasHonors
  };
  global.MJ = global.MJ || {};
  global.MJ.Hand = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
