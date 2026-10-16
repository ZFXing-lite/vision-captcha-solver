'use strict';

/**
 * index.js — 统一入口
 *
 * 一行调用完成"从截图到该点哪里"的完整决策。
 * 不依赖任何浏览器，纯函数式：图进 → 坐标出。
 *
 * ── 快速开始 ──────────────────────────────────────────
 *
 *   const { solve } = require('vision-captcha-solver');
 *
 *   const result = await solve(imageBase64, {
 *     caption: 'Click on the thing used for gardening',
 *     width: 500,
 *     height: 470,
 *   });
 *
 *   // result.kind === 'tap'
 *   // result.points[0] → { x: 231.5, y: 198.2 }   直接点击
 *   // result.points[0] → { normalized: {x,y}, ratio }
 *
 * ── 拖拽题 ────────────────────────────────────────────
 *
 *   result.kind === 'drag'
 *   result.drag → { from: {x,y}, to: {x,y} }       执行拖拽
 *
 * ── 题型判定 ──────────────────────────────────────────
 *
 *   有 caption → 按 caption 的动词判定（drag / move into → 拖拽）
 *   无 caption → 自动探测（拖拽题画面有 "Move" 手柄与槽位轮廓）
 */

const { detectObjects, matchObjects } = require('./objects');
const { analyzeDragTask } = require('./drag');
const { computeGrid, cellRect, toPixels } = require('./grid');
const { resolveConfig } = require('./vision');

/**
 * 题型判定。
 * @param {string} caption 题面文字
 * @returns {'tap'|'drag'}
 */
function classifyTask(caption) {
  const t = String(caption || '').toLowerCase();
  if (/\bdrag\b/.test(t)) return 'drag';
  if (/\bmove\b.*\b(into|to)\b/.test(t)) return 'drag';
  if (/\bslot\b/.test(t)) return 'drag';
  if (/\boutline\b/.test(t)) return 'drag';
  return 'tap';
}

/**
 * 主求解函数。
 *
 * @param {string} imageBase64 挑战截图的 base64（不含 data: 前缀）
 * @param {object} [opts]
 * @param {string} [opts.caption]    题面文字，强烈建议提供（决定题型与匹配精度）
 * @param {number} [opts.width]      图像像素宽（提供则返回像素坐标）
 * @param {number} [opts.height]     图像像素高
 * @param {'auto'|'tap'|'drag'} [opts.mode='auto'] 强制题型，默认自动
 * @param {object} [opts.semanticMap] 扩展语义映射
 * @param {object} [opts.config]     视觉模型配置覆盖 { base, key, model }
 * @returns {Promise<object>}
 */
async function solve(imageBase64, opts = {}) {
  const {
    caption = '',
    width,
    height,
    mode = 'auto',
    semanticMap,
    config,
    imageMime = 'image/png',
  } = opts;

  if (!imageBase64) throw new Error('solve: imageBase64 is required');

  const kind = mode === 'auto' ? classifyTask(caption) : mode;
  const callOpts = { imageMime, config };

  if (kind === 'drag') {
    const analysis = await analyzeDragTask(imageBase64, callOpts);
    const out = {
      kind: 'drag',
      caption,
      candidates: analysis.candidates,
      target: analysis.target,
      chosen: analysis.chosen,
      raw: analysis.raw,
    };

    if (analysis.chosen && analysis.target) {
      out.drag = {
        from: unitPoint(analysis.chosen.x, analysis.chosen.y, width, height),
        to: unitPoint(analysis.target.x, analysis.target.y, width, height),
      };
    }
    return out;
  }

  // 点选题：对象检测 + 语义匹配
  const objects = await detectObjects(imageBase64, caption, callOpts);
  const { best, ranked } = matchObjects(objects, caption, { semanticMap });

  const out = {
    kind: 'tap',
    caption,
    objects,
    ranked,
    picked: best || null,
    points: [],
  };

  if (best) {
    out.points.push(unitPoint(best.cx, best.cy, width, height));
    // 命中的边界框，便于调用方绘制调试框
    out.points[0].box = { left: best.left, top: best.top, right: best.right, bottom: best.bottom };
  }

  return out;
}

/**
 * 生成一个坐标对象，同时给出归一化值与像素值。
 */
function unitPoint(nx, ny, width, height) {
  const p = { normalized: { x: nx, y: ny }, ratio: nx };
  if (Number.isFinite(width) && Number.isFinite(height)) {
    const px = toPixels(nx, ny, width, height);
    p.x = px.x;
    p.y = px.y;
  } else {
    p.x = nx;
    p.y = ny;
  }
  return p;
}

module.exports = {
  solve,
  classifyTask,
  detectObjects,
  matchObjects,
  analyzeDragTask,
  computeGrid,
  cellRect,
  toPixels,
  resolveConfig,
};