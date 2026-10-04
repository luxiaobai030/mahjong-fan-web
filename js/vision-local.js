/* 本地切图：不联网、不调模型，把照片里的牌一行一张切出来交给用户点选 */
(function (global) {
  'use strict';

  /* ---------- 纯算法部分（可在 Node 里单测） ---------- */

  function grayscale(rgba, w, h) {
    var out = new Uint8Array(w * h);
    for (var i = 0, p = 0; i < out.length; i++, p += 4) {
      out[i] = (rgba[p] * 299 + rgba[p + 1] * 587 + rgba[p + 2] * 114) / 1000 | 0;
    }
    return out;
  }

  function histogram(gray) {
    var hist = new Int32Array(256);
    for (var i = 0; i < gray.length; i++) hist[gray[i]]++;
    return hist;
  }

  /* 大津法：取前景/背景两类均值的中点（用原灰度当阈值会把背景算进前景） */
  function otsu(gray) {
    var hist = histogram(gray), total = gray.length;
    var sum = 0, i;
    for (i = 0; i < 256; i++) sum += i * hist[i];
    var sumB = 0, wB = 0, best = -1, thr = 128;
    for (i = 0; i < 256; i++) {
      wB += hist[i];
      if (!wB) continue;
      var wF = total - wB;
      if (!wF) break;
      sumB += i * hist[i];
      var mB = sumB / wB, mF = (sum - sumB) / wF;
      var between = wB * wF * (mB - mF) * (mB - mF);
      if (between > best) { best = between; thr = (mB + mF) / 2; }
    }
    return thr;
  }

  /* 画面四周多半是桌面/背景，用它的明暗判断牌是偏亮还是偏暗 */
  function borderMean(gray, w, h) {
    var sum = 0, n = 0, x, y;
    for (x = 0; x < w; x += 2) {
      sum += gray[x] + gray[(h - 1) * w + x];
      n += 2;
    }
    for (y = 0; y < h; y += 2) {
      sum += gray[y * w] + gray[y * w + w - 1];
      n += 2;
    }
    return n ? sum / n : 0;
  }

  function buildMask(gray, w, h, thr, bright) {
    var mask = new Uint8Array(w * h);
    for (var i = 0; i < mask.length; i++) {
      mask[i] = (bright ? gray[i] > thr : gray[i] <= thr) ? 1 : 0;
    }
    return mask;
  }

  /* 每列在整幅图里「最长连续前景」的高度。
     牌是竖立的长条，牌的白底处能连成整段；牌面暗纹会把它打断，
     牌缝/桌面则整列都是背景。所以这一列的连续高度是「像不像牌」的直接证据，
     比单纯统计前景点数稳得多：暗纹让点数掉一半，但连续高度只掉一点。 */
  function columnRuns(mask, w, h) {
    var out = new Int32Array(w), x, y;
    for (x = 0; x < w; x++) {
      var best = 0, cur = 0;
      for (y = 0; y < h; y++) {
        if (mask[y * w + x]) { cur++; if (cur > best) best = cur; }
        else cur = 0;
      }
      out[x] = best;
    }
    return out;
  }

  /* 保边滤波：只修孤立噪点，缝隙再窄也不动。
     牌缝常常只有 1~2 像素，均值或中值都会把它抹平，
     所以这里只在左右明显更低、只有自己高时才替换。
     radius 传 0 就是完全不滤波——colLen 剖面本身通常已经足够干净。 */
  function smoothProf(prof, n, radius) {
    var out = new Float64Array(n), x, i;
    var radius2 = Math.max(0, radius);
    if (!radius2) { for (x = 0; x < n; x++) out[x] = prof[x]; return out; }
    for (x = 0; x < n; x++) {
      var v = prof[x], lo = v, hi = v;
      for (i = Math.max(0, x - radius2); i <= Math.min(n - 1, x + radius2); i++) {
        if (i === x) continue;
        if (prof[i] < lo) lo = prof[i];
        if (prof[i] > hi) hi = prof[i];
      }
      var span = Math.max(1, hi - lo);
      out[x] = (v - lo) < span * 0.35 && (hi - v) > span * 0.35 ? (lo + hi) / 2 : v;
    }
    return out;
  }

  function median(list) {
    if (!list.length) return 0;
    var s = list.slice().sort(function (a, b) { return a - b; });
    return s[s.length >> 1];
  }

  /* 把剖面上 >= thr 的连续区间切出来，可以只在一段范围内找 */
  function thresholdRuns(prof, n, thr, from, to) {
    var out = [], st = -1, i;
    from = from === undefined ? 0 : from;
    to = to === undefined ? n - 1 : to;
    for (i = from; i <= to; i++) {
      if (prof[i] >= thr) { if (st < 0) st = i; }
      else if (st >= 0) { out.push({ x0: st, x1: i - 1 }); st = -1; }
    }
    if (st >= 0) out.push({ x0: st, x1: to });
    return out;
  }

  /* 闭运算：先膨胀 bridge 像素再腐蚀 bridge 像素，
     把宽度不超过 bridge 的谷补上，但比 bridge 宽的缝原样保留。 */
  function closeRuns(prof, n, thr, bridge) {
    var out = new Float64Array(n), x, d;
    /* 膨胀：只要左右 bridge 像素内有前景，这一列就算前景。
       之后不再腐蚀回去——我们要的是「把牌内部的暗纹连成一片」，
       腐蚀只会把刚补上的边缘又削掉，那正是之前失效的原因。 */
    for (x = 0; x < n; x++) {
      var on = 0;
      for (d = -bridge; d <= bridge; d++) {
        var xx = x + d;
        if (xx >= 0 && xx < n && prof[xx] >= thr) { on = 1; break; }
      }
      out[x] = on ? Math.max(prof[x], thr) : 0;
    }
    return out;
  }

  function tightenVertically(mask, w, y0, y1, r) {
    var colW = r.x1 - r.x0 + 1;
    var need = Math.max(2, colW * 0.25);
    var top = -1, bottom = -1;
    for (var y = y0; y <= y1; y++) {
      var c = 0;
      for (var x = r.x0; x <= r.x1; x++) if (mask[y * w + x]) c++;
      if (c >= need) { if (top < 0) top = y; bottom = y; }
    }
    r.y0 = top < 0 ? y0 : top;
    r.y1 = top < 0 ? y1 : bottom;
    return r;
  }

  function analyze(gray, w, h, opts) {
    opts = opts || {};
    var thr = otsu(gray);
    var bright = borderMean(gray, w, h) <= thr;
    var mask = buildMask(gray, w, h, thr, bright);
    var x, y, i;

    var colLen = columnRuns(mask, w, h);
    /* 默认不滤波：colLen 剖面的谷就是牌缝本身，任何横向滤波都会把
       1~2 像素的窄缝抹平，反而把整排牌连成一段。 */
    var prof = smoothProf(colLen, w, opts.smooth || 0);
    var maxCol = 0;
    for (x = 0; x < w; x++) if (prof[x] > maxCol) maxCol = prof[x];
    if (maxCol < 4) return { ok: false, reason: 'empty' };

    /* 第一阶段：先用形态学闭运算把一张牌并成一个区。
       一张牌的剖面是「亮的倒角边 - 暗的牌面纹 - 亮的倒角边」，
       单独按高度切会把一张牌劈成两半；闭运算的桥宽按整排的常见牌宽估计，
       远小于牌缝，所以只会把同一张牌内部的暗纹补上，不会跨过缝。 */
    /* 桥宽。牌的剖面是「亮倒角边 - 暗牌面纹 - 亮倒角边」，光按高度切会把
       一张牌劈成两半，所以要用闭运算把牌内部的暗纹补上。
       关键是分清两种谷：牌面暗纹虽然低，但仍是前景；牌缝则整列都没有前景。
       所以先看谷底的绝对高度，明显高于 0 的算暗纹（要桥接），
       贴地的算真牌缝（不能碰），桥宽按暗纹谷来定。 */
    var highs = thresholdRuns(prof, w, maxCol * 0.55);
    var lows = [], floorThr = Math.max(1, maxCol * 0.06);
    for (i = 1; i < highs.length; i++) {
      var g0 = highs[i - 1].x1 + 1, g1 = highs[i].x0 - 1;
      if (g1 <= g0) continue;
      var floorV = 0;
      for (x = g0; x <= g1; x++) if (prof[x] > floorV) floorV = prof[x];
      if (floorV >= floorThr) lows.push(g1 - g0 + 1);
    }
    /* 一张牌的剖面是「亮倒角边 - 暗牌面纹 - 亮倒角边」，按高度切会劈成两半，
       所以要用闭运算把牌内部的暗纹桥接起来。桥宽逐档试：
       桥太窄时牌被劈开（区数偏高），桥够宽时暗纹补上（区数回落到真实牌数），
       再加宽就跨过牌缝（区数掉到 1，那肯定不是一手牌）。
       所以扫描时记住区数第一次下降后的值，只要它保持不变就采纳，一旦再变就停手。
       没有暗纹谷说明牌是纯色的，高段本身就是一张张牌，这时不该桥接——
       否则 1 像素的窄缝会被填上，整排反而连成一块。 */
    var zones;
    var bestBridge = 0;
    if (!lows.length) {
      zones = highs;
      bestBridge = 0;
    } else {
      var maxBridge = Math.max(2, median(lows));
      var startN = 0, settledN = -1, bridge;
      for (bridge = 1; bridge <= maxBridge; bridge++) {
        var cand = thresholdRuns(closeRuns(prof, w, maxCol * 0.55, bridge), w, 1);
        if (!cand.length) continue;
        if (!startN) { startN = cand.length; zones = cand; continue; }
        if (settledN < 0) {
          if (cand.length === startN) continue;
          /* 跨过牌缝时几张牌会并成一块，区宽会远超「一张牌 + 暗纹」的宽度。
             一张牌最多也就「亮边 + 暗纹 + 亮边」那么宽，所以拿这个当上限：
             区宽超过它就说明跨缝了，没超过就是正常把一张牌接起来。 */
          var nowW = 0;
          for (i = 0; i < cand.length; i++) nowW += cand[i].x1 - cand[i].x0 + 1;
          nowW /= cand.length;
          var tileW = median(lows) * 2 + median(highs.map(function (r) { return r.x1 - r.x0 + 1; }));
          if (cand.length <= 1 || nowW > tileW * 1.6) break;
          settledN = cand.length; zones = cand; bestBridge = bridge;
        } else if (cand.length !== settledN) {
          break;
        }
      }
    }
    if (!zones) zones = highs;
    if (!zones.length) return { ok: false, reason: 'no-column' };

    /* 第二阶段：每个区就是一张牌，只把两端外扩到背景上的空列削掉。
       区内部一律保留——按点数再切一刀只会把牌面暗纹当成断点，
       这正是之前反复切错的原因。 */
    var colCount = new Int32Array(w), cx, cy, k;
    for (cx = 0; cx < w; cx++) {
      var m = 0;
      for (cy = 0; cy < h; cy++) m += mask[cy * w + cx];
      colCount[cx] = m;
    }
    /* 相邻两区中间就是牌缝，所以边界取两区端点的中点。
       闭运算把每个区撑出去桥宽那么多，区本身已经盖到了缝上，
       直接拿区边界会偏到旁边的牌上去。中点附近再找真正的空列，
       有空列就用空列正中，没有就用中点，这样边界正好压在缝上。 */
    var rawRuns = [], lo, hi;
    for (k = 0; k < zones.length; k++) {
      lo = zones[k].x0;
      /* 纯色牌（没有暗纹）时区边界本来就是牌的边界，别再加工 */
      if (!lows.length) { rawRuns.push({ x0: lo, x1: zones[k].x1 }); continue; }
      /* 闭运算把每个区向两侧各撑了桥宽，所以右邻区的左缘要减去桥宽
         才是牌缝的位置；最后一张则直接用区尾减去桥宽。 */
      hi = (k + 1 < zones.length)
        ? (bestBridge ? zones[k + 1].x0 - bestBridge : Math.round((zones[k].x1 + zones[k + 1].x0) / 2))
        : zones[k].x1;
      if (k + 1 < zones.length) {
        var a0 = zones[k].x1, a1 = zones[k + 1].x0, ga = a0, gb2 = a1;
        while (ga <= gb2 && colCount[ga] > 0) ga++;
        while (gb2 >= ga && colCount[gb2] > 0) gb2--;
        if (gb2 >= ga) hi = Math.min(hi, Math.round((ga + gb2) / 2));
      }
      if (hi <= lo) continue;
      rawRuns.push({ x0: lo, x1: hi });
    }
    /* 闭运算把最左边的区也往左撑了桥宽那么多，第一张牌会凭空多出一截。
       这里按选中的桥宽把它收回去。 */
    if (rawRuns.length && bestBridge > 0) {
      rawRuns[0].x0 = Math.min(rawRuns[0].x0 + bestBridge, rawRuns[0].x1);
    }
    if (!rawRuns.length) return { ok: false, reason: 'no-column' };

    /* 太窄的段是噪点或牌缝残留，按中位宽过滤 */
    var widths = rawRuns.map(function (r) { return r.x1 - r.x0 + 1; });
    var med = median(widths) || 0;
    if (med < 3) return { ok: false, reason: 'no-column' };
    var cols = rawRuns.filter(function (r) { return (r.x1 - r.x0 + 1) >= Math.max(3, med * 0.55); });
    if (!cols.length) return { ok: false, reason: 'no-column' };

    /* 每张牌在它自己的列范围内求上下沿 */
    for (i = 0; i < cols.length; i++) tightenVertically(mask, w, 0, h - 1, cols[i]);

    var ty = h, by = -1;
    for (i = 0; i < cols.length; i++) {
      if (cols[i].y0 < ty) ty = cols[i].y0;
      if (cols[i].y1 > by) by = cols[i].y1;
    }
    if (by < ty) return { ok: false, reason: 'no-column' };

    /* 置信度：宽度是否整齐、缝隙是否够深、张数是否像一手牌。
       桌面照片常常切出一堆宽度不一的碎片，这时宁可让用户手填张数重切，
       也不要给出一堆错位的图让他一张张点。 */
    var w2 = cols.map(function (r) { return r.x1 - r.x0 + 1; });
    var mean = 0;
    for (i = 0; i < w2.length; i++) mean += w2[i];
    mean /= w2.length;
    var varr = 0;
    for (i = 0; i < w2.length; i++) varr += (w2[i] - mean) * (w2[i] - mean);
    var cv = mean ? Math.sqrt(varr / w2.length) / mean : 1;

    var gapDepth = 1;
    for (i = 1; i < cols.length; i++) {
      var g = maxCol, t;
      for (t = cols[i - 1].x1 + 1; t <= cols[i].x0 - 1; t++) if (prof[t] < g) g = prof[t];
      gapDepth = Math.min(gapDepth, maxCol ? g / maxCol : 1);
    }
    if (cols.length < 2) gapDepth = 0;

    var cover = 0;
    for (i = 0; i < w2.length; i++) cover += w2[i];
    cover /= Math.max(1, cols[cols.length - 1].x1 - cols[0].x0 + 1);

    var confidence = (1 - Math.min(1, cv * 1.6)) * (0.35 + 0.65 * (1 - Math.min(1, gapDepth / 0.55)));
    if (cols.length < 3 || cols.length > 20) confidence *= 0.4;
    if (cover > 0.95) confidence *= 0.5;

    var box = { x0: cols[0].x0, x1: cols[cols.length - 1].x1, y0: ty, y1: by };

    return {
      ok: true,
      thr: thr,
      bright: bright,
      cols: cols,
      box: box,
      band: { y0: ty, y1: by },
      confidence: Math.max(0, Math.min(1, confidence)),
      stats: { count: cols.length, cv: cv, gapDepth: gapDepth, cover: cover, medWidth: med },
      w: w,
      h: h
    };
  }

  function splitEven(box, n) {
    var out = [], span = box.x1 - box.x0 + 1, i;
    for (i = 0; i < n; i++) {
      out.push({
        x0: Math.round(box.x0 + span * i / n),
        x1: Math.round(box.x0 + span * (i + 1) / n) - 1,
        y0: box.y0,
        y1: box.y1
      });
    }
    return out;
  }

  function padRect(r, pad, w, h) {
    return {
      x0: Math.max(0, r.x0 - pad),
      y0: Math.max(0, r.y0 - pad),
      x1: Math.min(w - 1, r.x1 + pad),
      y1: Math.min(h - 1, r.y1 + pad)
    };
  }

  /* ---------- 浏览器部分 ---------- */

  function loadImage(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () { resolve({ img: img, url: url }); };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('图片解码失败')); };
      img.src = url;
    });
  }

  function analyzeFile(file, opts) {
    opts = opts || {};
    var maxWidth = opts.maxWidth || 720;
    return loadImage(file).then(function (o) {
      var img = o.img;
      var iw = img.naturalWidth || img.width;
      var ih = img.naturalHeight || img.height;
      var scale = Math.min(1, maxWidth / iw);
      var w = Math.max(1, Math.round(iw * scale));
      var h = Math.max(1, Math.round(ih * scale));
      var cv = document.createElement('canvas');
      cv.width = w;
      cv.height = h;
      var cx = cv.getContext('2d');
      cx.drawImage(img, 0, 0, w, h);
      var data = cx.getImageData(0, 0, w, h).data;
      var res = analyze(grayscale(data, w, h), w, h, opts);
      res.scale = scale;
      res.img = img;
      res.url = o.url;
      return res;
    });
  }

  function cropDataUrl(img, rect, scale, outH) {
    outH = outH || 104;
    var s = 1 / (scale || 1);
    var sw = (rect.x1 - rect.x0 + 1) * s;
    var sh = (rect.y1 - rect.y0 + 1) * s;
    var cv = document.createElement('canvas');
    cv.height = outH;
    cv.width = Math.max(1, Math.round(outH * sw / Math.max(1, sh)));
    cv.getContext('2d').drawImage(img, rect.x0 * s, rect.y0 * s, sw, sh, 0, 0, cv.width, cv.height);
    return cv.toDataURL('image/jpeg', 0.82);
  }

  global.MJ = global.MJ || {};
  global.MJ.VisionLocal = {
    grayscale: grayscale,
    otsu: otsu,
    borderMean: borderMean,
    columnRuns: columnRuns,
    smoothProf: smoothProf,
    thresholdRuns: thresholdRuns,
    closeRuns: closeRuns,
    analyze: analyze,
    splitEven: splitEven,
    padRect: padRect,
    loadImage: loadImage,
    analyzeFile: analyzeFile,
    cropDataUrl: cropDataUrl
  };
})(typeof window !== 'undefined' ? window : globalThis);
