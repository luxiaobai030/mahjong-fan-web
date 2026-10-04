/* 手牌拆解 / 听牌 / 向听 —— 全规则共用的算法核心
 *
 * 拆解结果统一表示为「面子数组」，每项:
 *   { kind: 'run' | 'triplet' | 'pair', tile }
 * 顺子 tile 记最小那张；刻子 / 对子记该张。
 */
(function (global) {
  'use strict';
  var T = global.MJ.Tiles;
  var N = T.NUM_TILES;

  /* 枚举把手牌 counts 拆成 needSets 个面子 + 1 个对子的所有方案
   * opts.pair 为 false 时允许无对子（用于七对等特殊判断不在此处）
   */
  function decompose(counts, needSets, needPair) {
    if (needPair === undefined) needPair = true;
    var results = [];
    var cur = [];
    var c = counts.slice();

    function rec(start, setsLeft, pairTaken) {
      var i = start;
      while (i < N && c[i] === 0) i++;
      if (i >= N) {
        if (setsLeft === 0 && (pairTaken || !needPair)) results.push(cur.slice());
        return;
      }
      if (needPair && !pairTaken && c[i] >= 2) {
        c[i] -= 2; cur.push({ kind: 'pair', tile: i });
        rec(i, setsLeft, true);
        cur.pop(); c[i] += 2;
      }
      if (setsLeft > 0) {
        if (c[i] >= 3) {
          c[i] -= 3; cur.push({ kind: 'triplet', tile: i });
          rec(i, setsLeft - 1, pairTaken);
          cur.pop(); c[i] += 3;
        }
        if (i < 27 && i % 9 <= 6 && c[i + 1] > 0 && c[i + 2] > 0) {
          c[i]--; c[i + 1]--; c[i + 2]--;
          cur.push({ kind: 'run', tile: i });
          rec(i, setsLeft - 1, pairTaken);
          cur.pop();
          c[i]++; c[i + 1]++; c[i + 2]++;
        }
      }
    }
    rec(0, needSets, false);
    return results;
  }

  /* 七对（needPairs 对，13 张规则为 7 对，16 张规则为 8 对） */
  function sevenPairs(counts, needPairs) {
    var pairs = 0, kinds = 0;
    for (var i = 0; i < N; i++) {
      var n = counts[i];
      if (n === 0) continue;
      if (n % 2 !== 0) return null;
      pairs += n / 2;
      kinds++;
    }
    if (pairs !== needPairs) return null;
    return { kind: 'chiitoi', pairs: pairs, kinds: kinds };
  }

  var ORPHANS = [0, 8, 9, 17, 18, 26, 27, 28, 29, 30, 31, 32, 33];
  function thirteenOrphans(counts) {
    var total = 0, hasPair = false;
    for (var k = 0; k < ORPHANS.length; k++) {
      var n = counts[ORPHANS[k]];
      if (n === 0) return null;
      if (n > 2) return null;
      if (n === 2) hasPair = true;
      total += n;
    }
    for (var i = 0; i < N; i++) if (counts[i] > 0 && ORPHANS.indexOf(i) < 0) return null;
    if (total !== 14 || !hasPair) return null;
    return { kind: 'kokushi' };
  }

  /* 是否和牌（含副露）。meldCount 为已副露面子数。 */
  function isWin(counts, meldCount, opts) {
    opts = opts || {};
    var needSets = (opts.needSets || 4) - meldCount;
    if (needSets < 0) return false;
    if (decompose(counts, needSets, true).length > 0) return true;
    if (meldCount === 0) {
      if (opts.chiitoi !== false && sevenPairs(counts, opts.sevenPairs || 7)) return true;
      if (opts.kokushi !== false && thirteenOrphans(counts)) return true;
    }
    return false;
  }

  /* 标准型向听数。返回 -1 表示已和牌。 */
  function shantenStandard(counts, meldCount, needSets) {
    needSets = needSets || 4;
    var base = needSets * 2;
    var best = base;
    var c = counts.slice();

    function rec(i, melds, partials, hasPair) {
      var totalMelds = meldCount + melds;
      var pairFlag = hasPair ? 1 : 0;
      var blocks = totalMelds + partials + pairFlag;
      var v = base - 2 * totalMelds - partials - pairFlag;
      if (v < best) best = v;

      var j = i;
      while (j < N && c[j] === 0) j++;
      if (j >= N) return;

      // 容量约束: 面子 ≤ needSets；面子+搭子 ≤ needSets；面子+搭子+雀头 ≤ needSets+1
      var canAddMeld = totalMelds < needSets;
      var canAddPartial = (totalMelds + partials) < needSets && blocks < needSets + 1;
      var canAddPair = !hasPair && blocks < needSets + 1;

      // 不使用这张
      var saved = c[j];
      c[j] = 0;
      rec(j + 1, melds, partials, hasPair);
      c[j] = saved;

      if (canAddMeld && c[j] >= 3) {
        c[j] -= 3;
        rec(j, melds + 1, partials, hasPair);
        c[j] += 3;
      }
      if (c[j] >= 2) {
        if (canAddPair) {
          c[j] -= 2;
          rec(j, melds, partials, true);
          c[j] += 2;
        }
        if (canAddPartial) {
          c[j] -= 2;
          rec(j, melds, partials + 1, hasPair);
          c[j] += 2;
        }
      }
      if (canAddMeld && j < 27 && j % 9 <= 6 && c[j + 1] > 0 && c[j + 2] > 0) {
        c[j]--; c[j + 1]--; c[j + 2]--;
        rec(j, melds + 1, partials, hasPair);
        c[j]++; c[j + 1]++; c[j + 2]++;
      }
      if (canAddPartial && j < 27 && j % 9 <= 7 && c[j + 1] > 0) {
        c[j]--; c[j + 1]--;
        rec(j, melds, partials + 1, hasPair);
        c[j]++; c[j + 1]++;
      }
      if (canAddPartial && j < 27 && j % 9 <= 6 && c[j + 2] > 0) {
        c[j]--; c[j + 2]--;
        rec(j, melds, partials + 1, hasPair);
        c[j]++; c[j + 2]++;
      }
    }
    rec(0, 0, 0, false);
    return best;
  }

  function shantenChiitoi(counts) {
    var pairs = 0, kinds = 0;
    for (var i = 0; i < N; i++) {
      if (counts[i] > 0) kinds++;
      if (counts[i] >= 2) pairs++;
    }
    return 6 - pairs + Math.max(0, 7 - kinds);
  }

  function shantenKokushi(counts) {
    var kinds = 0, hasPair = false;
    for (var k = 0; k < ORPHANS.length; k++) {
      var n = counts[ORPHANS[k]];
      if (n > 0) kinds++;
      if (n >= 2) hasPair = true;
    }
    return 13 - kinds - (hasPair ? 1 : 0);
  }

  /* 综合向听数 */
  function shanten(counts, meldCount, opts) {
    opts = opts || {};
    var needSets = opts.needSets || 4;
    var best = shantenStandard(counts, meldCount || 0, needSets);
    if (!meldCount && opts.chiitoi !== false) {
      var sp = shantenChiitoi(counts, opts.sevenPairs || 7);
      if (sp < best) best = sp;
    }
    if (!meldCount && opts.kokushi !== false) {
      var sk = shantenKokushi(counts);
      if (sk < best) best = sk;
    }
    return best;
  }

  /* 听牌列表: 返回能和的牌种 */
  function waits(counts, meldCount, opts) {
    opts = opts || {};
    var out = [];
    var c = counts.slice();
    for (var t = 0; t < N; t++) {
      if (c[t] >= 4) continue;
      c[t]++;
      if (isWin(c, meldCount, opts)) out.push(t);
      c[t]--;
    }
    return out;
  }

  /* 有效进张: 使向听数下降的牌 */
  function improvements(counts, meldCount, opts) {
    opts = opts || {};
    var cur = shanten(counts, meldCount, opts);
    var out = [];
    var c = counts.slice();
    for (var t = 0; t < N; t++) {
      if (c[t] >= 4) continue;
      c[t]++;
      var s = shanten(c, meldCount, opts);
      c[t]--;
      if (s < cur) out.push(t);
    }
    return { shanten: cur, tiles: out };
  }

  /* 把「副露 + 暗手」合并成完整牌组，便于规则计算 */
  function allSets(concealedSets, melds) {
    var out = [];
    for (var i = 0; i < (melds || []).length; i++) out.push(melds[i]);
    for (var j = 0; j < concealedSets.length; j++) out.push(concealedSets[j]);
    return out;
  }

  var api = {
    decompose: decompose,
    sevenPairs: sevenPairs,
    thirteenOrphans: thirteenOrphans,
    isWin: isWin,
    shanten: shanten,
    shantenStandard: shantenStandard,
    shantenChiitoi: shantenChiitoi,
    shantenKokushi: shantenKokushi,
    waits: waits,
    improvements: improvements,
    allSets: allSets,
    ORPHANS: ORPHANS
  };
  global.MJ = global.MJ || {};
  global.MJ.Decompose = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
