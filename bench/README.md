# 基准设施 · PLAN-2026-1001-C（大文件性能与移动端）

> **「没有基准数据前不开始优化」** —— 这是 PLAN-C 的硬规矩。
> 本目录只做测量：不改动 `txt-reader.html` 一行代码。

## 快速开始

```bash
# 1) 生成样本（固定种子，逐字节可复现；样本约 42MB，已被 .gitignore 忽略）
node bench/gen-samples.js

# 2) 跑基准
node bench/run.js --label baseline                  # 全部样本 → bench/out/
node bench/run.js --rows 10000,100000               # 只跑指定档
node bench/run.js --label optimized                 # 优化后对比

# 3) 固化基线快照（结果入 bench/baseline/，会入库）
node bench/run.js --rows 10000,100000,500000 --label baseline --outdir bench/baseline
```

## 为什么不用 `--dump-dom` + `--virtual-time-budget`

虚拟时间模式下 `performance.now()` 走的是**虚拟时钟** —— 测出来的耗时不是真实耗时。
要拿真数字，必须连 CDP（Chrome DevTools Protocol），用 `Runtime.evaluate` 在页面内直接计时。
本设施用 Node 22 内置的全局 `WebSocket` 与 `fetch` 直连 CDP，**零依赖**，不引入 puppeteer / ws。

## 文件

| 文件 | 作用 |
|---|---|
| `gen-samples.js` | 生成中文小说风格样本，1 万 / 10 万 / 50 万行三档（`--rows` 可任意指定，如 `--rows 200` 取固定开销基准）。用 mulberry32 固定种子 —— 换机器、换日期，样本不变，数字才有可比性 |
| `lib/cdp.js` | 最小 CDP 客户端（连接 / 求值 / 等待条件 / 异常上抛）+ 浏览器进程生命周期（含 `taskkill /T` 收孤儿进程） |
| `run.js` | 驱动测量：真实文件经 `DOM.setFileInputFiles` 灌入真实 file input，浏览器自己读盘。`--file` 可指向任意 HTML，用于 A/B 复测 |
| `profile.js` | CPU 函数级采样（CDP Profiler），按 self time 聚合热点。**优化前必跑** —— 只知道「花了 1000ms」不够，得知道花在哪些函数上 |
| `baseline/` | 基线快照 JSON（入库，作为对比基准） |
| `out/` | 临时结果（忽略，不入库） |
| `samples/` | 样本文件（忽略，不入库） |

## A/B 复测（判断「真回归」还是「环境漂移」的唯一办法）

同一次改动前后各测一轮，很容易把机器抖动当成回归。正确做法是把「改前」版本导出成文件，**交替轮流跑**：

```bash
git show <改前的提交>:txt-reader.html > bench/out/base.html
node bench/run.js --rows 100000 --file bench/out/base.html --label ab-base-r1 --port 9420
node bench/run.js --rows 100000 --file txt-reader.html      --label ab-opt-r1  --port 9425
```

跑 3 轮看中位数。**只有在同一次会话里交替跑出来的差异才能采信**（实测中「切不换行」首轮曾出现 +13% 的假回归，复测后反而是略快）。

## 测量口径

| 指标 | 定义 | 采集方式 |
|---|---|---|
| **首屏可读时间** | 文件 `change` 事件 → `#content` 首次出现 `.row` | 页面内 `MutationObserver` |
| **读盘刻度** | 文件 `change` 事件 → `#stFile` 被写入（`state.bytes` 已就绪） | 同上 |
| **排版完成刻度** | → `#empty` 被隐藏（`applyLayoutToLines` 走完） | 同上 |
| **行数就绪时间** | 文件 `change` 事件 → `#stLines` 被写入（`computeLayout` 走完） | 同上 |
| **排版开关切换** | 同步点 `#layoutToggleBtn`，关 / 开各一次 | `performance.now()` 前后差值 |
| **字号变更** | 同步设 `#fontSelect` 24px → 28px → 还原 | 同上 |
| **换行模式切换** | 同步点 `#wrapSeg`，自动 → 不换行 → 自动 | 同上 |
| **滚动长任务** | 滚动 200 帧期间的 `longtask` 数量与最长时长 | `PerformanceObserver` |
| **内存** | `JSHeapUsedSize`、DOM 节点数、事件监听器数 | CDP `Performance.getMetrics` / `Memory.getDOMCounters` |

**三条诚实的保留**：

- **无头模式下不能采信帧率**。无头没有 vsync，`requestAnimationFrame` 间隔不代表真实刷新节奏。因此滚动流畅度用 `longtask` 作代理指标（长任务 = 主线程被阻塞 = 必然掉帧）。真实帧率需真机复测。
- **首屏包含 FileReader 异步读盘**，所以小样本上它会被 IO 抖动主导；比较时看的是**同环境下的相对变化**，不是绝对值。
- **`MutationObserver` 切不开同步块内部**。`openFile` 在 `state.bytes` 就绪之后是一整个同步块（解码 → 全文断句 → 全量视觉行 → 渲染），所有观察者回调都是微任务、在块末统一触发 —— 所以「读盘 / 解码+断句 / 排版+渲染」三列的分解**只在阶段间真的让出主线程时才有意义**，否则会看到后两列为 0。要拆同步块内部，得用 `profile.js` 的函数级采样。固定开销用极小样本（`--rows 200`）单独标定。

## 基线数据（v1.16-btn-order · 主文件 md5 `a31e2fae…`）

| 样本 | 首屏 | 排版关 | 排版开 | 字号 24→28 | 切「不换行」 | 堆 |
|---|---|---|---|---|---|---|
| 1 万行（0.8 MB） | 404 ms | 174 ms | 131 ms | 272 ms | 167 ms | 3.6 MB |
| 10 万行（8.4 MB） | **1009 ms** | 603 ms | 871 ms | 454 ms | 1254 ms | 31.8 MB |
| 50 万行（42 MB） | **4385 ms** | 2806 ms | 4081 ms | 2115 ms | 5843 ms | 155.6 MB |

对照 PLAN-C 的目标口径（10 万行 · 桌面）：

| 指标 | 目标 | 基线 | 差距 |
|---|---|---|---|
| 首屏可读时间 | < 300 ms | 1009 ms | **3.4× 超标** |
| 排版开关切换 | < 150 ms | 603–871 ms | **4–5.8× 超标** |

**根因**（阶段一结论）：`computeLayout()` 每次都对**全部逻辑行**重跑 `wrapText` 并重建 `visualRows` / `offsets` / `pages`；更甚的是 `applyLayoutToLines()` 每次都重新解码全文、重跑全文断句，`Speak.setLines()` 还每次都重建整份朗读队列（哪怕根本没在朗读）。打开文件、改字号、松标尺、切排版，全走这一条路径且全程同步阻塞主线程。

### 阶段二优化后（A/B 交替复测三轮 · 10 万行）

| 指标 | 基线 | 优化后 | 变化 | 目标 | 判定 |
|---|---|---|---|---|---|
| 首屏 | 969 ms | **≈400 ms** | −59% | < 300 ms | ✗ 未达标（1.3×） |
| 排版开关关闭 | 626 ms | **≈48 ms** | −92% | < 150 ms | ✓ |
| 排版开关开启 | 870 ms | **≈70 ms** | −92% | < 150 ms | ✓ |
| 字号 24→28 | 469 ms | **≈100 ms** | −79% | — | ✓ |
| 堆占用 | 31.8 MB | **25.5 MB** | −20% | — | ✓ |

首屏剩余差距的性质：极小样本（200 行 / 18 KB）首屏为 75.5 ms，即固定开销约 75 ms；10 万行的其余约 320 ms 是随数据量增长的真实处理（读盘 + 解码 8.4 MB + 全文断句 + 全量视觉行 + 首屏渲染）。**尚未实现 PLAN-C 要点 3 的「分片调度」** —— 把「解码 + 全文断句」从首屏关键路径移到 `requestIdleCallback` 是继续压低首屏的主路径。
