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
| `gen-samples.js` | 生成中文小说风格样本，1 万 / 10 万 / 50 万行三档。用 mulberry32 固定种子 —— 换机器、换日期，样本不变，数字才有可比性 |
| `lib/cdp.js` | 最小 CDP 客户端（连接 / 求值 / 等待条件 / 异常上抛）+ 浏览器进程生命周期（含 `taskkill /T` 收孤儿进程） |
| `run.js` | 驱动测量：真实文件经 `DOM.setFileInputFiles` 灌入真实 file input，浏览器自己读盘 |
| `baseline/` | 基线快照 JSON（入库，作为对比基准） |
| `out/` | 临时结果（忽略，不入库） |
| `samples/` | 样本文件（忽略，不入库） |

## 测量口径

| 指标 | 定义 | 采集方式 |
|---|---|---|
| **首屏可读时间** | 文件 `change` 事件 → `#content` 首次出现 `.row` | 页面内 `MutationObserver` |
| **行数就绪时间** | 文件 `change` 事件 → `#stLines` 被写入（`computeLayout` 走完） | 同上 |
| **排版开关切换** | 同步点 `#layoutToggleBtn`，关 / 开各一次 | `performance.now()` 前后差值 |
| **字号变更** | 同步设 `#fontSelect` 24px → 28px → 还原 | 同上 |
| **换行模式切换** | 同步点 `#wrapSeg`，自动 → 不换行 → 自动 | 同上 |
| **滚动长任务** | 滚动 200 帧期间的 `longtask` 数量与最长时长 | `PerformanceObserver` |
| **内存** | `JSHeapUsedSize`、DOM 节点数、事件监听器数 | CDP `Performance.getMetrics` / `Memory.getDOMCounters` |

**两条诚实的保留**：

- **无头模式下不能采信帧率**。无头没有 vsync，`requestAnimationFrame` 间隔不代表真实刷新节奏。因此滚动流畅度用 `longtask` 作代理指标（长任务 = 主线程被阻塞 = 必然掉帧）。真实帧率需真机复测。
- **首屏包含 FileReader 异步读盘**，所以小样本上它会被 IO 抖动主导；比较时看的是**同环境下的相对变化**，不是绝对值。

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

**根因**（阶段一结论，供阶段二对症）：`computeLayout()` 每次都对**全部逻辑行**重跑 `wrapText` 并重建 `visualRows` / `offsets` / `pages` —— 打开文件、改字号、松标尺、切排版，全走这一条全量路径，且全程同步阻塞主线程。
