'use strict';
/* ============================================================================
 * CPU 采样分析器 —— PLAN-2026-1001-C 阶段二前置
 *
 * 为什么需要它：只测「某个动作花了 1000ms」不足以决定改哪里。
 * 必须知道这 1000ms 花在哪些函数上，否则优化是盲的、可能打错靶。
 *
 * 用 CDP Profiler 域做函数级采样（默认 200µs 一次），按 self time 聚合。
 * 全程只读，不改动主文件。
 *
 * 用法：
 *   node bench/profile.js --rows 100000
 *   node bench/profile.js --rows 500000 --top 25
 *   node bench/profile.js --rows 100000 --action open        # 只 profile 打开文件
 *   node bench/profile.js --rows 100000 --action layouttoggle # 只 profile 排版切换
 * ========================================================================== */

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { CDP, launchBrowser, waitForDevTools, findPageTarget, killBrowser, sleep } = require('./lib/cdp');

const ROOT = path.resolve(__dirname, '..');
const MAIN_HTML = path.join(ROOT, 'txt-reader.html');
const SAMPLES_DIR = path.join(__dirname, 'samples');

function parseArgs(argv) {
  const o = { rows: 100000, top: 30, port: 9370, action: 'open', interval: 200 };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--rows' && argv[i + 1]) o.rows = parseInt(argv[++i], 10);
    else if (argv[i] === '--top' && argv[i + 1]) o.top = parseInt(argv[++i], 10);
    else if (argv[i] === '--port' && argv[i + 1]) o.port = parseInt(argv[++i], 10);
    else if (argv[i] === '--action' && argv[i + 1]) o.action = argv[++i];
    else if (argv[i] === '--interval' && argv[i + 1]) o.interval = parseInt(argv[++i], 10);
  }
  return o;
}

function sampleFile(rows) {
  const label = rows >= 10000 ? (rows / 10000) + 'w' : String(rows);
  const f = path.join(SAMPLES_DIR, 'sample-' + label + '.txt');
  if (!fs.existsSync(f)) throw new Error('样本不存在: ' + f + '（先跑 node bench/gen-samples.js）');
  return f;
}

const PROBE = `(() => {
  const B = (window.__bench = { t: {} });
  const mark = (k) => { if (B.t[k] === undefined) B.t[k] = performance.now(); };
  const fi = document.getElementById('fileInput');
  fi.addEventListener('change', () => mark('changeFired'), true);
  const content = document.getElementById('content');
  new MutationObserver(() => { if (content.querySelector('.row')) mark('firstRow'); })
    .observe(content, { childList: true, subtree: true });
  return true;
})()`;

async function main() {
  const args = parseArgs(process.argv);
  const samplePath = sampleFile(args.rows);
  const sizeMB = (fs.statSync(samplePath).size / 1048576).toFixed(1);
  const port = args.port;

  const child = await launchBrowser({ port, profileDir: path.join(__dirname, '.profile', 'prof' + port) });
  let cdp = null;
  try {
    await waitForDevTools(port);
    const target = await findPageTarget(port);
    cdp = await CDP.connect(target.webSocketDebuggerUrl);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Page.navigate', { url: pathToFileURL(MAIN_HTML).href });
    await cdp.waitFor(`document.readyState === 'complete'`, { timeoutMs: 30000 });
    await sleep(300);
    await cdp.eval(PROBE, { awaitPromise: false });

    await cdp.send('Profiler.enable');
    await cdp.send('Profiler.setSamplingInterval', { interval: args.interval });

    console.log('=== CPU 采样 action=' + args.action + ' 样本=' + args.rows.toLocaleString() +
      ' 行 (' + sizeMB + ' MB) 采样间隔=' + args.interval + 'µs ===\n');

    let profile = null;

    if (args.action === 'open') {
      // 先把文件灌进去，再把 Profiler 打开会漏掉前半段；
      // 故：先设 file input，但不触发 —— CDP 无法"预备"，改为 Profiler 先开、立刻灌文件。
      await cdp.send('DOM.enable');
      const { root } = await cdp.send('DOM.getDocument');
      const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: '#fileInput' });

      await cdp.send('Profiler.start');
      await cdp.send('DOM.setFileInputFiles', { nodeId, files: [samplePath] });
      await cdp.waitFor(`window.__bench.t.firstRow !== undefined`, { timeoutMs: 180000, label: '首屏' });
      await sleep(600);                        // 让后台补算（若有）也进采样
      ({ profile } = await cdp.send('Profiler.stop'));

    } else if (args.action === 'layouttoggle') {
      // 先正常打开文件（不进采样），再对「排版开关切换」单独采样
      await cdp.send('DOM.enable');
      const { root } = await cdp.send('DOM.getDocument');
      const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: '#fileInput' });
      await cdp.send('DOM.setFileInputFiles', { nodeId, files: [samplePath] });
      await cdp.waitFor(`window.__bench.t.firstRow !== undefined`, { timeoutMs: 180000, label: '首屏' });
      await sleep(400);

      await cdp.send('Profiler.start');
      await cdp.eval(`(() => { const b = document.getElementById('layoutToggleBtn'); b.click(); b.click(); return true; })()`, { awaitPromise: false });
      await sleep(500);
      ({ profile } = await cdp.send('Profiler.stop'));

    } else {
      throw new Error('未知 action: ' + args.action + '（支持 open / layouttoggle）');
    }

    report(profile, args.top);
  } finally {
    if (cdp) cdp.close();
    await killBrowser(child);
  }
}

function report(profile, top) {
  const nodes = profile.nodes || [];
  const totalSamples = (profile.samples || []).length || nodes.reduce((a, n) => a + (n.hitCount || 0), 0);
  const agg = new Map();

  for (const n of nodes) {
    const hits = n.hitCount || 0;
    if (!hits) continue;
    const cf = n.callFrame || {};
    const fn = cf.functionName || '(anonymous)';
    const url = (cf.url || '').split(/[\\/]/).pop() || '(native)';
    const key = fn + '  @' + url + ':' + ((cf.lineNumber || 0) + 1);
    const cur = agg.get(key) || { hits: 0, fn, url, line: (cf.lineNumber || 0) + 1 };
    cur.hits += hits;
    agg.set(key, cur);
  }

  const list = [...agg.values()].sort((a, b) => b.hits - a.hits);
  const us = (h) => (h * 200 / 1000).toFixed(1) + 'ms';   // hits × 采样间隔

  console.log('采样总数(样本点): ' + totalSamples.toLocaleString());
  console.log('（时间估算 = hits × 采样间隔 200µs，仅作占比参考）\n');
  console.log(pad('占比', 8) + pad('估算耗时', 12) + '函数');
  console.log('-'.repeat(78));
  for (const it of list.slice(0, top)) {
    const pct = ((it.hits / totalSamples) * 100).toFixed(1) + '%';
    console.log(pad(pct, 8) + pad(us(it.hits), 12) + it.fn + '   @' + it.url + ':' + it.line);
  }
  const covered = list.slice(0, top).reduce((a, b) => a + b.hits, 0);
  console.log('-'.repeat(78));
  console.log('前 ' + top + ' 名合计占比: ' + ((covered / totalSamples) * 100).toFixed(1) + '%');
}
function strWidth(s) { let n = 0; for (const ch of s) n += ch.charCodeAt(0) > 255 ? 2 : 1; return n; }
function pad(s, w) { const d = w - strWidth(s); return s + ' '.repeat(Math.max(0, d)); }

main().then(() => { process.exitCode = 0; }).catch(e => { console.error('采样失败:', e.message); process.exitCode = 1; });
