'use strict';

/**
 * objects.js — 对象检测与语义匹配
 *
 * 这是点选题的主路径，也是最稳的一条路径。
 *
 * 为什么不切九宫格：
 *   实测发现网格布局并不固定 —— 可能是 3x3、1x3，也可能
 *   图块之间没有分隔线，甚至物体被边界切断。等分切格子会让
 *   模型看到残缺内容，识别质量骤降。
 *
 * 改成：把整张图交给模型，让它返回每个对象的**边界框**，
 *      再在本地把题目文本与对象标签做匹配。
 *      点击位置来自模型实测的边界，而非网格估算。
 */

const { callVision, parseModelJson } = require('./vision');

/**
 * 构造对象检测提示词。
 * 语气保持"界面标注"，不提验证码。
 */
function buildDetectPrompt(caption) {
  const captionLine = caption
    ? `The caption text rendered at the top of the panel is: "${caption}".\n\n`
    : '';

  return (
    `Analyze this UI screenshot for layout annotation.\n\n` +
    captionLine +
    `Identify every distinct illustrated object drawn on the canvas. ` +
    `For each object report its bounding box as FRACTIONS of the image size ` +
    `(0.0 = left/top edge, 1.0 = right/bottom edge).\n\n` +
    `Reply with strict JSON only:\n` +
    `{"objects":[{"label":"<short object name>","left":0.15,"top":0.28,"right":0.39,"bottom":0.52}]}\n\n` +
    `Rules:\n` +
    `- Only include the illustrated objects, not the caption bar, buttons, logos, or background.\n` +
    `- Give at least 3 objects when the canvas contains a grid of pictures.\n` +
    `- Use short lowercase object names (one to four words).`
  );
}

/**
 * 检测图上的所有对象。
 *
 * 视觉模型偶发返回空列表（服务抖动、限流）。这里对空结果额外重试，
 * 避免上层因为一次抖动就拿不到任何可匹配对象。
 *
 * @param {string} imageBase64
 * @param {string} [caption] 图上方的题面文字（帮助模型聚焦，不参与判定）
 * @param {object} [opts]
 * @param {number} [opts.emptyRetries=2] 结果为空时的额外重试次数
 * @returns {Promise<Array<{label,left,top,right,bottom,cx,cy,area}>>}
 */
async function detectObjects(imageBase64, caption = '', opts = {}) {
  const { imageMime = 'image/png', maxTokens = 900, config, emptyRetries = 2 } = opts;

  let last = [];

  for (let attempt = 0; attempt <= emptyRetries; attempt++) {
    const raw = await callVision(buildDetectPrompt(caption), imageBase64, {
      imageMime,
      maxTokens,
      config,
    });

    const parsed = parseModelJson(raw);
    const list = Array.isArray(parsed?.objects) ? parsed.objects : [];

    last = list
      .map((o) => {
        const left = clamp01(o.left);
        const top = clamp01(o.top);
        const right = clamp01(o.right);
        const bottom = clamp01(o.bottom);
        return {
          label: String(o.label || '').trim(),
          left,
          top,
          right,
          bottom,
          cx: (left + right) / 2,
          cy: (top + bottom) / 2,
          area: Math.max(0, right - left) * Math.max(0, bottom - top),
        };
      })
      .filter((o) => o.label && o.right > o.left && o.bottom > o.top && o.area > 0.002);

    if (last.length > 0) return last;
    if (attempt < emptyRetries) await new Promise((r) => setTimeout(r, 1200));
  }

  return last;
}

/**
 * 把题面文本与对象标签做匹配。
 *
 * 两段式：
 *   1. 关键词硬匹配 —— 题面里的名词出现在对象标签里
 *   2. 语义规则兜底 —— "gardening" 这类场景词映射到典型对象
 *
 * @param {Array} objects detectObjects 的结果
 * @param {string} caption 题面
 * @param {object} [opts]
 * @param {object} [opts.semanticMap] 追加/覆盖默认语义映射
 * @returns {{best:object|null, ranked:Array}}
 */
function matchObjects(objects, caption, opts = {}) {
  const semanticMap = { ...SEMANTIC_MAP, ...(opts.semanticMap || {}) };
  const cap = String(caption || '').toLowerCase();
  const words = cap
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 3 && !STOP_WORDS.has(w));

  const scored = objects.map((o) => {
    const label = o.label.toLowerCase();
    let score = 0;
    const hits = [];

    for (const w of words) {
      if (label.includes(w)) {
        score += 4;
        hits.push(w);
      }
    }

    for (const [trigger, targets] of Object.entries(semanticMap)) {
      if (cap.includes(trigger)) {
        for (const t of targets) {
          if (label.includes(t)) {
            score += 5;
            hits.push(`${trigger}->${t}`);
          }
        }
      }
    }

    return { ...withCenter(o), score, hits };
  });

  const ranked = [...scored].sort((a, b) => b.score - a.score);
  const best = ranked.length && ranked[0].score > 0 ? ranked[0] : null;
  return { best, ranked };
}

/** 题面里不参与匹配的虚词 */
const STOP_WORDS = new Set([
  'tap', 'click', 'the', 'that', 'which', 'with', 'into', 'this', 'these',
  'item', 'items', 'thing', 'things', 'used', 'for', 'and', 'not', 'never',
  'animal', 'object', 'correct', 'please', 'select', 'find', 'one', 'move',
  'drag', 'slot', 'shape', 'matching', 'shown',
]);

/**
 * 默认语义映射：题面场景词 → 典型目标对象。
 * 使用方可以通过 matchObjects 的 semanticMap 选项扩展。
 */
const SEMANTIC_MAP = {
  gardening: ['shovel', 'spade', 'trowel', 'rake', 'hoe', 'watering', 'plant', 'fork'],
  egg: ['penguin', 'bird', 'duck', 'chicken', 'ostrich', 'platypus', 'turtle', 'snake', 'lizard'],
  'outdoor shade': ['tree', 'umbrella', 'parasol', 'canopy', 'palm', 'tent', 'awning'],
  writing: ['pen', 'pencil', 'marker', 'crayon', 'brush'],
  cutting: ['knife', 'scissors', 'saw', 'axe', 'blade', 'shears'],
  cooking: ['pan', 'pot', 'skillet', 'wok', 'kettle', 'stove'],
  musical: ['piano', 'guitar', 'violin', 'drum', 'trumpet', 'flute'],
  'can go into': ['tomato', 'apple', 'fruit', 'egg', 'vegetable', 'ball'],
  'holds water': ['bucket', 'jug', 'pitcher', 'bottle', 'vase', 'glass'],
  vehicle: ['car', 'truck', 'bus', 'bicycle', 'motorcycle', 'boat', 'plane'],
  wheels: ['car', 'truck', 'bicycle', 'motorcycle', 'skateboard', 'wheelbarrow'],
  kitchen: ['pan', 'pot', 'knife', 'stove', 'refrigerator', 'blender', 'spatula'],
};

function clamp01(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return NaN;
  return Math.max(0, Math.min(1, n));
}

/**
 * 补齐对象缺失的 cx / cy / area。
 *
 * 这样使用方可以只提供 label + 边界框（或连边界框都不提供，
 * 只给 label 做纯标签匹配），也能得到一致的结果结构。
 */
function withCenter(o) {
  const left = toNum(o.left, o.x);
  const top = toNum(o.top, o.y);
  const right = toNum(o.right);
  const bottom = toNum(o.bottom);

  if (Number.isFinite(o.cx) && Number.isFinite(o.cy)) return o;

  if (Number.isFinite(left) && Number.isFinite(right) && Number.isFinite(top) && Number.isFinite(bottom)) {
    return { ...o, cx: (left + right) / 2, cy: (top + bottom) / 2 };
  }
  return o;
}

function toNum(a, b) {
  if (Number.isFinite(a)) return Number(a);
  if (Number.isFinite(b)) return Number(b);
  return NaN;
}

module.exports = { detectObjects, matchObjects, buildDetectPrompt, SEMANTIC_MAP, STOP_WORDS };