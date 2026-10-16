'use strict';

/**
 * 在线测试 —— 真实调用视觉模型，用真实挑战截图验证端到端。
 *
 * 需要环境变量：
 *   VISION_API_BASE   例：https://api.openai.com/v1
 *   VISION_API_KEY
 *   VISION_MODEL      例：gpt-4o-mini / qwen-vl-max / 你自建的模型
 *
 * 运行：node test/online.test.js
 * 跳过：不设 VISION_API_KEY 时自动跳过（退出码 0）
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { solve, detectObjects, analyzeDragTask } = require('../src');

const FIXTURES = path.join(__dirname, 'fixtures');

function img(name) {
  return fs.readFileSync(path.join(FIXTURES, name)).toString('base64');
}

function hasImage(name) {
  return fs.existsSync(path.join(FIXTURES, name));
}

let pass = 0;
let fail = 0;
let skipped = 0;

async function check(name, fn) {
  try {
    await fn();
    console.log(`  ok   ${name}`);
    pass++;
  } catch (e) {
    console.log(`  FAIL ${name}\n       ${e.message}`);
    fail++;
  }
}

function skip(name) {
  console.log(`  skip ${name}`);
  skipped++;
}

(async () => {
  if (!process.env.VISION_API_KEY) {
    console.log('\n未设置 VISION_API_KEY —— 跳过在线测试');
    console.log('（离线逻辑测试请运行：node test/offline.test.js）\n');
    process.exit(0);
  }

  console.log(`\n模型：${process.env.VISION_MODEL || '(默认)'}`);
  console.log(`接口：${process.env.VISION_API_BASE || '(默认)'}\n`);

  /* ---------------------------------------------------------------- */
  console.log('[点选题 — 真实挑战截图]');
  /* ---------------------------------------------------------------- */

  // 这张图的实际题面是 "Tap the item that provides large outdoor shade"，
  // 画面上是 3x3 网格：笔、铅笔、钥匙、松树、意面、吸管等，正确答案是松树。
  if (hasImage('tap-outdoor-shade.png')) {
    await check('户外遮阳题 → 命中 pine tree 且坐标在图内', async () => {
      const b64 = img('tap-outdoor-shade.png');
      const r = await solve(b64, {
        caption: 'Tap the item that provides large outdoor shade',
        width: 500,
        height: 360,
      });

      assert.strictEqual(r.kind, 'tap', '题型判定错误');
      assert.ok(r.objects.length > 0, '未检测到任何对象');
      assert.ok(r.picked, '未匹配到对象');
      assert.ok(
        /tree|umbrella|parasol|canopy|palm|tent|awning/i.test(r.picked.label),
        `匹配结果不是遮阳物：${r.picked.label}`,
      );
      assert.ok(r.points.length === 1, '应返回一个点击点');
      assert.ok(r.points[0].x >= 0 && r.points[0].x <= 500, `x 越界: ${r.points[0].x}`);
      assert.ok(r.points[0].y >= 0 && r.points[0].y <= 360, `y 越界: ${r.points[0].y}`);

      console.log(`       识别 ${r.objects.length} 个对象，命中 "${r.picked.label}"`);
      console.log(`       点击坐标 (${r.points[0].x.toFixed(1)}, ${r.points[0].y.toFixed(1)})`);
    });
  } else {
    skip('tap-outdoor-shade.png（缺少素材）');
  }

  /* ---------------------------------------------------------------- */
  console.log('\n[拖拽题 — 真实挑战截图]');
  /* ---------------------------------------------------------------- */

  // 这张图的实际题面是 "Move the correct vial into the empty slot matching its shape"
  if (hasImage('drag-vial.png')) {
    await check('拖拽题 → 返回 from/to 两点', async () => {
      const b64 = img('drag-vial.png');
      const r = await solve(b64, {
        caption: 'Move the correct vial into the empty slot matching its shape',
        width: 500,
        height: 470,
      });

      assert.strictEqual(r.kind, 'drag', '题型判定错误');
      assert.ok(r.candidates.length >= 1, '未识别到候选对象');
      assert.ok(r.target, '未识别到目标槽位');
      assert.ok(r.drag, '未生成拖拽坐标');

      const { from, to } = r.drag;
      for (const [n, p] of [['from', from], ['to', to]]) {
        assert.ok(p.x >= 0 && p.x <= 500, `${n}.x 越界: ${p.x}`);
        assert.ok(p.y >= 0 && p.y <= 470, `${n}.y 越界: ${p.y}`);
      }

      console.log(`       候选 ${r.candidates.length} 个，目标 "${r.target.label}"`);
      console.log(`       拖拽 (${from.x.toFixed(0)},${from.y.toFixed(0)}) → (${to.x.toFixed(0)},${to.y.toFixed(0)})`);
    });
  } else {
    skip('drag-vial.png（缺少素材）');
  }

  /* ---------------------------------------------------------------- */
  console.log('\n[接口契约]');
  /* ---------------------------------------------------------------- */

  await check('detectObjects 返回结构完整', async () => {
    if (!hasImage('tap-outdoor-shade.png')) throw new Error('缺少素材');
    const objs = await detectObjects(img('tap-outdoor-shade.png'), 'test');
    assert.ok(Array.isArray(objs), '应返回数组');
    for (const o of objs) {
      assert.ok(typeof o.label === 'string' && o.label, 'label 缺失');
      assert.ok(Number.isFinite(o.cx) && Number.isFinite(o.cy), 'cx/cy 缺失');
      assert.ok(o.left >= 0 && o.right <= 1, '归一化坐标越界');
    }
  });

  await check('analyzeDragTask 返回结构完整', async () => {
    if (!hasImage('drag-vial.png')) throw new Error('缺少素材');
    const r = await analyzeDragTask(img('drag-vial.png'));
    assert.ok(Array.isArray(r.candidates), 'candidates 应为数组');
    assert.ok(Number.isInteger(r.matchIndex), 'matchIndex 应为整数');
  });

  /* ---------------------------------------------------------------- */
  console.log(`\n结果：${pass} 通过，${fail} 失败，${skipped} 跳过\n`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => {
  console.error('测试运行异常：', e);
  process.exit(1);
});