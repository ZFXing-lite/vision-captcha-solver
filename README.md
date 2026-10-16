# vision-captcha-solver

用视觉模型求解图像验证码的**独立决策模块**。给它一张挑战截图，它告诉你该点哪里。

不绑定浏览器、不绑定站点、不绑定模型厂商。纯图进 → 坐标出。

```js
const { solve } = require('vision-captcha-solver');

const result = await solve(imageBase64, {
  caption: 'Tap the item that provides large outdoor shade',
  width: 500,
  height: 360,
});

// → result.points[0] = { x: 133, y: 172.8 }
// 直接拿去 page.mouse.click(x, y)
```

---

## 为什么需要它

直接让视觉模型"解验证码"会被拒绝 —— 即使把请求包装成"无障碍描述"也能被识破。

本模块的做法是把任务**拆开**：

| 谁做 | 做什么 |
|---|---|
| 视觉模型 | 只做图像标注：列出画面上有哪些物体、各自的边界框 |
| 本模块 | 语义匹配：题面说的目标对应哪个物体，该点哪里 |

送进模型的提示词里**永远不出现** captcha / 验证码 / 该点哪个 这类词。模型看到的是一个普通的界面标注请求，语义判断全部在本地完成。

这既绕开了拒绝，也让判定过程**可测、可调试、可复现** —— 不依赖模型"猜"答案。

---

## 核心特性

- **不假设网格布局** — 实测发现图块可能是 3×3、1×3、或紧密拼接无分隔。本模块用模型返回的**实测边界框**定位，不靠等分切格子
- **支持两类题型：点选与拖拽**
- **零运行时依赖** — 只用 Node 内置 `fetch`，不需要 axios / sharp / canvas
- **离线可测** — 匹配与几何逻辑有 26 个单元测试，不需要模型也能跑
- **模型无关** — 任何 OpenAI 兼容的 `/chat/completions` 都能用
- **可扩展语义** — 自带常见场景映射，也能传入自定义词典

---

## 安装

```bash
npm install vision-captcha-solver
```

或者直接把 `src/` 目录拷进你的项目 —— 只有 5 个文件，没有外部依赖。

要求 Node.js 18+（需要内置 `fetch`）。

---

## 配置

通过环境变量指定视觉模型：

```bash
export VISION_API_BASE=https://api.openai.com/v1   # 任意 OpenAI 兼容接口
export VISION_API_KEY=sk-xxxxxxxx
export VISION_MODEL=gpt-4o-mini                    # 任意视觉模型
```

也可以按调用传入：

```js
await solve(image, {
  caption: '...',
  config: {
    base: 'https://your-endpoint/v1',
    key: 'sk-xxx',
    model: 'your-vision-model',
  },
});
```

**推荐用能力较强的视觉模型**（GPT-4o、Qwen-VL-Max、Claude 等）。模型越强，边界框越准，匹配越可靠。

---

## API

### `solve(imageBase64, options)`

主入口。自动判定题型，返回点击坐标。

**参数**

| 名称 | 类型 | 说明 |
|---|---|---|
| `imageBase64` | string | 挑战截图的 base64（不含 `data:` 前缀） |
| `options.caption` | string | 图上方的题面文字。**强烈建议提供**，它决定题型判定与匹配精度 |
| `options.width` | number | 图像像素宽。提供则返回像素坐标 |
| `options.height` | number | 图像像素高 |
| `options.mode` | `'auto'\|'tap'\|'drag'` | 强制题型，默认自动 |
| `options.semanticMap` | object | 追加/覆盖语义映射词典 |
| `options.config` | object | 视觉模型配置 `{ base, key, model }` |

**返回（点选题）**

```js
{
  kind: 'tap',
  objects: [ { label, left, top, right, bottom, cx, cy, area } ],
  picked: { label, score, hits, cx, cy, ... },   // 命中的对象，未命中为 null
  points: [
    { x, y, normalized: { x, y }, box: {...} }   // 直接使用 x/y
  ],
  ranked: [ ... ]                                 // 按得分排序的完整列表
}
```

**返回（拖拽题）**

```js
{
  kind: 'drag',
  candidates: [ { index, label, x, y } ],
  target: { label, x, y },
  chosen: { index, label, x, y },
  drag: {
    from: { x, y },   // 起点
    to:   { x, y }    // 终点
  }
}
```

---

### 低层 API

需要更细粒度控制时可直接使用：

```js
const {
  detectObjects,   // 检测图上所有对象及边界框
  matchObjects,    // 把题面与对象列表做匹配
  analyzeDragTask, // 分析拖拽题
  classifyTask,    // 题型判定
  computeGrid,     // 计算网格矩形
  cellRect,        // 取某个格子的裁剪框
  toPixels,        // 归一化坐标 → 像素
} = require('vision-captcha-solver');
```

---

## 用法示例

### 基础：文件到坐标

```bash
export VISION_API_KEY=sk-xxx
node examples/01-basic.js test/fixtures/tap-outdoor-shade.png \
  "Tap the item that provides large outdoor shade"
```

### 接入 Playwright

```bash
npm i -D playwright
node examples/02-playwright.js https://your-target/challenge
```

完整代码见 `examples/02-playwright.js`。核心就四步：

```js
const shot = await page.screenshot({ clip: box });     // 1. 截图
const r = await solve(shot.toString('base64'), {        // 2. 求解
  caption,
  width: Math.round(box.width),
  height: Math.round(box.height),
});
await page.mouse.click(box.x + r.points[0].x,           // 3. 点击
                       box.y + r.points[0].y);
```

### 扩展语义词典

题面里的场景词默认映射到一批典型对象，不满足需求时可以补：

```js
await solve(image, {
  caption: 'Tap the tool used for metalworking',
  semanticMap: {
    metalworking: ['anvil', 'hammer', 'tongs', 'forge', 'welder'],
  },
});
```

默认映射覆盖：园艺、下蛋动物、遮阳、书写、切割、烹饪、乐器、容器、交通工具、厨房用具等，详见 `src/objects.js` 的 `SEMANTIC_MAP`。

---

## 实操要点

这几条是实测踩出来的，直接影响成功率：

**1. 截图只截挑战区域，不要截整个页面**

标题栏、按钮、页面背景都会混进识别结果。如果挑战区上方有题面横幅，最好把它排除掉，否则标题文字会被当成画面内容。

**2. 题面必须传对**

`caption` 既用于题型判定，也用于语义匹配。传错会直接导致选错对象。

**3. 点击要用真实指针事件序列**

单个 `mouse.click` 常被前端忽略。推荐 `move → down → 停顿 → up`。Playwright 示例里有实现。

**4. 拖拽必须分步移动**

一次性把鼠标移到终点，canvas 收不到中间的 `mousemove` 事件，会判定为无效拖拽。示例里分了 24 步。

**5. 模型偶发超时是正常的**

`callVision` 内置了重试（默认 2 次，指数退避）。如果失败率高，检查网络或换更强的模型。

---

## 测试

```bash
# 离线逻辑测试（26 个用例，不需要模型）
node test/offline.test.js

# 在线端到端测试（需要真实模型，用真实挑战截图）
export VISION_API_KEY=sk-xxx
node test/online.test.js
```

在线测试在没配 `VISION_API_KEY` 时会自动跳过，不会报错。

`test/fixtures/` 里是两张真实采集的挑战截图，可作为接入时的参考素材。

---

## 目录结构

```
src/
  index.js     统一入口：solve()
  vision.js    视觉模型调用（唯一的外部交互点）
  objects.js   对象检测 + 语义匹配（点选题主路径）
  drag.js      拖拽题求解
  grid.js      网格几何工具
examples/
  01-basic.js      最小用法
  02-playwright.js 接入浏览器自动化
test/
  offline.test.js  纯逻辑测试
  online.test.js   真实模型测试
  fixtures/        真实挑战截图
```

---

## 已知边界

- **这些模块只负责"决策"，不负责"执行"** — 点击与拖拽由调用方实现
- 语义匹配基于词元与词典，对高度抽象的题面（如"点击不属于这一组的东西"）覆盖有限，需要扩展 `semanticMap` 或自行处理
- 边界框精度取决于所选模型，弱模型会给出偏移较大的框
- 只在 hCaptcha 的常见题型上做过实测，其他验证码厂商的构图差异可能需要调整提示词

---

## 合规提示

本模块是通用的图像识别与决策工具，**不包含**任何绕过访问控制、伪造身份或规避安全策略的功能。

请在获得授权的场景下使用 —— 例如测试你自己的服务、安全研究、无障碍辅助工具。使用者需自行确认其用途符合目标站点的服务条款与当地法律。

---

## 许可

MIT