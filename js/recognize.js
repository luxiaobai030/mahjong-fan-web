/* 拍照识牌 —— 通过视觉大模型把照片转成牌谱
 * 走 OpenAI 兼容的 /chat/completions 接口，国内主流厂商基本都兼容，
 * 因此只要填「接口地址 + 模型名 + API Key」即可，Key 只存在浏览器本地。
 */
(function (global) {
  'use strict';
  var T = global.MJ.Tiles;

  var PROVIDERS = [
    { id: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o' },
    { id: 'dashscope', name: '阿里百炼 / 通义千问', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-vl-max' },
    { id: 'zhipu', name: '智谱 GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4v-plus' },
    { id: 'moonshot', name: '月之暗面 Kimi', baseUrl: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k-vision-preview' },
    { id: 'siliconflow', name: '硅基流动', baseUrl: 'https://api.siliconflow.cn/v1', model: 'Qwen/Qwen2.5-VL-72B-Instruct' },
    { id: 'ark', name: '火山方舟 / 豆包', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', model: 'doubao-1.5-vision-pro' },
    { id: 'stepfun', name: '阶跃星辰', baseUrl: 'https://api.stepfun.com/v1', model: 'step-1v-8k' },
    { id: 'gemini', name: 'Google Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-2.0-flash' },
    { id: 'custom', name: '自定义（OpenAI 兼容）', baseUrl: '', model: '' }
  ];

  var PROMPT = [
    '你是麻将牌识别助手。请仔细看这张照片，识别其中的麻将牌。',
    '',
    '牌面记号：',
    '- 万子：1m 2m … 9m（一万记作 1m）',
    '- 条子/索子：1s … 9s（一条记作 1s）',
    '- 饼子/筒子：1p … 9p（一饼、一筒都记作 1p）',
    '- 风牌：1z=东　2z=南　3z=西　4z=北',
    '- 三元牌：7z=中（红中）　6z=发（发财）　5z=白（白板）',
    '- 花牌：f1=春 f2=夏 f3=秋 f4=冬 f5=梅 f6=兰 f7=竹 f8=菊',
    '',
    '请只输出下面这个 JSON，不要任何额外文字、不要代码块围栏：',
    '{',
    '  "hand": ["1m","2m"],            // 立着的手牌，按画面从左到右顺序',
    '  "melds": [{"type":"pon","tile":"5m"}],  // 已亮出的副露；type 取 chi(顺子)/pon(刻子)/kan(明杠)/ankan(暗杠)',
    '  "winTile": "3s",               // 刚摸到或刚打出而和的那张牌，判断不了就填 null',
    '  "flowers": ["f1"],             // 花牌',
    '  "confidence": "high",          // high / medium / low',
    '  "notes": ""                    // 看不清或不确定的地方，用中文简述',
    '}'
  ].join('\n');

  /* 压缩图片，减小上传体积 */
  function compressImage(file, maxSize, quality) {
    maxSize = maxSize || 1400;
    quality = quality || 0.85;
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onerror = function () { reject(new Error('读取图片失败')); };
      reader.onload = function () {
        var img = new Image();
        img.onerror = function () { reject(new Error('图片解码失败')); };
        img.onload = function () {
          var w = img.width, h = img.height;
          var scale = Math.min(1, maxSize / Math.max(w, h));
          w = Math.round(w * scale); h = Math.round(h * scale);
          var canvas = document.createElement('canvas');
          canvas.width = w; canvas.height = h;
          var ctx = canvas.getContext('2d');
          ctx.fillStyle = '#fff';
          ctx.fillRect(0, 0, w, h);
          ctx.drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL('image/jpeg', quality));
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  function extractJSON(text) {
    if (!text) throw new Error('模型没有返回内容');
    var s = String(text).trim();
    // 去掉 ```json ... ``` 围栏
    var fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) s = fence[1].trim();
    var start = s.indexOf('{');
    var end = s.lastIndexOf('}');
    if (start < 0 || end <= start) throw new Error('模型返回的不是 JSON：' + s.slice(0, 120));
    return JSON.parse(s.slice(start, end + 1));
  }

  /* 把模型输出的记号规范化成内部结构 */
  function normalize(parsed) {
    var out = { hand: [], melds: [], winTile: null, flowers: [], confidence: parsed.confidence || '', notes: parsed.notes || '' };
    var bad = [];
    function toTile(v) {
      if (v === null || v === undefined || v === '') return null;
      var s = String(v).trim();
      var idx = T.fromCode(s);
      if (idx === undefined) idx = T.fromCode(s.toLowerCase());
      if (idx === undefined) {
        try { var arr = T.parse(s); if (arr.length === 1) idx = arr[0]; } catch (e) { idx = undefined; }
      }
      if (idx === undefined) { bad.push(s); return null; }
      return idx;
    }
    (parsed.hand || []).forEach(function (v) {
      var t = toTile(v);
      if (t === null) return;
      if (T.isFlower(t)) out.flowers.push(t);
      else out.hand.push(t);
    });
    (parsed.flowers || []).forEach(function (v) {
      var t = toTile(v);
      if (t !== null && T.isFlower(t)) out.flowers.push(t);
    });
    (parsed.melds || []).forEach(function (m) {
      if (!m) return;
      var t = toTile(m.tile !== undefined ? m.tile : m.tiles);
      if (t === null) return;
      var type = String(m.type || 'pon').toLowerCase();
      if (['chi', 'pon', 'kan', 'ankan'].indexOf(type) < 0) type = 'pon';
      out.melds.push({ type: type, tile: t });
    });
    var wt = toTile(parsed.winTile);
    if (wt !== null && !T.isFlower(wt)) out.winTile = wt;
    out.hand.sort(function (a, b) { return a - b; });
    out.badCodes = bad;
    return out;
  }

  /* 发请求：在 App（WebView 外壳）里走原生桥，不受浏览器 CORS 限制；
     在普通网页里退回 fetch。两者返回同样的 { ok, status, text }。 */
  var nativeSeq = 0;
  var nativePending = {};

  global.__mjNativeHttp = function (id, res) {
    var p = nativePending[id];
    if (!p) return;
    delete nativePending[id];
    if (res && res.ok) p.resolve({ ok: true, status: res.status, text: res.body || '' });
    else p.reject(new Error((res && res.error) ? res.error : '网络请求失败'));
  };

  function httpPost(url, headers, body) {
    if (global.MJNative && typeof global.MJNative.post === 'function') {
      return new Promise(function (resolve, reject) {
        var id = 'mj' + (++nativeSeq);
        nativePending[id] = { resolve: resolve, reject: reject };
        try {
          global.MJNative.post(id, url, JSON.stringify(headers), body);
        } catch (e) {
          delete nativePending[id];
          reject(e);
        }
      });
    }
    return fetch(url, { method: 'POST', headers: headers, body: body }).then(function (res) {
      return res.text().then(function (txt) {
        return { ok: res.ok, status: res.status, text: txt };
      });
    });
  }

  /* 调用视觉模型。images 为 data URL 数组；cfg = {baseUrl, apiKey, model} */
  function callVision(images, cfg) {
    var base = (cfg.baseUrl || '').replace(/\/+$/, '');
    if (!base) return Promise.reject(new Error('请先填写接口地址'));
    if (!cfg.apiKey) return Promise.reject(new Error('请先填写 API Key'));
    if (!cfg.model) return Promise.reject(new Error('请先填写模型名'));
    var url = base + '/chat/completions';
    var content = [{ type: 'text', text: PROMPT }];
    for (var i = 0; i < images.length; i++) {
      content.push({ type: 'image_url', image_url: { url: images[i] } });
    }
    var body = {
      model: cfg.model,
      messages: [{ role: 'user', content: content }],
      temperature: 0,
      max_tokens: 1200
    };
    return httpPost(url,
      { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + cfg.apiKey },
      JSON.stringify(body)
    ).then(function (res) {
      if (!res.ok) {
        var msg = res.text;
        try { var j = JSON.parse(res.text); if (j.error && j.error.message) msg = j.error.message; } catch (e) { /* 原样 */ }
        throw new Error('接口返回 ' + res.status + '：' + String(msg).slice(0, 300));
      }
      var data = JSON.parse(res.text);
      var choice = data.choices && data.choices[0];
      var text = choice && choice.message && choice.message.content;
      if (Array.isArray(text)) {
        text = text.map(function (p) { return p.text || ''; }).join('');
      }
      return normalize(extractJSON(text));
    });
  }

  /* 一键：文件 -> 压缩 -> 识别 */
  function recognizeFiles(files, cfg) {
    var arr = Array.prototype.slice.call(files).filter(function (f) {
      return f && /^image\//.test(f.type);
    });
    if (!arr.length) return Promise.reject(new Error('请选择图片文件'));
    return Promise.all(arr.map(function (f) { return compressImage(f); }))
      .then(function (imgs) { return callVision(imgs, cfg); });
  }

  var api = {
    PROVIDERS: PROVIDERS,
    PROMPT: PROMPT,
    compressImage: compressImage,
    extractJSON: extractJSON,
    normalize: normalize,
    callVision: callVision,
    recognizeFiles: recognizeFiles,
    httpPost: httpPost
  };
  global.MJ = global.MJ || {};
  global.MJ.Recognize = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
