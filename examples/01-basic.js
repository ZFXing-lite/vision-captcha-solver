'use strict';

/**
 * 示例 1：最小用法 —— 从图片文件到点击坐标
 *
 * 运行：
 *   export VISION_API_KEY=sk-xxx
 *   node examples/01-basic.js test/fixtures/tap-outdoor-shade.png "Tap the item that provides large outdoor shade"
 */

const fs = require('fs');
const { solve } = require('../src');

async function main() {
  const [file, caption] = process.argv.slice(2);

  if (!file) {
    console.error('用法：node examples/01-basic.js <图片路径> [题面文字]');
    process.exit(1);
  }

  const imageBase64 = fs.readFileSync(file).toString('base64');

  // 图片尺寸。实际使用时从你的截图工具拿，
  // 或者用 sharp/jimp 读；这里为了零依赖用命令行传入。
  const width = Number(process.env.IMG_W || 500);
  const height = Number(process.env.IMG_H || 360);

  const result = await solve(imageBase64, { caption, width, height });

  console.log('题型:', result.kind);

  if (result.kind === 'tap') {
    console.log('识别到对象:', result.objects.length);
    for (const o of result.objects) {
      console.log(`  - ${o.label}`);
    }
    console.log();

    if (!result.picked) {
      console.log('未匹配到目标对象');
      return;
    }

    console.log('命中:', result.picked.label);
    console.log('边界框:', JSON.stringify(result.picked.box || {
      left: result.picked.left,
      top: result.picked.top,
      right: result.picked.right,
      bottom: result.picked.bottom,
    }));

    const p = result.points[0];
    console.log();
    console.log(`>>> 点击坐标: (${p.x.toFixed(1)}, ${p.y.toFixed(1)})`);
    console.log(`    归一化:   (${p.normalized.x}, ${p.normalized.y})`);
  } else {
    console.log('候选:', result.candidates.map((c) => c.label).join(' | '));
    console.log('目标:', result.target && result.target.label);
    console.log();
    if (result.drag) {
      console.log(`>>> 从 (${result.drag.from.x.toFixed(0)}, ${result.drag.from.y.toFixed(0)})`);
      console.log(`    拖到 (${result.drag.to.x.toFixed(0)}, ${result.drag.to.y.toFixed(0)})`);
    }
  }
}

main().catch((e) => {
  console.error('错误:', e.message);
  process.exit(1);
});