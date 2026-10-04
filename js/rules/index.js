/* 规则注册表 —— 顺序即 UI 中的展示顺序 */
(function (global) {
  'use strict';
  var R = global.MJ.Rules;
  var list = [R.mcr, R.riichi, R.sichuan, R.guangdong, R.taiwan, R.hongkong].filter(Boolean);
  R.list = list;
  R.byId = {};
  for (var i = 0; i < list.length; i++) R.byId[list[i].id] = list[i];

  /* 把规则的默认配置和用户选择合并成 buildContext 需要的 options */
  R.optionsFor = function (rule, userOpts) {
    var o = { needSets: rule.needSets || 4 };
    for (var k in (rule.opts || {})) o[k] = rule.opts[k];
    for (var k2 in (userOpts || {})) o[k2] = userOpts[k2];
    return o;
  };
})(typeof window !== 'undefined' ? window : globalThis);

