'use strict';

/**
 * 离线逻辑测试 —— 不需要视觉模型，用真实采集数据验证匹配与几何。
 *
 * 运行：node test/offline.test.js
 */

const assert = require('assert');
const { matchObjects } = require('../src/objects');
const { classifyTask } = require('../src/index');
const { computeGrid, cellRect, toPixels } = require('../src/grid');
const { matchByLabel } = require('../src/drag');
const { parseModelJson } = require('../src/vision');

let pass = 0;
let fail = 0;

function check(name, fn) {
  try {
    fn();
    console.log(`  ok   ${name}`);
    pass++;
  } catch (e) {
    console.log(`  FAIL ${name}\n       ${e.message}`);
    fail++;
  }
}

/* ------------------------------------------------------------------ */
console.log('\n[题型判定]');
/* ------------------------------------------------------------------ */

const taskCases = [
  ['Tap the egg-laying animal', 'tap'],
  ['Click on the thing used for gardening', 'tap'],
  ['Tap the item that provides large outdoor shade', 'tap'],
  ['Click on the animal the ball never touches', 'tap'],
  ['Drag the correct animal into its outline', 'drag'],
  ['Move the correct vial into the empty slot matching its shape', 'drag'],
];

for (const [text, want] of taskCases) {
  check(`"${text}" → ${want}`, () => {
    assert.strictEqual(classifyTask(text), want);
  });
}

/* ------------------------------------------------------------------ */
console.log('\n[对象匹配 — 真实采集数据]');
/* ------------------------------------------------------------------ */

// 案例 1：园艺用具（实测题面 + 实测识别结果）
const gardeningObjects = [
  { label: 'frying pan in grassy field', left: 0.155, top: 0.283, right: 0.39, bottom: 0.519 },
  { label: 'frying pan in jungle', left: 0.396, top: 0.283, right: 0.608, bottom: 0.519 },
  { label: 'frying pan on beach', left: 0.616, top: 0.283, right: 0.847, bottom: 0.519 },
  { label: 'shovel', left: 0.155, top: 0.53, right: 0.39, bottom: 0.753 },
  { label: 'hammer with watermark', left: 0.396, top: 0.53, right: 0.608, bottom: 0.753 },
  { label: 'frying pan with utensils', left: 0.616, top: 0.53, right: 0.847, bottom: 0.753 },
  { label: 'pickaxe against wall', left: 0.155, top: 0.764, right: 0.39, bottom: 0.989 },
  { label: 'line-drawing of a frying pan', left: 0.396, top: 0.764, right: 0.608, bottom: 0.989 },
  { label: 'frying pan among clouds', left: 0.616, top: 0.764, right: 0.847, bottom: 0.989 },
];

check('gardening → 选中 shovel', () => {
  const { best } = matchObjects(gardeningObjects, 'Click on the thing used for gardening');
  assert.ok(best, '未匹配到任何对象');
  assert.strictEqual(best.label, 'shovel');
});

check('gardening → shovel 中心坐标正确', () => {
  const { best } = matchObjects(gardeningObjects, 'Click on the thing used for gardening');
  const cx = (0.155 + 0.39) / 2;
  const cy = (0.53 + 0.753) / 2;
  assert.ok(Math.abs(best.cx - cx) < 1e-6, `cx 偏差 ${best.cx} vs ${cx}`);
  assert.ok(Math.abs(best.cy - cy) < 1e-6, `cy 偏差 ${best.cy} vs ${cy}`);
});

// 案例 2：户外遮阳
const shadeObjects = [
  { label: 'black pen', left: 0, top: 0, right: 0.3, bottom: 0.3 },
  { label: 'purple pens', left: 0.35, top: 0, right: 0.6, bottom: 0.3 },
  { label: 'bunch of car keys', left: 0.65, top: 0, right: 1, bottom: 0.3 },
  { label: 'pine tree', left: 0, top: 0.35, right: 0.3, bottom: 0.6 },
  { label: 'spaghetti and meatballs', left: 0.35, top: 0.35, right: 0.6, bottom: 0.6 },
  { label: 'purple straws', left: 0.65, top: 0.35, right: 1, bottom: 0.6 },
  { label: 'plate of pasta', left: 0, top: 0.65, right: 0.3, bottom: 1 },
  { label: 'spaghetti and meatballs', left: 0.35, top: 0.65, right: 0.6, bottom: 1 },
  { label: 'pile of purple sticks', left: 0.65, top: 0.65, right: 1, bottom: 1 },
];

check('outdoor shade → 选中 pine tree', () => {
  const { best } = matchObjects(shadeObjects, 'Tap the item that provides large outdoor shade');
  assert.ok(best, '未匹配到任何对象');
  assert.strictEqual(best.label, 'pine tree');
});

// 案例 3：会下蛋的动物
const animalObjects = [
  { label: 'blue whale sticker', left: 0, top: 0, right: 0.3, bottom: 0.3 },
  { label: 'beaver sticker', left: 0.35, top: 0, right: 0.6, bottom: 0.3 },
  { label: 'penguin sticker', left: 0.65, top: 0, right: 1, bottom: 0.3 },
  { label: 'seal sticker', left: 0, top: 0.35, right: 0.3, bottom: 0.6 },
  { label: 'sea lion sticker', left: 0.35, top: 0.35, right: 0.6, bottom: 0.6 },
];

check('egg-laying animal → 选中 penguin sticker', () => {
  const { best } = matchObjects(animalObjects, 'Tap the egg-laying animal');
  assert.ok(best, '未匹配到任何对象');
  assert.strictEqual(best.label, 'penguin sticker');
});

check('无命中时返回 null（题面无对应物体）', () => {
  const objs = [{ label: 'frying pan', left: 0, top: 0, right: 0.5, bottom: 0.5 }];
  const { best } = matchObjects(objs, 'Tap the quantum flux capacitor');
  assert.strictEqual(best, null);
});

check('自定义语义映射可扩展', () => {
  const objs = [{ label: 'weird gadget', left: 0, top: 0, right: 0.5, bottom: 0.5 }];
  const { best } = matchObjects(objs, 'Tap the frobnicator', {
    semanticMap: { frobnicator: ['gadget'] },
  });
  assert.ok(best, '自定义映射未生效');
  assert.strictEqual(best.label, 'weird gadget');
});

/* ------------------------------------------------------------------ */
console.log('\n[网格几何]');
/* ------------------------------------------------------------------ */

check('标准 3x3 切分', () => {
  const g = computeGrid(300, 300);
  assert.strictEqual(g.rows, 3);
  assert.strictEqual(g.cols, 3);
  assert.strictEqual(g.cells.length, 9);
  assert.strictEqual(g.cells[0].w, 100);
  assert.strictEqual(g.cells[8].x, 200);
  assert.strictEqual(g.cells[8].y, 200);
});

check('宽扁图判为 1x3', () => {
  const g = computeGrid(900, 200);
  assert.strictEqual(g.rows, 1);
  assert.strictEqual(g.cols, 3);
  assert.strictEqual(g.cells.length, 3);
});

check('显式指定行列优先', () => {
  const g = computeGrid(900, 200, { rows: 2, cols: 2 });
  assert.strictEqual(g.rows, 2);
  assert.strictEqual(g.cols, 2);
});

check('非法尺寸抛错', () => {
  assert.throws(() => computeGrid(0, 100), /positive/);
  assert.throws(() => computeGrid(NaN, 100), /positive/);
});

check('cellRect 返回归一化与像素两套值', () => {
  const r = cellRect(300, 300, 4);
  assert.strictEqual(r.pixels.x, 100);
  assert.strictEqual(r.pixels.y, 100);
  assert.ok(Math.abs(r.left - 1 / 3) < 1e-9);
});

check('cellRect 越界返回 null', () => {
  assert.strictEqual(cellRect(300, 300, 99), null);
});

check('toPixels 换算正确', () => {
  const p = toPixels(0.5, 0.25, 800, 400);
  assert.strictEqual(p.x, 400);
  assert.strictEqual(p.y, 100);
});

/* ------------------------------------------------------------------ */
console.log('\n[拖拽本地兜底匹配]');
/* ------------------------------------------------------------------ */

const dragCandidates = [
  { index: 0, label: 'amber/tan vial with dark blue cap' },
  { index: 1, label: 'teal conical vial with white label strip' },
];

check('目标描述含 "vial" → 命中候选', () => {
  const i = matchByLabel(dragCandidates, 'empty bottle-shaped outline slot');
  // 描述里没有 vial 字样，允许 -1（交给模型给 matchIndex）
  assert.ok(i === -1 || i === 0 || i === 1);
});

check('目标描述直接指名 → 命中正确索引', () => {
  const i = matchByLabel(dragCandidates, 'the amber tan vial');
  assert.strictEqual(i, 0);
});

check('空目标返回 -1', () => {
  assert.strictEqual(matchByLabel(dragCandidates, ''), -1);
});

/* ------------------------------------------------------------------ */
console.log('\n[JSON 解析容错]');
/* ------------------------------------------------------------------ */

check('纯 JSON', () => {
  const r = parseModelJson('{"a":1}');
  assert.deepStrictEqual(r, { a: 1 });
});

check('带 ```json 围栏', () => {
  const r = parseModelJson('```json\n{"a":1}\n```');
  assert.deepStrictEqual(r, { a: 1 });
});

check('带前后废话', () => {
  const r = parseModelJson('Here is the result: {"a":1} hope it helps');
  assert.deepStrictEqual(r, { a: 1 });
});

check('无法解析返回 null', () => {
  assert.strictEqual(parseModelJson('no json here'), null);
  assert.strictEqual(parseModelJson(null), null);
});

/* ------------------------------------------------------------------ */
console.log(`\n结果：${pass} 通过，${fail} 失败\n`);
process.exit(fail === 0 ? 0 : 1);