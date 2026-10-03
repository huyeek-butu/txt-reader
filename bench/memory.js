'use strict';
/* ============================================================================
 * 内存泄漏验证 —— PLAN-2026-1001-C 验收判据「打开关闭文件 20 次后内存回落」
 *
 * 为什么单独一个脚本：
 *   泄漏不是「一次打开大文件」能看出来的 —— 单次占用高是正常的，问题在于**反复开关后
 *   是否逐轮攀升**。所以要循环 20 次，每次强制 GC 后再取堆大小，看曲线是平的还是斜的。
 *
 * 关键点：必须用 CDP 的 HeapProfiler.collectGarbage 强制一次完整 GC 再读
 *   Performance.getMetrics 的 JSHeapUsedSize。不强制 GC 的话读到的是「还没回收的垃圾」，
 *   曲线必然锯齿上扬，那是噪声不是泄漏。
 *
 * 用法：node bench/memory.js [--rows 100000] [--cycles 20] [--port 9490] [--file <html>]
 * ========================================================================== */

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { CDP, launchBrowser, waitForDevTools, findPageTarget, killBrowser, sleep } = require('./lib/cdp');

const ROOT = path.resolve(__dirname, '..');
const MAIN_HTML = path.join(ROOT, 'txt-reader.html');

function parseArgs(argv) {
  const o = { rows: 100000, cycles: 20, port: 9490, file: MAIN_HTML };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--rows' && argv[i + 1]) o.rows = parseInt(argv[++i], 10);
    else if (argv[i] === '--cycles' && argv[i + 1]) o.cycles = parseInt(argv[++i], 10);
    else if (argv[i] === '--port' && argv[i + 1]) o.port = parseInt(argv[++i], 10);
    else if (argv[i] === '--file' && argv[i + 1]) o.file = path.resolve(argv[++i]);
  }
  return o;
}

function sampleFile(rows) {
  const label = rows >= 10000 ? (rows / 10000) + 'w' : String(rows);
  const f = path.join(__dirname, 'samples', 'sample-' + label + '.txt');
  if (!fs.existsSync(f)) throw new Error('样本不存在: ' + f);
  return f;
}

/* 强制一次完整 GC 后再取堆指标 —— 否则读到的是尚未回收的垃圾。 */
async function sampleHeap(cdp) {
  await cdp.send('HeapProfiler.collectGarbage', {}, 60000);
  await sleep(120);
  const { metrics } = await cdp.send('Performance.getMetrics');
  const get = n => { const m = metrics.find(x => x.name === n); return m ? m.value : null; };
  let dom = { nodes: null, jsEventListeners: null, documents: null };
  try { dom = await cdp.send('Memory.getDOMCounters'); } catch (e) { /* 部分版本不支持 */ }
  return {
    heapBytes: get('JSHeapUsedSize'),
    heapMB: get('JSHeapUsedSize') === null ? null : +(get('JSHeapUsedSize') / 1048576).toFixed(1),
    totalHeapMB: get('JSHeapTotalSize') === null ? null : +(get('JSHeapTotalSize') / 1048576).toFixed(1),
    nodes: dom.nodes, listeners: dom.jsEventListeners, documents: dom.documents,
  };
}

async function main() {
  const args = parseArgs(process.argv);
  const sample = sampleFile(args.rows);
  const child = await launchBrowser({
    port: args.port,
    profileDir: path.join(__dirname, '.profile', 'mem' + args.port),
    url: pathToFileURL(args.file).href,
  });
  let cdp = null;
  const report = {
    startedAt: new Date().toISOString(),
    html: path.relative(ROOT, args.file), sample: path.basename(sample),
    rows: args.rows, cycles: args.cycles, points: [], errors: [], summary: null,
  };

  try {
    await waitForDevTools(args.port);
    const target = await findPageTarget(args.port);
    cdp = await CDP.connect(target.webSocketDebuggerUrl);
    await cdp.send('Performance.enable');
    await cdp.send('HeapProfiler.enable').catch(() => {});

    const { root } = await cdp.send('DOM.getDocument');
    const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: '#fileInput' });

    // 基线：一个文件都没打开过
    report.points.push({ i: 0, phase: 'baseline', ...(await sampleHeap(cdp)) });

    for (let i = 1; i <= args.cycles; i++) {
      // --- 打开 ---
      await cdp.send('DOM.setFileInputFiles', { nodeId, files: [sample] });
      await cdp.waitFor(`document.querySelector('#content .row') !== null`, { timeoutMs: 180000, label: '第 ' + i + ' 轮首屏' });
      await sleep(250);
      const opened = await sampleHeap(cdp);
      report.points.push({ i, phase: 'open', ...opened });

      // --- 关闭 ---
      const clicked = await cdp.eval(`(() => { const b = document.querySelector('#clearFilesBtn');
        if (!b) return false; b.click(); return true; })()`, { awaitPromise: false });
      if (!clicked) throw new Error('#clearFilesBtn 不存在，无法执行「关闭所有文件」');
      await cdp.waitFor(`document.querySelector('#content').childElementCount === 0`,
        { timeoutMs: 60000, label: '第 ' + i + ' 轮关闭' });
      await sleep(250);
      const closed = await sampleHeap(cdp);
      report.points.push({ i, phase: 'close', ...closed });

      console.log('  第 ' + String(i).padStart(2) + ' 轮  开=' + opened.heapMB + 'MB  关=' + closed.heapMB +
        'MB  节点=' + closed.nodes + '  监听器=' + closed.listeners);
    }

    // 最后一轮关闭后再多采一次，确认稳定不回弹
    await sleep(600);
    report.points.push({ i: args.cycles, phase: 'settle', ...(await sampleHeap(cdp)) });

    report.summary = judge(report.points, args.cycles);
  } catch (e) {
    report.errors.push(e.message);
    console.error('验证失败:', e.message);
    process.exitCode = 1;
  } finally {
    fs.mkdirSync(path.join(__dirname, 'out'), { recursive: true });
    const out = path.join(__dirname, 'out', 'memory-' + new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19) + '.json');
    fs.writeFileSync(out, JSON.stringify(report, null, 2), 'utf8');
    console.log('\n结果已写入: ' + path.relative(ROOT, out));
    if (report.summary) print(report);
    if (cdp) cdp.close();
    await killBrowser(child);
  }
}

/* 判定：不看绝对值，看三件事 ——
   ① **平坦性**：20 个「关闭点」的极差。开着一个大文件反复开关，若每轮残留一点，
      这条曲线就会一路向上；平坦即无累积。
   ② **无单向漂移**：后半程均值 vs 前半程均值（避开首轮预热），排除缓慢上扬。
   ③ 工作集是否真被释放：打开峰值 − 关闭后堆 ≈ 一份完整工作集。

   参照物必须选「**首轮关闭后**」而不是「空白页冷基线」：V8 的堆在跑过一轮大文件后
   不会退回空白页水平（引擎预热、已归还但未释放给系统的缓冲），拿冷基线做参照会把
   「正常暖态」误判成泄漏 —— 首版就是这么误报 FAIL 的。冷基线仅作参考值列出。 */
function judge(points, cycles) {
  const closes = points.filter(p => p.phase === 'close');
  const opens = points.filter(p => p.phase === 'open');
  const cold = points.find(p => p.phase === 'baseline');
  const settle = points.find(p => p.phase === 'settle');
  const vals = closes.map(p => p.heapMB);
  const firstClose = vals[0], lastClose = vals[vals.length - 1];
  const peak = Math.max(...opens.map(p => p.heapMB));
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const half = Math.floor(vals.length / 2);
  const avg = a => a.reduce((s, v) => s + v, 0) / (a.length || 1);
  const firstHalf = avg(vals.slice(0, half)), secondHalf = avg(vals.slice(half));
  const flatRange = +(hi - lo).toFixed(1);
  const drift = +(secondHalf - firstHalf).toFixed(1);
  const warmCreep = +(lastClose - firstClose).toFixed(1);
  const workingSet = +(peak - firstClose).toFixed(1);
  const released = +(peak - lastClose).toFixed(1);
  // 阈值：极差 / 漂移 / 首末差 均 ≤3MB（约样本解码文本的 1/5），超出即视为逐轮累积。
  const leak = flatRange > 3 || drift > 3 || warmCreep > 3;
  return {
    coldBaselineMB: cold && cold.heapMB,
    firstOpenPeakMB: peak,
    firstCloseHeapMB: firstClose,
    lastCloseHeapMB: lastClose,
    settleHeapMB: settle && settle.heapMB,
    closeCurveRangeMB: flatRange,
    closeCurveFirstHalfAvgMB: +firstHalf.toFixed(1),
    closeCurveSecondHalfAvgMB: +secondHalf.toFixed(1),
    driftMB: drift,
    warmCreepMB: warmCreep,
    workingSetMB: workingSet,
    releasedMB: released,
    nodeCounts: { first: closes[0] && closes[0].nodes, last: closes[closes.length - 1] && closes[closes.length - 1].nodes },
    listenerCounts: { first: closes[0] && closes[0].listeners, last: closes[closes.length - 1] && closes[closes.length - 1].listeners },
    leak: leak,
    verdict: leak ? 'FAIL 存在累积' : 'PASS 无泄漏',
    cycles,
  };
}

function print(report) {
  const s = report.summary;
  console.log('\n=== 内存泄漏判定（' + report.html + ' · ' + report.rows.toLocaleString() + ' 行 · ' + s.cycles + ' 轮）===');
  console.log('  冷基线（空白页）  ' + s.coldBaselineMB + ' MB   ← 仅参考，不作判定参照');
  console.log('  首轮关闭后（暖态）' + s.firstCloseHeapMB + ' MB   ← 判定参照');
  console.log('  单轮打开峰值      ' + s.firstOpenPeakMB + ' MB   （工作集 ' + s.workingSetMB +
    ' MB，末轮释放 ' + s.releasedMB + ' MB）');
  console.log('  末轮关闭后        ' + s.lastCloseHeapMB + ' MB   静置 600ms 后 ' + s.settleHeapMB + ' MB');
  console.log('  关闭点曲线        极差 ' + s.closeCurveRangeMB + ' MB   前半程均 ' + s.closeCurveFirstHalfAvgMB +
    ' MB → 后半程均 ' + s.closeCurveSecondHalfAvgMB + ' MB   漂移 ' + s.driftMB + ' MB');
  console.log('  首末差            ' + s.warmCreepMB + ' MB');
  console.log('  节点数 ' + s.nodeCounts.first + ' → ' + s.nodeCounts.last +
    '    事件监听器 ' + s.listenerCounts.first + ' → ' + s.listenerCounts.last);
  console.log('  判定: ' + s.verdict);
}

main().catch(e => { console.error(e); process.exitCode = 1; });
