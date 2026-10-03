'use strict';
/* ============================================================================
 * 基准驱动 —— PLAN-2026-1001-C（大文件性能与移动端）阶段一
 *
 * 「先量化再优化」：本脚本在真实浏览器里打开主文件、载入真实样本、执行真实
 * 用户动作，用 CDP 的 Runtime.evaluate 在页面内计时 —— 全程不模拟、不估算。
 *
 * 测量的六项：
 *   1. 首屏可读时间   从文件 change 事件到 #content 出现第一个 .row
 *   2. 行数就绪时间   #stLines 被写入（computeLayout 完成）的时刻
 *   3. 排版开关切换   同步点 #layoutToggleBtn，两次（关 / 开）
 *   4. 字号变更       同步设 #fontSelect，24px → 28px → 还原
 *   5. 换行模式切换   同步点 #wrapSeg，自动 → 不换行 → 自动
 *   6. 滚动长任务     滚动 200 帧期间的 longtask 数量与最长时长（流畅度代理指标）
 *   另取：JS 堆占用、DOM 节点数、事件监听器数（内存口径）
 *
 * 用法：
 *   node bench/run.js                          # 跑全部样本
 *   node bench/run.js --rows 10000,100000      # 只跑指定档
 *   node bench/run.js --label baseline         # 给结果打标签（默认 baseline）
 *   node bench/run.js --port 9333
 *
 * 结果写入 bench/out/<label>-<时间戳>.json，并打印可读表格。
 * ========================================================================== */

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { CDP, launchBrowser, waitForDevTools, findPageTarget, killBrowser, sleep } = require('./lib/cdp');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_MAIN_HTML = path.join(ROOT, 'txt-reader.html');
const SAMPLES_DIR = path.join(__dirname, 'samples');

/* ---------- 参数 ---------- */
function parseArgs(argv) {
  // outDir 默认 bench/out（已被 .gitignore 忽略）；基线快照用 --outdir bench/baseline 入库
  // --file 可指向任意 HTML —— A/B 复测时用它分别指向「改前」与「改后」的副本，
  // 交替跑才能把代码差异与环境漂移分开。
  const o = { rows: null, label: 'baseline', port: 9333, outDir: path.join(__dirname, 'out'), file: DEFAULT_MAIN_HTML };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--rows' && argv[i + 1]) o.rows = argv[++i].split(',').map(s => parseInt(s, 10));
    else if (argv[i] === '--label' && argv[i + 1]) o.label = argv[++i];
    else if (argv[i] === '--port' && argv[i + 1]) o.port = parseInt(argv[++i], 10);
    else if (argv[i] === '--outdir' && argv[i + 1]) o.outDir = path.resolve(process.cwd(), argv[++i]);
    else if (argv[i] === '--file' && argv[i + 1]) o.file = path.resolve(process.cwd(), argv[++i]);
  }
  return o;
}

/* ---------- 页面内探针：安装监听，等文件被塞进 input ---------- */
const INSTALL_PROBE = `(() => {
  const B = (window.__bench = { t: {}, errors: [], longs: [] });
  const mark = (k) => { if (B.t[k] === undefined) B.t[k] = performance.now(); };

  const fi = document.getElementById('fileInput');
  if (!fi) { B.errors.push('未找到 #fileInput'); return false; }
  fi.addEventListener('change', () => mark('changeFired'), true);

  const content = document.getElementById('content');
  if (content) {
    new MutationObserver(() => { if (content.querySelector('.row')) mark('firstRowPainted'); })
      .observe(content, { childList: true, subtree: true });
  } else B.errors.push('未找到 #content');

  const st = document.getElementById('stLines');
  if (st) {
    new MutationObserver(() => mark('stLinesUpdated'))
      .observe(st, { childList: true, characterData: true, subtree: true });
  } else B.errors.push('未找到 #stLines');

  // 「字节就绪」刻度：openFile 里 state.bytes 赋值后紧接着就写 #stFile，
  // 它之前是纯读盘（Blob.arrayBuffer），之后才进入解码与排版 —— 用它切开 IO 与计算。
  const stFile = document.getElementById('stFile');
  if (stFile) {
    new MutationObserver(() => mark('ioDone'))
      .observe(stFile, { childList: true, characterData: true, subtree: true });
  } else B.errors.push('未找到 #stFile');

  // 「排版完成」刻度：decodeAndRender 在 applyLayoutToLines() 之后才隐藏空态，
  // 因此它能标出「解码 + 全文断句」这一段结束的时刻。
  const emptyEl = document.getElementById('empty');
  if (emptyEl) {
    new MutationObserver(() => { if (emptyEl.classList.contains('hidden')) mark('layoutDone'); })
      .observe(emptyEl, { attributes: true, attributeFilter: ['class'] });
  } else B.errors.push('未找到 #empty');

  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) B.longs.push(Math.round(e.duration));
    }).observe({ entryTypes: ['longtask'] });
    B.hasLongTask = true;
  } catch (e) { B.hasLongTask = false; }

  B.installed = true;
  return true;
})()`;

/* ---------- 打开后的同步动作测量 ---------- */
const MEASURE_SYNC = `(() => {
  const t0 = performance.now();
  document.getElementById('layoutToggleBtn').click();
  const t1 = performance.now();
  document.getElementById('layoutToggleBtn').click();
  const t2 = performance.now();

  const sel = document.getElementById('fontSelect');
  const origFont = sel.value;
  const t3 = performance.now();
  sel.value = '28'; sel.dispatchEvent(new Event('change', { bubbles: true }));
  const t4 = performance.now();
  sel.value = origFont; sel.dispatchEvent(new Event('change', { bubbles: true }));
  const t5 = performance.now();

  const seg = document.getElementById('wrapSeg');
  const noWrapBtn = seg.querySelector('button[data-wrap="0"]');
  const autoBtn = seg.querySelector('button[data-wrap="1"]');
  const t6 = performance.now();
  noWrapBtn.click();
  const t7 = performance.now();
  autoBtn.click();
  const t8 = performance.now();

  return {
    layoutToggleOffMs : +(t1 - t0).toFixed(1),
    layoutToggleOnMs  : +(t2 - t1).toFixed(1),
    font24to28Ms      : +(t4 - t3).toFixed(1),
    fontRestoreMs     : +(t5 - t4).toFixed(1),
    wrapOffMs         : +(t7 - t6).toFixed(1),
    wrapOnMs          : +(t8 - t7).toFixed(1)
  };
})()`;

/* ---------- 滚动流畅度（longtask 为代理指标；无头无 vsync，帧率不采信） ---------- */
const MEASURE_SCROLL = `(async () => {
  const vp = document.getElementById('viewport');
  const B = window.__bench;
  vp.scrollTop = 0;
  await new Promise(r => setTimeout(r, 120));
  B.longs.length = 0;
  const t0 = performance.now();
  let frames = 0;
  await new Promise((resolve) => {
    const step = () => {
      vp.scrollTop += 300;
      frames++;
      if (frames < 200 && vp.scrollTop + vp.clientHeight < vp.scrollHeight) requestAnimationFrame(step);
      else resolve();
    };
    requestAnimationFrame(step);
  });
  const wall = performance.now() - t0;
  const longs = B.longs.slice();
  return {
    scrollFrames: frames,
    scrollWallMs: Math.round(wall),
    longTaskCount: longs.length,
    longTaskMaxMs: longs.length ? Math.max.apply(null, longs) : 0,
    longTaskTotalMs: longs.reduce((a, b) => a + b, 0)
  };
})()`;

/* ---------- 单个样本的完整测量 ---------- */
async function benchSample({ samplePath, rows, port, profileDir, mainHtml }) {
  const result = { rows, file: path.basename(samplePath), ok: false, errors: [] };
  const child = await launchBrowser({ port, profileDir });
  let cdp = null;
  try {
    await waitForDevTools(port);
    const target = await findPageTarget(port);
    cdp = await CDP.connect(target.webSocketDebuggerUrl);

    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    try { await cdp.send('Performance.enable'); } catch (e) { /* 不支持则跳过 */ }
    try { await cdp.send('HeapProfiler.enable'); } catch (e) { /* 同上 */ }

    const tNav = Date.now();
    await cdp.send('Page.navigate', { url: pathToFileURL(mainHtml).href });
    await cdp.waitFor(`document.readyState === 'complete'`, { timeoutMs: 30000, label: '页面加载' });
    await sleep(250);
    result.navToReadyMs = Date.now() - tNav;

    const installed = await cdp.eval(INSTALL_PROBE, { awaitPromise: false });
    if (!installed) throw new Error('探针安装失败');

    // 清一次堆，让内存读数干净
    try { await cdp.send('HeapProfiler.collectGarbage'); } catch (e) {}
    await sleep(120);
    result.heapBeforeMB = await heapUsedMB(cdp);

    // ---- 关键动作：把真实样本塞进 file input，浏览器自己读盘 ----
    await cdp.send('DOM.enable');
    const { root } = await cdp.send('DOM.getDocument');
    const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: '#fileInput' });
    if (!nodeId) throw new Error('未找到 #fileInput 节点');
    await cdp.send('DOM.setFileInputFiles', { nodeId, files: [samplePath] });

    await cdp.waitFor(`window.__bench.t.changeFired !== undefined`, { timeoutMs: 60000, label: 'change 事件' });
    await cdp.waitFor(`window.__bench.t.ioDone !== undefined`, { timeoutMs: 180000, label: '读盘完成' });
    await cdp.waitFor(`window.__bench.t.layoutDone !== undefined`, { timeoutMs: 180000, label: '排版完成' });
    await cdp.waitFor(`window.__bench.t.firstRowPainted !== undefined`, { timeoutMs: 180000, label: '首屏渲染' });
    await cdp.waitFor(`window.__bench.t.stLinesUpdated !== undefined`, { timeoutMs: 180000, label: '行数统计' });
    await sleep(300);

    result.timing = await cdp.eval(`(() => {
      const t = window.__bench.t;
      const r = (a, b) => (t[a] !== undefined && t[b] !== undefined) ? +(t[a] - t[b]).toFixed(1) : null;
      return {
        ioMs       : r('ioDone', 'changeFired'),          // 读盘（Blob.arrayBuffer）
        layoutMs   : r('layoutDone', 'ioDone'),           // 解码 + 全文断句（applyLayoutToLines）
        renderMs   : r('firstRowPainted', 'layoutDone'),  // 全量排版视觉行 + 首屏渲染
        firstRowMs : r('firstRowPainted', 'changeFired'),
        stLinesMs  : r('stLinesUpdated', 'changeFired')
      };
    })()`, { awaitPromise: false });

    result.syncActions = await cdp.eval(MEASURE_SYNC, { awaitPromise: false });
    result.scroll = await cdp.eval(MEASURE_SCROLL);

    try { await cdp.send('HeapProfiler.collectGarbage'); } catch (e) {}
    await sleep(150);
    result.heapAfterMB = await heapUsedMB(cdp);
    result.domCounters = await domCounters(cdp);
    result.errors = await cdp.eval(`window.__bench.errors`, { awaitPromise: false });
    result.stateInfo = await cdp.eval(`(() => {
      const el = document.getElementById('stLines');
      return { stLines: el ? el.textContent : null };
    })()`, { awaitPromise: false });

    result.ok = true;
  } catch (e) {
    result.error = e.message;
  } finally {
    if (cdp) cdp.close();
    await killBrowser(child);
  }
  return result;
}

async function heapUsedMB(cdp) {
  try {
    const { metrics } = await cdp.send('Performance.getMetrics');
    const m = Object.fromEntries(metrics.map(x => [x.name, x.value]));
    return +(m.JSHeapUsedSize / 1048576).toFixed(1);
  } catch (e) { return null; }
}
async function domCounters(cdp) {
  try {
    const r = await cdp.send('Memory.getDOMCounters');
    return { documents: r.documents, nodes: r.nodes, listeners: r.jsEventListeners };
  } catch (e) { return null; }
}

/* ---------- 主流程 ---------- */
async function main() {
  const args = parseArgs(process.argv);
  const mainHtml = path.resolve(args.file);
  if (!fs.existsSync(mainHtml)) throw new Error('未找到待测主文件: ' + mainHtml);
  if (!fs.existsSync(SAMPLES_DIR)) throw new Error('样本目录不存在，先跑 node bench/gen-samples.js');

  let files = fs.readdirSync(SAMPLES_DIR).filter(f => /^sample-.*\.txt$/.test(f));
  let jobs = files.map(f => {
    const m = f.match(/sample-(\d+)w?\.txt/);
    const n = f.match(/sample-(\d+)w\.txt/) ? parseInt(f.match(/sample-(\d+)w\.txt/)[1], 10) * 10000 : parseInt(m[1], 10);
    return { rows: n, file: f };
  });
  if (args.rows) jobs = jobs.filter(j => args.rows.includes(j.rows));
  jobs.sort((a, b) => a.rows - b.rows);
  if (!jobs.length) throw new Error('没有匹配的样本，检查 --rows 或先生成样本');

  fs.mkdirSync(args.outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outFile = path.join(args.outDir, args.label + '-' + stamp + '.json');
  const report = { label: args.label, startedAt: new Date().toISOString(), mainFile: 'txt-reader.html', env: {}, results: [] };

  report.env = {
    browser: require('./lib/cdp').findBrowser(),
    node: process.version,
    platform: process.platform + ' ' + process.arch,
    mainFile: path.basename(mainHtml),
    mainFileBytes: fs.statSync(mainHtml).size,
    mainFileLines: fs.readFileSync(mainHtml, 'utf8').split('\n').length,
    mainFileMd5: require('crypto').createHash('md5').update(fs.readFileSync(mainHtml)).digest('hex'),
  };

  console.log('=== 基准开始 label=' + args.label + ' ===');
  console.log('主文件: ' + report.env.mainFile + ' ' + report.env.mainFileMd5 + ' (' + report.env.mainFileLines + ' 行 / ' + report.env.mainFileBytes + ' B)');
  console.log('');

  let port = args.port;
  for (const job of jobs) {
    const samplePath = path.join(SAMPLES_DIR, job.file);
    const sizeMB = (fs.statSync(samplePath).size / 1048576).toFixed(1);
    process.stdout.write('[bench] ' + job.file.padEnd(20) + ' (' + sizeMB + ' MB) ... ');
    const r = await benchSample({ samplePath, rows: job.rows, port, mainHtml, profileDir: path.join(__dirname, '.profile', 'p' + port) });
    report.results.push(r);
    if (r.ok) {
      console.log('OK  首屏 ' + r.timing.firstRowMs + 'ms | 排版切换 ' + r.syncActions.layoutToggleOffMs + '/' + r.syncActions.layoutToggleOnMs + 'ms | 堆 ' + r.heapAfterMB + 'MB | longtask ' + r.scroll.longTaskCount + '次(最长' + r.scroll.longTaskMaxMs + 'ms)');
    } else {
      console.log('失败: ' + r.error);
    }
    port++;   // 换端口，避免上一个进程未完全释放时抢端口
  }

  fs.writeFileSync(outFile, JSON.stringify(report, null, 2), 'utf8');
  console.log('');
  console.log('=== 结果已写入: ' + path.relative(ROOT, outFile) + ' ===');
  printTable(report);
  return outFile;
}

function printTable(report) {
  const rows = report.results.filter(r => r.ok);
  if (!rows.length) { console.log('（无成功样本）'); return; }
  const cols = [
    ['样本', r => r.rows.toLocaleString() + ' 行'],
    ['读盘', r => r.timing.ioMs],
    ['解码+断句', r => r.timing.layoutMs],
    ['排版+渲染', r => r.timing.renderMs],
    ['首屏', r => r.timing.firstRowMs],
    ['排版关', r => r.syncActions.layoutToggleOffMs],
    ['排版开', r => r.syncActions.layoutToggleOnMs],
    ['字号28', r => r.syncActions.font24to28Ms],
    ['不换行', r => r.syncActions.wrapOffMs],
    ['堆(MB)', r => r.heapAfterMB],
    ['longtask', r => r.scroll.longTaskCount + '/' + r.scroll.longTaskMaxMs + 'ms'],
  ];
  const w = cols.map(c => Math.max(strWidth(String(c[0])), ...rows.map(r => strWidth(String(c[1](r))))));
  const line = arr => arr.map((s, i) => pad(s, w[i])).join(' | ');
  console.log(line(cols.map(c => c[0])));
  console.log(w.map(n => '-'.repeat(n)).join('-+-'));
  for (const r of rows) console.log(line(cols.map(c => String(c[1](r)))));
}
function strWidth(s) { let n = 0; for (const ch of s) n += ch.charCodeAt(0) > 255 ? 2 : 1; return n; }
function pad(s, w) { const d = w - strWidth(s); return s + ' '.repeat(Math.max(0, d)); }

main().then(f => { process.exitCode = 0; }).catch(e => { console.error('基准失败:', e.message); process.exitCode = 1; });
