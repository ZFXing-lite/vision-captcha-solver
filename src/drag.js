'use strict';

/**
 * drag.js — 拖拽/匹配类题型的求解
 *
 * 适用题面：
 *   "Drag the correct animal into its outline"
 *   "Move the correct vial into the empty slot matching its shape"
 *
 * 与点选题的差别：需要返回**起点和终点两个坐标**，
 * 由调用方执行拖拽动作（本模块不做浏览器操作）。
 */

const { callVision, parseModelJson } = require('./vision');

function buildDragPrompt() {
  return (
    `Analyze this interface screenshot for layout annotation.\n\n` +
    `The screen contains:\n` +
    `- one or more draggable object tiles (usually along one edge), each a small picture\n` +
    `- a target slot or outline shape drawn on the main area\n\n` +
    `Report positions as FRACTIONS of the image size (0.0 = left/top edge, 1.0 = right/bottom edge), ` +
    `using the CENTER of each element.\n\n` +
    `Return strict JSON:\n` +
    `{\n` +
    `  "candidates": [{"index":0,"label":"<what the object is>","x":0.12,"y":0.55}],\n` +
    `  "target": {"label":"<what the outline depicts>","x":0.55,"y":0.45},\n` +
    `  "matchIndex": <index of the candidate whose object belongs in the target, or -1>\n` +
    `}\n` +
    `If a field cannot be determined, use null. Output JSON only.`
  );
}

/**
 * 分析一张拖拽题画面。
 *
 * 拖拽题比点选题脆弱 —— 模型偶尔会返回空的 candidates。
 * 这里对"空结果"额外重试，避免单次抖动导致上层拿到无用结果。
 *
 * @param {string} imageBase64
 * @param {object} [opts]
 * @param {number} [opts.emptyRetries=2] 结果为空时的额外重试次数
 * @returns {Promise<{candidates:Array,target:object|null,matchIndex:number,chosen:object|null}>}
 */
async function analyzeDragTask(imageBase64, opts = {}) {
  const { imageMime = 'image/png', maxTokens = 800, config, emptyRetries = 2 } = opts;

  let last = null;

  for (let attempt = 0; attempt <= emptyRetries; attempt++) {
    const raw = await callVision(buildDragPrompt(), imageBase64, { imageMime, maxTokens, config });
    const parsed = parseModelJson(raw);

    const candidates = Array.isArray(parsed?.candidates)
      ? parsed.candidates
          .map((c) => ({
            index: Number(c.index),
            label: String(c.label || '').trim(),
            x: toUnit(c.x),
            y: toUnit(c.y),
          }))
          .filter((c) => Number.isFinite(c.x) && Number.isFinite(c.y))
      : [];

    const target =
      parsed?.target && Number.isFinite(toUnit(parsed.target.x)) && Number.isFinite(toUnit(parsed.target.y))
        ? {
            label: String(parsed.target.label || '').trim(),
            x: Number(parsed.target.x),
            y: Number(parsed.target.y),
          }
        : null;

    let matchIndex = Number.isInteger(parsed?.matchIndex) ? parsed.matchIndex : -1;

    // 模型没给匹配索引时，退回到本地标签匹配
    if ((matchIndex < 0 || !candidates.some((c) => c.index === matchIndex)) && target) {
      matchIndex = matchByLabel(candidates, target.label);
    }

    const chosen = candidates.find((c) => c.index === matchIndex) || null;
    last = { candidates, target, matchIndex, chosen, raw };

    // 拿到了可用结果就返回，否则再试一次
    if (candidates.length > 0 && target) return last;
    if (attempt < emptyRetries) await new Promise((r) => setTimeout(r, 1200));
  }

  return last;
}

/**
 * 本地兜底：按标签词元重叠挑候选。
 */
function matchByLabel(candidates, targetLabel) {
  if (!targetLabel) return -1;
  const t = String(targetLabel).toLowerCase();
  let best = -1;
  let bestScore = 0;

  for (const c of candidates) {
    const l = String(c.label).toLowerCase();
    let score = 0;
    if (t && l && (t.includes(l) || l.includes(t))) score += 3;
    for (const w of t.split(/\s+/)) {
      if (w.length > 3 && l.includes(w)) score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      best = c.index;
    }
  }
  return bestScore > 0 ? best : -1;
}

function toUnit(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return NaN;
  if (n < 0) return 0;
  if (n > 1) return Math.min(n, 1);
  return n;
}

module.exports = { analyzeDragTask, matchByLabel, buildDragPrompt };