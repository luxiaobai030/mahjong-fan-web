/* 麻将牌基础模型 —— 浏览器与 Node 通用
 * 牌编码 index 0..33
 *   0-8   万 1..9
 *   9-17  条 1..9
 *   18-26 饼 1..9
 *   27-30 东 南 西 北
 *   31-33 中 发 白
 * 文本记号沿用通用写法: 1m..9m / 1s..9s / 1p..9p / 1z=东 2z=南 3z=西 4z=北 5z=白 6z=发 7z=中
 * 花牌编码 34..41 = 春 夏 秋 冬 梅 兰 竹 菊
 */
(function (global) {
  'use strict';

  var SUIT_M = 0, SUIT_S = 9, SUIT_P = 18, SUIT_Z = 27;
  var NUM_TILES = 34;
  var FLOWER_BASE = 34;
  var NUM_FLOWERS = 8;

  var CN_NUM = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];

  var NAMES = [];
  (function () {
    var i;
    for (i = 0; i < 9; i++) NAMES.push(CN_NUM[i] + '万');
    for (i = 0; i < 9; i++) NAMES.push(CN_NUM[i] + '条');
    for (i = 0; i < 9; i++) NAMES.push(CN_NUM[i] + '饼');
    NAMES.push('东风', '南风', '西风', '北风', '红中', '发财', '白板');
    NAMES.push('春', '夏', '秋', '冬', '梅', '兰', '竹', '菊');
  })();

  var CODES = [];
  (function () {
    var i;
    for (i = 1; i <= 9; i++) CODES.push(i + 'm');
    for (i = 1; i <= 9; i++) CODES.push(i + 's');
    for (i = 1; i <= 9; i++) CODES.push(i + 'p');
    CODES.push('1z', '2z', '3z', '4z', '7z', '6z', '5z');
    CODES.push('f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7', 'f8');
  })();

  var CODE_MAP = {};
  (function () {
    var i;
    for (i = 0; i < CODES.length; i++) CODE_MAP[CODES[i]] = i;
    CODE_MAP['0m'] = 4; CODE_MAP['0s'] = 13; CODE_MAP['0p'] = 22;
    CODE_MAP['E'] = 27; CODE_MAP['S'] = 28; CODE_MAP['W'] = 29; CODE_MAP['N'] = 30;
    CODE_MAP['C'] = 31; CODE_MAP['F'] = 32; CODE_MAP['P'] = 33;
    CODE_MAP['东'] = 27; CODE_MAP['南'] = 28; CODE_MAP['西'] = 29; CODE_MAP['北'] = 30;
    CODE_MAP['中'] = 31; CODE_MAP['发'] = 32; CODE_MAP['白'] = 33;
    CODE_MAP['東'] = 27; CODE_MAP['南風'] = 28;
  })();

  function isSuit(t) { return t >= 0 && t < 27; }
  function isHonor(t) { return t >= 27 && t < 34; }
  function isWind(t) { return t >= 27 && t <= 30; }
  function isDragon(t) { return t >= 31 && t <= 33; }
  function isFlower(t) { return t >= FLOWER_BASE; }
  function suitOf(t) { return isSuit(t) ? Math.floor(t / 9) : 3; }
  function rankOf(t) { return isSuit(t) ? (t % 9) + 1 : (t - 26); }
  function isTerminal(t) { return isSuit(t) && (t % 9 === 0 || t % 9 === 8); }
  function isTerminalOrHonor(t) { return isHonor(t) || isTerminal(t); }
  function isSimple(t) { return isSuit(t) && t % 9 !== 0 && t % 9 !== 8; }
  function isGreen(t) {
    return t === 10 || t === 11 || t === 12 || t === 14 || t === 16 || t === 32;
  }
  var FLIPPABLE = [18, 19, 20, 21, 22, 24, 25, 26, 10, 12, 13, 14, 16, 17, 33];
  function isFlippable(t) { return FLIPPABLE.indexOf(t) >= 0; }

  function name(t) { return NAMES[t] || ('?' + t); }
  function code(t) { return CODES[t] || ('?' + t); }
  function fromCode(c) { return CODE_MAP[c]; }

  function zhName(s) {
    var map = {
      '一万': 0, '二万': 1, '三万': 2, '四万': 3, '五万': 4, '六万': 5, '七万': 6, '八万': 7, '九万': 8,
      '一条': 9, '二条': 10, '三条': 11, '四条': 12, '五条': 13, '六条': 14, '七条': 15, '八条': 16, '九条': 17,
      '一饼': 18, '二饼': 19, '三饼': 20, '四饼': 21, '五饼': 22, '六饼': 23, '七饼': 24, '八饼': 25, '九饼': 26,
      '一筒': 18, '二筒': 19, '三筒': 20, '四筒': 21, '五筒': 22, '六筒': 23, '七筒': 24, '八筒': 25, '九筒': 26,
      '一索': 9, '二索': 10, '三索': 11, '四索': 12, '五索': 13, '六索': 14, '七索': 15, '八索': 16, '九索': 17,
      '东': 27, '南': 28, '西': 29, '北': 30, '中': 31, '发': 32, '白': 33,
      '春': 34, '夏': 35, '秋': 36, '冬': 37, '梅': 38, '兰': 39, '竹': 40, '菊': 41
    };
    return map[s];
  }

  /* 解析牌谱文本。支持:
   *   "123m 456s 东东东"  / "123m456s" / "1m 1m 1m" / "一万二万三万"
   */
  function parse(str) {
    if (!str) return [];
    var out = [];
    var tokens = String(str).replace(/[，,、\s]+/g, ' ').trim().split(' ');
    for (var i = 0; i < tokens.length; i++) {
      var tk = tokens[i];
      if (!tk) continue;
      if (/^[\u4e00-\u9fa5]+$/.test(tk)) {
        var zh = tk.match(/[一二三四五六七八九][万条饼筒索]|[东南西北中发白]|[春夏秋冬梅兰竹菊]/g);
        if (zh && zh.join('') === tk) {
          for (var q = 0; q < zh.length; q++) {
            var idx = zhName(zh[q]);
            if (idx === undefined) throw new Error('无法识别的牌: ' + zh[q]);
            out.push(idx);
          }
          continue;
        }
      }
      var lower = tk.toLowerCase();
      if (fromCode(tk) !== undefined) { out.push(fromCode(tk)); continue; }
      if (fromCode(lower) !== undefined) { out.push(fromCode(lower)); continue; }
      // 连写记法: "123m456m789m123s55s"，也支持中英混写 "中中中123m55s"
      var MIX = /[0-9]+[mspz]|[一二三四五六七八九][万条饼筒索]|[东南西北中发白]|東|[春夏秋冬梅兰竹菊]/g;
      var parts = String(tk).match(MIX);
      if (parts && parts.join('') === tk) {
        for (var pi = 0; pi < parts.length; pi++) {
          var seg = parts[pi];
          if (/^[0-9]/.test(seg)) {
            var digits = seg.slice(0, -1), suit = seg.slice(-1);
            for (var k = 0; k < digits.length; k++) {
              var c = digits[k] + suit;
              if (fromCode(c) === undefined) throw new Error('无法识别的牌: ' + c);
              out.push(fromCode(c));
            }
          } else {
            var zi = zhName(seg);
            if (zi === undefined) throw new Error('无法识别的牌: ' + seg);
            out.push(zi);
          }
        }
        continue;
      }
      throw new Error('无法识别的牌: ' + tk);
    }
    return out;
  }

  function countsFrom(tiles) {
    var c = new Array(NUM_TILES).fill(0);
    for (var i = 0; i < tiles.length; i++) if (tiles[i] < NUM_TILES) c[tiles[i]]++;
    return c;
  }
  function tilesFromCounts(counts) {
    var out = [];
    for (var i = 0; i < NUM_TILES; i++) for (var k = 0; k < (counts[i] || 0); k++) out.push(i);
    return out;
  }
  function sortTiles(tiles) { return tiles.slice().sort(function (a, b) { return a - b; }); }

  function flowerGroup(t) { return t < 38 ? 0 : 1; }
  /* 正花: 东家配春/梅, 南家配夏/兰, 西家配秋/竹, 北家配冬/菊
   * 季牌 34-37 = 春夏秋冬, 花牌 38-41 = 梅兰竹菊, 两组各自按 0..3 对应座风 */
  function isMatchingFlower(t, seatWind) {
    if (!isFlower(t)) return false;
    return ((t - FLOWER_BASE) % 4) === seatWind;
  }

  var api = {
    SUIT_M: SUIT_M, SUIT_S: SUIT_S, SUIT_P: SUIT_P, SUIT_Z: SUIT_Z,
    NUM_TILES: NUM_TILES, FLOWER_BASE: FLOWER_BASE, NUM_FLOWERS: NUM_FLOWERS,
    CN_NUM: CN_NUM, NAMES: NAMES, CODES: CODES, CODE_MAP: CODE_MAP,
    isSuit: isSuit, isHonor: isHonor, isWind: isWind, isDragon: isDragon, isFlower: isFlower,
    suitOf: suitOf, rankOf: rankOf, isTerminal: isTerminal, isTerminalOrHonor: isTerminalOrHonor,
    isSimple: isSimple, isGreen: isGreen, isFlippable: isFlippable,
    name: name, code: code, fromCode: fromCode, parse: parse, zhName: zhName,
    countsFrom: countsFrom, tilesFromCounts: tilesFromCounts, sortTiles: sortTiles,
    flowerGroup: flowerGroup, isMatchingFlower: isMatchingFlower
  };

  global.MJ = global.MJ || {};
  global.MJ.Tiles = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
