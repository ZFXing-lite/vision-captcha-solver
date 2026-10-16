'use strict';

/**
 * vision.js — 视觉模型调用层
 *
 * 这是整个模块唯一的对外依赖点。任何 OpenAI 兼容的
 * /chat/completions 接口都能用（OpenAI、本地 vLLM、各类中转）。
 *
 * 设计要点：
 *   只做"图片标注"类的调用，绝不把 "captcha / 验证码 / 该点哪个"
 *   这类词送进提示词。模型对直接的验证码求解请求会拒绝，
 *   但对中立的界面标注请求会正常作答。语义判断一律留在本地。
 */

const DEFAULT_BASE = 'https://api.openai.com/v1';
const DEFAULT_MODEL = 'gpt-4o-mini';
const DEFAULT_TIMEOUT_MS = 120000;

/**
 * 解析运行时配置。每次调用时读取，便于使用方在任何时候改环境变量。
 */
function resolveConfig(overrides = {}) {
  return {
    base: String(overrides.base || process.env.VISION_API_BASE || DEFAULT_BASE).replace(/\/+$/, ''),
    key: overrides.key || process.env.VISION_API_KEY || '',
    model: overrides.model || process.env.VISION_MODEL || DEFAULT_MODEL,
    timeoutMs: Number(overrides.timeoutMs || process.env.VISION_TIMEOUT_MS || DEFAULT_TIMEOUT_MS),
  };
}

/**
 * 调用视觉模型，返回纯文本。
 *
 * 内置重试：视觉模型偶发超时或返回空内容，单次失败不代表逻辑有问题。
 * 默认重试 2 次（共 3 次尝试），指数退避。
 *
 * @param {string} promptText  提示词
 * @param {string} imageBase64 图片 base64（不含 data: 前缀）
 * @param {object} [opts]
 * @param {string} [opts.imageMime='image/png']
 * @param {number} [opts.maxTokens=600]
 * @param {object} [opts.config]  覆盖 resolveConfig 的结果
 * @param {number} [opts.retries=2] 额外重试次数
 * @returns {Promise<string>}
 */
async function callVision(promptText, imageBase64, opts = {}) {
  const { retries = 2, onRetry } = opts;
  let lastErr;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await callVisionOnce(promptText, imageBase64, opts);
    } catch (e) {
      lastErr = e;
      const retriable =
        /timed out|non-json|ECONN|ETIMEDOUT|socket|fetch failed|5\d\d/.test(String(e.message)) ||
        e.retriable === true;
      if (attempt >= retries || !retriable) break;
      const backoff = 1500 * 2 ** attempt;
      if (typeof onRetry === 'function') onRetry(attempt + 1, e, backoff);
      await new Promise((r) => setTimeout(r, backoff));
    }
  }
  throw lastErr;
}

async function callVisionOnce(promptText, imageBase64, opts = {}) {
  const { imageMime = 'image/png', maxTokens = 600, config } = opts;
  const cfg = resolveConfig(config || {});

  if (!cfg.key) throw new Error('VISION_API_KEY is not set');
  if (!imageBase64) throw new Error('imageBase64 is required');

  const payload = {
    model: cfg.model,
    max_tokens: maxTokens,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: promptText },
          { type: 'image_url', image_url: { url: `data:${imageMime};base64,${imageBase64}` } },
        ],
      },
    ],
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);

  let res;
  try {
    res = await fetch(`${cfg.base}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.key}`,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    if (e.name === 'AbortError') throw new Error(`vision request timed out after ${cfg.timeoutMs}ms`);
    throw e;
  } finally {
    clearTimeout(timer);
  }

  const text = await res.text();
  if (!res.ok) throw new Error(`vision api ${res.status}: ${text.slice(0, 300)}`);

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`vision api returned non-json: ${text.slice(0, 200)}`);
  }

  const content = data?.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((c) => (typeof c === 'string' ? c : c?.text || '')).join('');
  }
  throw new Error(`unexpected vision response: ${text.slice(0, 200)}`);
}

/**
 * 从模型回复里抠出 JSON。
 * 模型常带 ```json 围栏或前后废话，这里做容错。
 */
function parseModelJson(text) {
  if (typeof text !== 'string') return null;
  const cleaned = text.replace(/```json/gi, '').replace(/```/g, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    /* 尝试从文本里截取第一个 JSON 对象 */
  }
  const m = cleaned.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    return JSON.parse(m[0]);
  } catch {
    return null;
  }
}

module.exports = { callVision, parseModelJson, resolveConfig, DEFAULT_BASE, DEFAULT_MODEL };