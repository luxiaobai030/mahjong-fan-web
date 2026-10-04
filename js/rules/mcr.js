/* 国标麻将（中国麻将竞赛规则 1998）—— 81 番种，8 番起和
 *
 * 计分遵循「不重复原则」：番值高者已包含低者时，低者不再计分。
 * 被排除的番种仍会列在结果里并标注原因，便于核对。
 */
(function (global) {
  'use strict';
  var T = global.MJ.Tiles;
  var D = global.MJ.Decompose;
  var H = global.MJ.Hand;
  var R = global.MJ.Rules;
  var C = R.common;
  var N = T.NUM_TILES;

  /* 官方「不计」表 */
  var EXCLUDE = {
    '大四喜': ['三风刻', '圈风刻', '门风刻', '碰碰和', '幺九刻'],
    '大三元': ['箭刻', '双箭刻', '幺九刻'],
    '绿一色': ['清一色'],
    '九莲宝灯': ['清一色', '门前清', '幺九刻', '连六', '老少副', '一般高', '喜相逢'],
    '四杠': ['三杠', '双明杠', '双暗杠', '明杠', '暗杠', '碰碰和', '单钓将'],
    '连七对': ['七对', '清一色', '一般高', '喜相逢', '无字', '缺一门', '单钓将'],
    '十三幺': ['混幺九', '五门齐', '门前清', '单钓将', '不求人'],
    '清幺九': ['混幺九', '碰碰和', '全带幺', '幺九刻', '无字', '缺一门'],
    '小四喜': ['三风刻'],
    '小三元': ['箭刻', '双箭刻'],
    '字一色': ['混幺九', '碰碰和', '全带幺', '幺九刻', '无字', '缺一门', '混一色'],
    '四暗刻': ['碰碰和', '门前清', '不求人', '三暗刻', '双暗刻'],
    '一色双龙会': ['清一色', '平和', '一般高', '老少副'],
    '一色四同顺': ['一色三同顺', '一般高', '七对', '清一色'],
    '一色四节高': ['一色三节高', '碰碰和'],
    '一色四步高': ['一色三步高', '连六'],
    '三杠': ['双明杠', '双暗杠', '明杠', '暗杠', '碰碰和'],
    '混幺九': ['碰碰和', '全带幺', '幺九刻'],
    '七对': ['单钓将', '不求人', '四归一'],
    '七星不靠': ['五门齐', '门前清', '不求人', '全不靠'],
    '全不靠': ['五门齐', '门前清', '不求人'],
    '清龙': ['连六', '老少副', '一般高', '喜相逢'],
    '三色双龙会': ['喜相逢', '老少副', '无字', '缺一门'],
    '一色三步高': ['连六', '老少副', '一般高'],
    '一色三同顺': ['一般高'],
    '全大': ['无字'],
    '全中': ['无字'],
    '全小': ['无字'],
    '全带五': ['断幺'],
    '三同刻': ['双同刻'],
    '三暗刻': ['双暗刻'],
    '双箭刻': ['箭刻'],
    '不求人': ['自摸', '门前清'],
    '平和': ['无字'],
    '断幺': ['无字'],
    '全带幺': ['幺九刻']
  };

  var PERMS3 = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];

  /* ---------- 小工具（统一走公共层） ---------- */
  var countRunsStarting = C.countRunsStarting;
  var hasTriplet = C.hasTriplet;
  var hasRun = C.runAt;
  var everyTile = C.everyTile;
  var everySetAndPair = C.everySetAndPair;
  var distinctRuns = C.distinctRuns;

  /* 全不靠 / 七星不靠：14 张互不搭界的单张（同花色两两至少隔 2 个点、字牌不重复） */
  function bukaoInterp(ctx) {
    var counts = ctx.counts, total = 0, honors = 0, t, s, r, i;
    for (t = 0; t < N; t++) {
      if (counts[t] > 1) return null;
      total += counts[t];
      if (t >= 27 && counts[t] > 0) honors++;
    }
    if (total !== 14) return null;
    for (s = 0; s < 3; s++) {
      var ranks = [];
      for (r = 0; r < 9; r++) if (counts[s * 9 + r] > 0) ranks.push(r);
      for (i = 1; i < ranks.length; i++) if (ranks[i] - ranks[i - 1] < 3) return null;
    }
    return { sets: [], pair: null, winPos: null, special: 'buka', honors: honors };
  }

  /* 组合龙：三组花色不同、序数为 147 / 258 / 369 的顺子 + 1 面子 + 1 将 */
  function zulongInterp(counts) {
    for (var p = 0; p < PERMS3.length; p++) {
      var need = counts.slice(), ok = true, t, g, k;
      for (g = 0; g < 3; g++) {
        var base = PERMS3[p][g] * 9 + g;
        for (k = 0; k < 3; k++) {
          t = base + k * 3;
          if (need[t] < 1) { ok = false; break; }
          need[t]--;
        }
        if (!ok) break;
      }
      if (!ok) continue;
      var rcounts = new Array(N).fill(0), total = 0;
      for (t = 0; t < N; t++) { rcounts[t] = need[t]; total += need[t]; }
      if (total !== 5) continue;
      var dd = D.decompose(rcounts, 1, true);
      if (dd.length === 0) continue;
      var sets = [], pair = null;
      for (g = 0; g < 3; g++) {
        var b2 = PERMS3[p][g] * 9 + g;
        sets.push({ kind: 'zulong', tile: b2, tiles: [b2, b2 + 3, b2 + 6] });
      }
      for (k = 0; k < dd[0].length; k++) {
        if (dd[0][k].kind === 'pair') pair = dd[0][k].tile;
        else sets.push(dd[0][k]);
      }
      return { sets: sets, pair: pair, winPos: null, special: 'standard', zulong: true };
    }
    return null;
  }

  /* ---------- 番种判定 ---------- */
  function collectFans(F, ctx) {
    var fans = [];
    function add(name, value, note) { fans.push({ name: name, value: value, note: note || '' }); }

    var pair = F.pair;
    var isChiitoi = F.special === 'chiitoi';
    var isKokushi = F.special === 'kokushi';
    var concealed = F.concealedHand;

    /* ===== 特殊型和 ===== */
    if (isKokushi) {
      add('十三幺', 88);
      add('门前清', 2);
      if (F.tsumo) { add('不求人', 4); add('自摸', 1); }
      return fans;
    }

    if (F.special === 'buka') {
      if (F.interp.honors === 7) add('七星不靠', 24);
      else add('全不靠', 12);
      add('门前清', 2);
      if (F.tsumo) { add('不求人', 4); add('自摸', 1); }
      if (F.missingSuits >= 1 && !F.hasHonor) add('缺一门', 1);
      return fans;
    }

    if (isChiitoi) {
      var pairs = F.pairs.slice().sort(function (a, b) { return a - b; });
      add('七对', 24);
      // 连七对：同花色连续 7 对
      if (pairs.length === 7 && T.isSuit(pairs[0]) && pairs[6] - pairs[0] === 6 &&
        Math.floor(pairs[0] / 9) === Math.floor(pairs[6] / 9)) {
        add('连七对', 88);
      }
      if (F.suitCount === 1 && !F.hasHonor) add('清一色', 24);
      else if (F.suitCount === 1 && F.hasHonor) add('混一色', 6);
      if (F.hasHonor && F.suitCount === 0) add('字一色', 64);
      if (!F.hasHonor) add('无字', 1);
      if (F.missingSuits === 1) add('缺一门', 1);
      add('门前清', 2);
      if (F.tsumo) { add('不求人', 4); add('自摸', 1); }
      if (ctx.flags && ctx.flags.haitei) add('妙手回春', 8);
      if (ctx.flags && ctx.flags.houtei) add('海底捞月', 8);
      return fans;
    }

    /* ===== 标准型 ===== */
    var t, i;

    // --- 88 分 ---
    if (hasTriplet(F, 27) && hasTriplet(F, 28) && hasTriplet(F, 29) && hasTriplet(F, 30)) add('大四喜', 88);
    if (hasTriplet(F, 31) && hasTriplet(F, 32) && hasTriplet(F, 33)) add('大三元', 88);
    if (everyTile(F, T.isGreen)) add('绿一色', 88);
    if (concealed && !F.hasHonor && F.suitCount === 1) {
      var suit = F.suitUsed.m ? 0 : (F.suitUsed.s ? 1 : 2);
      var ok9 = F.counts[suit * 9] >= 3 && F.counts[suit * 9 + 8] >= 3;
      for (i = 1; i <= 7; i++) if (F.counts[suit * 9 + i] < 1) ok9 = false;
      if (ok9 && F.allTiles.length === 14) add('九莲宝灯', 88);
    }
    if (F.kans.length === 4) add('四杠', 88);

    // --- 64 分 ---
    if (!F.hasHonor && everyTile(F, T.isTerminal) && F.runs.length === 0) add('清幺九', 64);
    var windT = 0;
    for (i = 0; i < 4; i++) if (hasTriplet(F, 27 + i)) windT++;
    if (windT === 3 && T.isWind(pair)) add('小四喜', 64);
    var dragonT = 0;
    for (i = 0; i < 3; i++) if (hasTriplet(F, 31 + i)) dragonT++;
    if (dragonT === 2 && T.isDragon(pair)) add('小三元', 64);
    if (F.hasHonor && everyTile(F, T.isHonor)) add('字一色', 64);
    if (F.concealedTriplets.length === 4) add('四暗刻', 64);
    // 一色双龙会
    if (F.suitCount === 1 && !F.hasHonor && F.runs.length === 4 && pair !== null &&
      pair % 9 === 4 && countRunsStarting(F, pair - 4) === 2 && countRunsStarting(F, pair + 2) === 2) {
      add('一色双龙会', 64);
    }

    // --- 48 / 32 分 ---
    var runFreq = distinctRuns(F);
    var maxSameRun = 0, maxSameRunTile = -1;
    for (var rk in runFreq) if (runFreq[rk] > maxSameRun) { maxSameRun = runFreq[rk]; maxSameRunTile = +rk; }
    if (maxSameRun === 4) add('一色四同顺', 48);
    // 一色四节高
    if (F.triplets.length === 4 && F.runs.length === 0 && F.suitCount === 1 && !F.hasHonor) {
      var ts = F.triplets.map(function (s) { return s.tile; }).sort(function (a, b) { return a - b; });
      if (ts[1] - ts[0] === 1 && ts[2] - ts[1] === 1 && ts[3] - ts[2] === 1) add('一色四节高', 48);
    }
    if (F.kans.length === 3) add('三杠', 32);
    if (everySetAndPair(F, T.isTerminalOrHonor) && F.runs.length === 0) add('混幺九', 32);
    // 一色四步高
    (function () {
      for (var s = 0; s < 3; s++) {
        for (var step = 1; step <= 2; step++) {
          for (var lo = 0; lo + 3 * step <= 6; lo++) {
            if (hasRun(F, s * 9 + lo) && hasRun(F, s * 9 + lo + step) &&
              hasRun(F, s * 9 + lo + 2 * step) && hasRun(F, s * 9 + lo + 3 * step)) {
              add('一色四步高', 32);
              return;
            }
          }
        }
      }
    })();

    // --- 24 分 ---
    if (F.suitCount === 1 && !F.hasHonor) add('清一色', 24);
    if (maxSameRun === 3) add('一色三同顺', 24);
    (function () {
      if (F.suitCount !== 1 || F.hasHonor) return;
      var t3 = F.triplets.map(function (s) { return s.tile; }).sort(function (a, b) { return a - b; });
      for (var i = 0; i + 2 < t3.length; i++) {
        if (t3[i + 1] - t3[i] === 1 && t3[i + 2] - t3[i + 1] === 1) { add('一色三节高', 24); return; }
      }
    })();
    if (everyTile(F, function (x) { return T.isSuit(x) && x % 9 >= 6; })) add('全大', 24);
    if (everyTile(F, function (x) { return T.isSuit(x) && (x % 9 >= 3 && x % 9 <= 5); })) add('全中', 24);
    if (everyTile(F, function (x) { return T.isSuit(x) && x % 9 <= 2; })) add('全小', 24);
    if (F.triplets.length === 4 && F.runs.length === 0 && everyTile(F, function (x) { return T.isSuit(x) && (x % 9) % 2 === 1; })) {
      add('全双刻', 24);
    }

    // --- 16 分 ---
    if (F.suitCount === 1 && !F.hasHonor) {
      var s0 = F.suitUsed.m ? 0 : (F.suitUsed.s ? 1 : 2);
      if (hasRun(F, s0 * 9) && hasRun(F, s0 * 9 + 3) && hasRun(F, s0 * 9 + 6)) add('清龙', 16);
    }
    // 三色双龙会
    (function () {
      if (F.suitCount !== 3 || F.hasHonor || F.runs.length !== 4 || pair === null) return;
      var pairSuit = T.suitOf(pair);
      if (pair % 9 !== 4) return;
      var others = [0, 1, 2].filter(function (x) { return x !== pairSuit; });
      var a = others[0], b = others[1];
      if (hasRun(F, a * 9) && hasRun(F, a * 9 + 6) && hasRun(F, b * 9) && hasRun(F, b * 9 + 6)) {
        add('三色双龙会', 16);
      }
    })();
    // 一色三步高 / 三色三步高
    (function () {
      for (var s = 0; s < 3; s++) {
        for (var step = 1; step <= 2; step++) {
          for (var lo = 0; lo + 2 * step <= 6; lo++) {
            if (hasRun(F, s * 9 + lo) && hasRun(F, s * 9 + lo + step) && hasRun(F, s * 9 + lo + 2 * step)) {
              add('一色三步高', 16);
              return;
            }
          }
        }
      }
    })();
    if (everySetAndPair(F, function (x) { return T.isSuit(x) && x % 9 === 4; })) add('全带五', 16);
    // 三同刻
    (function () {
      for (var r = 0; r < 9; r++) {
        var cnt = 0;
        for (var s = 0; s < 3; s++) if (hasTriplet(F, s * 9 + r)) cnt++;
        if (cnt === 3) { add('三同刻', 16); return; }
      }
    })();
    if (F.concealedTriplets.length === 3) add('三暗刻', 16);

    // --- 12 分 ---
    if (F.interp && F.interp.zulong) add('组合龙', 12);
    if (everyTile(F, function (x) { return T.isSuit(x) && x % 9 >= 5; })) add('大于五', 12);
    if (everyTile(F, function (x) { return T.isSuit(x) && x % 9 <= 3; })) add('小于五', 12);
    if (windT === 3) add('三风刻', 12);

    // --- 8 分 ---
    (function () {
      for (var a = 0; a < 3; a++) {
        for (var b = 0; b < 3; b++) {
          if (a === b) continue;
          var c = 3 - a - b;
          if (c === a || c === b) continue;
          if (hasRun(F, a * 9) && hasRun(F, b * 9 + 3) && hasRun(F, c * 9 + 6)) { add('花龙', 8); return; }
        }
      }
    })();
    if (everyTile(F, T.isFlippable)) add('推不倒', 8);
    // 三色三同顺
    (function () {
      for (var r = 0; r < 7; r++) {
        var cnt = 0;
        for (var s = 0; s < 3; s++) if (hasRun(F, s * 9 + r)) cnt++;
        if (cnt === 3) { add('三色三同顺', 8); return; }
      }
    })();
    // 三色三节高
    (function () {
      for (var r = 0; r < 7; r++) {
        for (var pi = 0; pi < PERMS3.length; pi++) {
          var P = PERMS3[pi];
          if (hasTriplet(F, P[0] * 9 + r) && hasTriplet(F, P[1] * 9 + r + 1) &&
            hasTriplet(F, P[2] * 9 + r + 2)) { add('三色三节高', 8); return; }
        }
      }
    })();
    if (F.ankan.length === 2) add('双暗杠', 8);

    // --- 6 分 ---
    if (F.runs.length === 0) add('碰碰和', 6);
    if (F.suitCount === 1 && F.hasHonor) add('混一色', 6);
    // 三色三步高
    (function () {
      var found = false;
      for (var base = 0; base <= 4 && !found; base++) {
        var perms = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
        for (var p = 0; p < perms.length && !found; p++) {
          if (hasRun(F, perms[p][0] * 9 + base) && hasRun(F, perms[p][1] * 9 + base + 1) &&
            hasRun(F, perms[p][2] * 9 + base + 2)) { add('三色三步高', 6); found = true; }
        }
      }
    })();
    if (F.suitCount === 3 && F.hasWind && F.hasDragon) add('五门齐', 6);
    if (F.sets.length === 4 && F.openSets.length === 4 && F.winPos && F.winPos.kind === 'pair' && !F.tsumo) add('全求人', 6);
    if (dragonT === 2) add('双箭刻', 6);

    // --- 4 分 ---
    if (F.runs.length + F.triplets.length > 0 && everySetAndPair(F, T.isTerminalOrHonor)) add('全带幺', 4);
    if (concealed && F.tsumo) add('不求人', 4);
    if (F.minkan.length === 2) add('双明杠', 4);
    // 和绝张：胡的那张牌已见 3 张
    (function () {
      if (ctx.flags && ctx.flags.lastTile) add('和绝张', 4);
    })();

    // --- 2 分 ---
    if (dragonT === 1) add('箭刻', 2);
    if (hasTriplet(F, 27 + ctx.roundWind)) add('圈风刻', 2);
    if (hasTriplet(F, 27 + ctx.seatWind)) add('门风刻', 2);
    if (concealed && !F.tsumo) add('门前清', 2);
    if (F.runs.length === 4 && pair !== null && !T.isHonor(pair)) add('平和', 2);
    var fourInOne = C.fourInHandCount(F);
    if (fourInOne > 0) add('四归一', 2 * fourInOne);
    (function () {
      for (var r = 0; r < 9; r++) {
        var cnt = 0;
        for (var s = 0; s < 3; s++) if (hasTriplet(F, s * 9 + r)) cnt++;
        if (cnt >= 2) { add('双同刻', 2); return; }
      }
    })();
    if (F.concealedTriplets.length === 2) add('双暗刻', 2);
    if (F.ankan.length === 1) add('暗杠', 2);
    if (everyTile(F, T.isSimple)) add('断幺', 2);

    // --- 1 分 ---
    (function () {
      var rf = distinctRuns(F);
      for (var k in rf) { if (rf[k] >= 2) { add('一般高', 1); break; } }
    })();
    (function () {
      var byStart = {};
      for (var i = 0; i < F.runs.length; i++) byStart[F.runs[i].tile % 9] = (byStart[F.runs[i].tile % 9] || 0) + 1;
      for (var k in byStart) { if (byStart[k] >= 2) { add('喜相逢', 1); break; } }
    })();
    (function () {
      for (var s = 0; s < 3; s++) {
        for (var lo = 0; lo <= 3; lo++) {
          if (hasRun(F, s * 9 + lo) && hasRun(F, s * 9 + lo + 3)) { add('连六', 1); return; }
        }
      }
    })();
    (function () {
      for (var s = 0; s < 3; s++) {
        if (hasRun(F, s * 9) && hasRun(F, s * 9 + 6)) { add('老少副', 1); return; }
      }
    })();
    (function () {
      var n = 0;
      for (var i = 0; i < F.triplets.length; i++) if (T.isTerminalOrHonor(F.triplets[i].tile)) n++;
      if (n > 0) add('幺九刻', n);
    })();
    if (F.minkan.length === 1) add('明杠', 1);
    if (F.missingSuits === 1) add('缺一门', 1);
    if (!F.hasHonor) add('无字', 1);
    var shape = C.winShape(F);
    if (shape === 'edge') add('边张', 1);
    if (shape === 'closed') add('坎张', 1);
    if (shape === 'pair' && !isChiitoi) add('单钓将', 1);
    if (F.tsumo) add('自摸', 1);

    return fans;
  }

  /* ---------- 单种解释计分 ---------- */
  function scoreInterp(interp, ctx) {
    var F = C.buildFacts(interp, ctx);
    var fans = collectFans(F, ctx);

    // 事件番
    if (ctx.flags) {
      if (ctx.flags.rinshan) fans.push({ name: '杠上开花', value: 8, note: '' });
      if (ctx.flags.chankan) fans.push({ name: '抢杠和', value: 8, note: '' });
      if (ctx.flags.haitei) fans.push({ name: '妙手回春', value: 8, note: '' });
      if (ctx.flags.houtei) fans.push({ name: '海底捞月', value: 8, note: '' });
    }
    // 去重（同名同值只留一条）
    var seen = {};
    fans = fans.filter(function (f) {
      var k = f.name;
      if (seen[k]) { seen[k].value += f.value; return false; }
      seen[k] = f;
      return true;
    });

    C.applyExclusions(fans, EXCLUDE);

    var total = C.sumFans(fans);
    // 无番和
    if (total === 0) {
      fans.push({ name: '无番和', value: 8, note: '没有任何其他番种，按无番和计 8 番' });
      total = 8;
    }
    var flowerFan = ctx.flowers ? ctx.flowers.length : 0;
    if (flowerFan > 0) {
      fans.push({ name: '花牌', value: flowerFan, note: flowerFan + ' 张花牌，每张 1 番' });
      total += flowerFan;
    }
    return { total: total, fans: fans, ok: true };
  }

  function score(ctx) {
    // 全不靠 / 七星不靠 / 组合龙 不是标准型和牌形，需要单独补进来
    var candidates = ctx.decomps.slice();
    if (ctx.meldCount === 0) {
      var bk = bukaoInterp(ctx);
      if (bk) candidates.push(bk);
    }
    var zl = zulongInterp(ctx.counts);
    if (zl) candidates.push(zl);

    if (candidates.length === 0) {
      return { ok: false, errors: ctx.errors.length ? ctx.errors : ['这副牌没有构成和牌牌型'], total: 0, fans: [] };
    }
    var best = null;
    for (var i = 0; i < candidates.length; i++) {
      var r = scoreInterp(candidates[i], ctx);
      if (!best || r.total > best.total) best = r;
    }
    best.unit = '番';
    best.minimum = 8;
    best.reachMinimum = best.total >= 8;
    best.note = best.reachMinimum ? '' : '国标麻将需要 8 番起和，这副牌只有 ' + best.total + ' 番，不能和。';
    return best;
  }

  R.mcr = {
    id: 'mcr',
    name: '国标麻将',
    short: '国标',
    desc: '中国麻将竞赛规则（1998 竞技麻将），81 个番种，8 番起和，不计重复番。',
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
