'use strict';

/**
 * 示例 2：接入 Playwright —— 完整自动化闭环
 *
 * 演示如何把本模块嵌进一个真实的浏览器自动化流程：
 *   截图 → solve() → 执行点击/拖拽
 *
 * 这只是一个参考实现。你可以把同样的几个步骤嵌进
 * Puppeteer / Selenium / CDP / 你自己的框架。
 *
 * 安装额外依赖：
 *   npm i -D playwright
 *
 * 运行：
 *   export VISION_API_KEY=sk-xxx
 *   node examples/02-playwright.js https://example.com/challenge
 */

const { solve } = require('../src');

async function main() {
  const url = process.argv[2];
  if (!url) {
    console.error('用法：node examples/02-playwright.js <页面URL>');
    process.exit(1);
  }

  let chromium;
  try {
    ({ chromium } = require('playwright'));
  } catch {
    console.error('需要先安装 playwright：npm i -D playwright && npx playwright install chromium');
    process.exit(1);
  }

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();

  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });

    // ── 1. 定位挑战所在的区域（按你的目标站点调整选择器）──────
    const target = await page.$('iframe[src*="challenge"]');
    if (!target) throw new Error('未找到挑战 iframe，请按目标站点调整选择器');

    const frame = await target.contentFrame();
    if (!frame) throw new Error('无法获取 iframe 内容');

    const box = await target.boundingBox();
    if (!box) throw new Error('iframe 不可见');

    // ── 2. 读题面 ────────────────────────────────────────────
    const caption = await frame
      .evaluate(() => {
        const el = document.querySelector('.prompt-text') || document.querySelector('h2');
        return el ? el.innerText.trim() : '';
      })
      .catch(() => '');

    console.log('题面:', caption || '(空)');

    // ── 3. 截图并求解 ────────────────────────────────────────
    // 只截挑战可视区，不要带页面其他部分，避免干扰识别。
    const shot = await page.screenshot({ clip: box });
    const result = await solve(shot.toString('base64'), {
      caption,
      width: Math.round(box.width),
      height: Math.round(box.height),
    });

    console.log('题型:', result.kind);

    // ── 4. 执行 ──────────────────────────────────────────────
    if (result.kind === 'tap') {
      if (!result.points.length) {
        console.log('未得出点击目标');
        return;
      }
      const p = result.points[0];
      console.log(`点击 "${result.picked.label}" @ (${p.x.toFixed(0)}, ${p.y.toFixed(0)})`);

      // 用真实指针事件序列，单个 click 常被前端忽略
      await humanClick(page, box.x + p.x, box.y + p.y);
    } else {
      if (!result.drag) {
        console.log('未得出拖拽路径');
        return;
      }
      const { from, to } = result.drag;
      console.log(
        `拖拽 (${from.x.toFixed(0)}, ${from.y.toFixed(0)}) → (${to.x.toFixed(0)}, ${to.y.toFixed(0)})`,
      );
      await drag(page, box.x + from.x, box.y + from.y, box.x + to.x, box.y + to.y);
    }

    await page.waitForTimeout(3000);
  } finally {
    await browser.close();
  }
}

/** 更接近真人的点击：move → down → 小幅停顿 → up */
async function humanClick(page, x, y) {
  await page.mouse.move(x, y);
  await page.waitForTimeout(80);
  await page.mouse.down();
  await page.waitForTimeout(70);
  await page.mouse.up();
}

/**
 * 拖拽：必须分步移动。
 * 一次性 move 到终点，canvas 收不到中间事件，会判定为无效拖拽。
 */
async function drag(page, x1, y1, x2, y2, steps = 24) {
  await page.mouse.move(x1, y1);
  await page.waitForTimeout(150);
  await page.mouse.down();
  await page.waitForTimeout(200);

  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    await page.mouse.move(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t);
    await page.waitForTimeout(18);
  }

  await page.waitForTimeout(200);
  await page.mouse.up();
}

main().catch((e) => {
  console.error('错误:', e.message);
  process.exit(1);
});