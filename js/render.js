/* 牌面 SVG 渲染 —— 纯矢量、离线可用、缩放到任意尺寸都清晰 */
(function (global) {
  'use strict';
  var T = global.MJ.Tiles;

  var C = {
    face: '#fdfaf2', edge: '#d9cdb4', shade: '#efe6d4',
    ink: '#1b3a8f', red: '#c0392b', green: '#1a7f45', dark: '#2b2b2b'
  };
  var FONT = '"Songti SC","SimSun","STSong","Noto Serif CJK SC",serif';

  /* 饼（筒）圆心坐标表: [cx, cy, r] */
  var DOT = {
    1: [[30, 43, 14]],
    2: [[30, 27, 10], [30, 59, 10]],
    3: [[17, 23, 9], [30, 43, 9], [43, 63, 9]],
    4: [[19, 26, 10], [41, 26, 10], [19, 60, 10], [41, 60, 10]],
    5: [[17, 22, 8.5], [43, 22, 8.5], [30, 43, 8.5], [17, 64, 8.5], [43, 64, 8.5]],
    6: [[19, 21, 8.5], [41, 21, 8.5], [19, 43, 8.5], [41, 43, 8.5], [19, 65, 8.5], [41, 65, 8.5]],
    7: [[15, 18, 7], [30, 23, 7], [45, 28, 7], [20, 51, 8], [40, 51, 8], [20, 68, 8], [40, 68, 8]],
    8: [[14.5, 27, 5], [24.8, 27, 5], [35.1, 27, 5], [45.4, 27, 5],
        [14.5, 59, 5], [24.8, 59, 5], [35.1, 59, 5], [45.4, 59, 5]],
    9: [[17, 22, 7.5], [30, 22, 7.5], [43, 22, 7.5], [17, 43, 7.5], [30, 43, 7.5], [43, 43, 7.5],
        [17, 64, 7.5], [30, 64, 7.5], [43, 64, 7.5]]
  };
  /* 条（索）竹节坐标表: [cx, cy] 竹节尺寸固定 */
  var STICK = {
    2: [[22, 32], [38, 32]],
    3: [[30, 22], [21, 58], [39, 58]],
    4: [[21, 26], [39, 26], [21, 60], [39, 60]],
    5: [[19, 22], [41, 22], [30, 43], [19, 64], [41, 64]],
    6: [[17, 24], [30, 24], [43, 24], [17, 62], [30, 62], [43, 62]],
    7: [[30, 15], [17, 46], [30, 46], [43, 46], [17, 70], [30, 70], [43, 70]],
    8: [[13, 30], [24, 30], [36, 30], [47, 30], [13, 58], [24, 58], [36, 58], [47, 58]],
    9: [[17, 20], [30, 20], [43, 20], [17, 43], [30, 43], [43, 43], [17, 66], [30, 66], [43, 66]]
  };

  function dot(cx, cy, r, color) {
    var inner = r > 9 ? r * 0.42 : r * 0.45;
    return '<circle cx="' + cx + '" cy="' + cy + '" r="' + r.toFixed(1) + '" fill="' + color + '"/>' +
      '<circle cx="' + cx + '" cy="' + cy + '" r="' + inner.toFixed(1) + '" fill="' + C.face + '"/>' +
      '<circle cx="' + cx + '" cy="' + cy + '" r="' + (inner * 0.5).toFixed(1) + '" fill="' + color + '"/>';
  }

  function stick(cx, cy, color, h) {
    h = h || 20;
    var w = 5.4, y = cy - h / 2;
    return '<rect x="' + (cx - w / 2).toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + w +
      '" height="' + h + '" rx="2.7" fill="' + color + '"/>' +
      '<rect x="' + (cx - w / 2).toFixed(1) + '" y="' + (y + h * 0.36).toFixed(1) + '" width="' + w +
      '" height="' + (h * 0.28).toFixed(1) + '" fill="' + C.face + '" opacity="0.35"/>';
  }

  function bird() {
    return '<g>' +
      '<path d="M30 34 C18 34 14 46 16 56 C18 68 24 72 30 76 C36 72 42 68 44 56 C46 46 42 34 30 34 Z" fill="' + C.green + '"/>' +
      '<ellipse cx="30" cy="26" rx="9" ry="8.5" fill="' + C.green + '"/>' +
      '<path d="M30 14 L39 21 L30 28 Z" fill="' + C.red + '"/>' +
      '<circle cx="26.5" cy="24" r="2" fill="' + C.face + '"/>' +
      '<circle cx="26.5" cy="24" r="1" fill="' + C.dark + '"/>' +
      '<path d="M20 48 C26 54 34 54 40 48 C38 60 30 64 30 64 C30 64 22 60 20 48 Z" fill="' + C.face + '" opacity="0.5"/>' +
      '<path d="M30 76 L22 82 L30 80 L38 82 Z" fill="' + C.red + '"/>' +
      '</g>';
  }

  function textTile(ch, color, size, y, family) {
    return '<text x="30" y="' + y + '" text-anchor="middle" font-size="' + size +
      '" font-family="' + (family || FONT) + '" font-weight="600" fill="' + color + '">' + ch + '</text>';
  }

  function content(t) {
    var rank, s;
    if (t < 9) {
      rank = t + 1;
      return textTile(T.CN_NUM[rank - 1], C.ink, 22, 36) +
        textTile('萬', C.red, 34, 72, FONT);
    }
    if (t < 18) {
      rank = t - 9 + 1;
      if (rank === 1) return bird();
      s = '';
      var list = STICK[rank] || [];
      for (var i = 0; i < list.length; i++) {
        var col = (rank === 5 && i === 2) ? C.red : ((rank === 7 && i === 0) ? C.red : C.green);
        var h = list.length > 6 ? 18 : 22;
        s += stick(list[i][0], list[i][1], col, h);
      }
      return s;
    }
    if (t < 27) {
      rank = t - 18 + 1;
      s = '';
      var dots = DOT[rank] || [];
      for (var j = 0; j < dots.length; j++) {
        var color = C.ink;
        if (rank === 1) color = C.red;
        else if (rank === 2) color = (j === 0 ? C.green : C.ink);
        else if (rank === 3) color = (j === 0 ? C.red : (j === 1 ? C.green : C.ink));
        else if (rank === 4) color = (j < 2 ? C.ink : C.green);
        else if (rank === 5) color = (j === 2 ? C.red : (j < 2 ? C.green : C.ink));
        else if (rank === 7) color = (j < 3 ? C.green : C.ink);
        else if (rank === 8) color = (j < 4 ? C.ink : C.green);
        s += dot(dots[j][0], dots[j][1], dots[j][2], color);
      }
      return s;
    }
    var honors = ['東', '南', '西', '北', '中', '發', '白'];
    var ch = honors[t - 27];
    if (ch === '中') return textTile('中', C.red, 38, 62);
    if (ch === '發') return textTile('發', C.green, 38, 62);
    if (ch === '白') {
      return '<rect x="13" y="17" width="34" height="50" rx="4" fill="none" stroke="' + C.ink +
        '" stroke-width="3.5"/>';
    }
    return textTile(ch, C.ink, 38, 62);
  }

  function flowerContent(t) {
    var label = ['春', '夏', '秋', '冬', '梅', '兰', '竹', '菊'][t - 34];
    var color = (t - 34) < 4 ? C.ink : C.green;
    if (label === '冬' || label === '菊') color = C.red;
    return textTile(label, color, 34, 52) +
      '<text x="30" y="70" text-anchor="middle" font-size="10" font-family="' + FONT +
      '" fill="#8a7f6a">花</text>';
  }

  /* 生成一张牌的 SVG */
  function tileSVG(t, opt) {
    opt = opt || {};
    var body = T.isFlower(t) ? flowerContent(t) : content(t);
    var num = '';
    if (opt.showNumber && t < 27) {
      var label = String(t < 9 ? t + 1 : (t < 18 ? t - 9 + 1 : t - 18 + 1));
      num = '<text x="52" y="79" text-anchor="end" font-size="11" font-family="system-ui,sans-serif" ' +
        'fill="#a89878">' + label + '</text>';
    }
    return '<svg viewBox="0 0 60 84" xmlns="http://www.w3.org/2000/svg" class="tile-svg">' +
      '<rect x="1" y="1" width="58" height="82" rx="7" fill="' + C.face + '" stroke="' + C.edge + '" stroke-width="2"/>' +
      '<rect x="4.5" y="4.5" width="51" height="75" rx="5" fill="none" stroke="' + C.shade + '" stroke-width="1"/>' +
      body + num + '</svg>';
  }

  /* 背面牌 */
  function backSVG() {
    return '<svg viewBox="0 0 60 84" xmlns="http://www.w3.org/2000/svg" class="tile-svg">' +
      '<rect x="1" y="1" width="58" height="82" rx="7" fill="#2f6f4f" stroke="#21503a" stroke-width="2"/>' +
      '<rect x="6" y="6" width="48" height="72" rx="5" fill="none" stroke="#4b9670" stroke-width="1.5"/>' +
      '</svg>';
  }

  var api = { tileSVG: tileSVG, backSVG: backSVG, COLORS: C };
  global.MJ = global.MJ || {};
  global.MJ.Render = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
