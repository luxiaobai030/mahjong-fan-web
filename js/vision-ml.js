/* 本地识牌：在浏览器里跑 YOLO（onnxruntime-web），不联网、不调任何 API。
 *
 * 权重来自 Mahjong-YOLO（MIT 许可，训练集是手机实拍麻将照片）：
 *   https://github.com/nikmomo/Mahjong-YOLO
 * 类别顺序取自作者的 inference_validation.py::get_class_names()。
 *
 * 两个必须记住的坑（踩过就不会再错）：
 *   1) 输入归一化是 -1..1（x / 127.5 - 1），不是常见的 0..1。
 *      用 0..1 时检测数会直接变成 0，而且不报错。
 *   2) 类别名写了 38 个，模型张量实际只有 37 类（YOLO 输出是 nc + 4 框）。
 *      UNKNOWN 只是作者脚本里的占位名，对不上任何一维，所以要按 37 个来映射。
 */
(function (global) {
  'use strict';

  /* 作者脚本里的 38 个名字去掉占位的 UNKNOWN 后的真实类别表 */
  var CLASSES = [
    '1m', '1p', '1s', '1z', '2m', '2p', '2s', '2z',
    '3m', '3p', '3s', '3z', '4m', '4p', '4s', '4z',
    '5m', '5p', '5s', '5z', '6m', '6p', '6s', '6z',
    '7m', '7p', '7s', '7z', '8m', '8p', '8s',
    '9m', '9p', '9s', '0m', '0p', '0s'
  ];

  var INPUT = 640;
  var MODEL_URL = '../vendor/yolos.onnx';
  var ORT_PATH = '../vendor/ort/ort.min.mjs';
  var WASM_PATH = '../vendor/ort/ort-wasm-simd-threaded.wasm';

  /* 动态 import() 和 WASM 路径都必须绝对化：浏览器不把相对路径当模块解析，
     file:// 直接打开时还会把盘符当成协议。
     基址必须是本脚本自己的地址（js/），不能用 location —— 那指向的是 HTML 页面。
     currentScript 只有在脚本同步执行期间有效，所以在这里抓住，之后异步再用就晚了。 */
  var SELF_HREF = (function () {
    var s = global.document && global.document.currentScript;
    if (s && s.src) return s.src;
    if (global.location) return global.location.href;
    return '';
  })();

  function absUrl(path) {
    return SELF_HREF ? new URL(path, SELF_HREF).href : path;
  }

  var ORT_URL = absUrl(ORT_PATH);
  var WASM_URL = absUrl(WASM_PATH);
  var MODEL_URL_ABS = absUrl(MODEL_URL);

  var state = { ort: null, session: null, loading: null };

  function loadOrt() {
    if (state.ort) return Promise.resolve(state.ort);
    if (state.loading) return state.loading;
    state.loading = import(ORT_URL).then(function (mod) {
      return mod;
    }).then(function (mod) {
      mod.env.wasm.wasmPaths = { wasm: WASM_URL };
      mod.env.wasm.numThreads = 1;
      state.ort = mod;
      return mod;
    });
    return state.loading;
  }

  function loadSession() {
    if (state.session) return Promise.resolve(state.session);
    return loadOrt().then(function (ort) {
      return ort.InferenceSession.create(MODEL_URL_ABS, {
        executionProviders: ['wasm'],
        graphOptimizationLevel: 'all'
      });
    }).then(function (s) {
      state.session = s;
      return s;
    });
  }

  /* 图片源（HTMLImageElement / ImageBitmap / canvas）按 640 方形 letterbox 缩放，
     返回 -1..1 的 NCHW 张量。 */
  function toTensor(ort, source, canvas) {
    var w = source.naturalWidth || source.width;
    var h = source.naturalHeight || source.height;
    if (!w || !h) throw new Error('图片尺寸读不出来');
    var r = INPUT / Math.max(w, h);
    var nw = Math.round(w * r), nh = Math.round(h * r);
    var px = Math.round((INPUT - nw) / 2), py = Math.round((INPUT - nh) / 2);
    canvas.width = INPUT; canvas.height = INPUT;
    var ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#727272';
    ctx.fillRect(0, 0, INPUT, INPUT);
    ctx.drawImage(source, px, py, nw, nh);
    var data = ctx.getImageData(0, 0, INPUT, INPUT).data;
    var out = new Float32Array(3 * INPUT * INPUT);
    var plane = INPUT * INPUT;
    var i, px4;
    for (i = 0; i < plane; i++) {
      px4 = i * 4;
      out[i] = data[px4] / 127.5 - 1;
      out[plane + i] = data[px4 + 1] / 127.5 - 1;
      out[plane * 2 + i] = data[px4 + 2] / 127.5 - 1;
    }
    return { tensor: new ort.Tensor('float32', out, [1, 3, INPUT, INPUT]), px: px, py: py, scale: r, w: w, h: h };
  }

  function iou(a, b) {
    var ix = Math.max(0, Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1));
    var iy = Math.max(0, Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1));
    var inter = ix * iy;
    var ua = (a.x2 - a.x1) * (a.y2 - a.y1) + (b.x2 - b.x1) * (b.y2 - b.y1) - inter;
    return ua > 0 ? inter / ua : 0;
  }

  /* 逐类别 NMS：同一张牌常被相邻格子重复框出来，按类合并压掉重框。 */
  function nms(list, thr) {
    var out = [];
    list.slice().sort(function (a, b) { return b.score - a.score; }).forEach(function (d) {
      for (var i = 0; i < out.length; i++) {
        if (out[i].cls === d.cls && iou(out[i], d) > thr) return;
      }
      out.push(d);
    });
    return out;
  }

  function recognize(source, opts) {
    opts = opts || {};
    var conf = opts.conf == null ? 0.25 : opts.conf;
    var canvas = document.createElement('canvas');
    return loadSession().then(function (session) {
      var pack = toTensor(state.ort, source, canvas);
      var feed = {};
      feed[session.inputNames[0]] = pack.tensor;
      return session.run(feed).then(function (res) {
        var out = res[session.outputNames[0]];
        var dim = out.dims;
        var attrs = dim[dim.length - 2];
        var anchors = dim[dim.length - 1];
        var d = out.data;
        var nc = attrs - 4;
        var dets = [];
        var best = [];
        var a, t, ci, sc, top, cx, cy, bw, bh, x1, y1, x2, y2;
        for (t = 0; t < anchors; t++) {
          best.length = 0;
          for (ci = 0; ci < nc; ci++) {
            /* 前 4 个属性是边框 cx,cy,w,h，类别分数从第 5 个属性开始，
               从 0 开始读会把坐标当成分数。 */
            sc = d[(ci + 4) * anchors + t];
            if (sc >= conf) best.push([sc, ci]);
          }
          if (!best.length) continue;
          best.sort(function (a2, b2) { return b2[0] - a2[0]; });
          a = best[0];
          top = a[0]; ci = a[1];
          cx = d[0 * anchors + t]; cy = d[1 * anchors + t];
          bw = d[2 * anchors + t]; bh = d[3 * anchors + t];
          x1 = (cx - bw / 2 - pack.px) / pack.scale;
          y1 = (cy - bh / 2 - pack.py) / pack.scale;
          x2 = (cx + bw / 2 - pack.px) / pack.scale;
          y2 = (cy + bh / 2 - pack.py) / pack.scale;
          dets.push({ cls: ci, tile: CLASSES[ci] || '?', score: top, x1: x1, y1: y1, x2: x2, y2: y2 });
        }
        var kept = nms(dets, opts.iou == null ? 0.45 : opts.iou);
        kept.sort(function (p, q) { return p.x1 - q.x1; });
        /* 掉出画面外的框丢掉 */
        kept = kept.filter(function (p) {
          return p.x2 > 0 && p.y2 > 0 && p.x1 < pack.w && p.y1 < pack.h;
        });
        return { tiles: kept, imageWidth: pack.w, imageHeight: pack.h };
      });
    });
  }

  function preloaded() {
    return !!state.session;
  }

  global.MJ = global.MJ || {};
  global.MJ.VisionML = {
    CLASSES: CLASSES,
    recognize: recognize,
    loadSession: loadSession,
    preloaded: preloaded
  };
})(typeof self !== 'undefined' ? self : this);
