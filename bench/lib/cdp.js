'use strict';
/* ============================================================================
 * 最小 CDP（Chrome DevTools Protocol）客户端 —— PLAN-2026-1001-C 基准设施
 *
 * 为什么不用 `--dump-dom` + `--virtual-time-budget`：
 *   虚拟时间模式下 performance.now() 走的是虚拟时钟，测出的耗时不是真实耗时。
 *   要拿真实数字，必须连 CDP 用 Runtime.evaluate 在页面上直接跑计时。
 *
 * 零依赖：Node 22 内置全局 WebSocket 与 fetch，不引入 ws / puppeteer。
 * ========================================================================== */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const EDGE_CANDIDATES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
];

function findBrowser() {
  for (const p of EDGE_CANDIDATES) if (fs.existsSync(p)) return p;
  throw new Error('未找到 Edge/Chrome 可执行文件，尝试过：\n  ' + EDGE_CANDIDATES.join('\n  '));
}

/* ---------- CDP 连接 ---------- */
class CDP {
  constructor(ws) {
    this.ws = ws;
    this._id = 0;
    this._pending = new Map();
    this._closed = false;
    ws.addEventListener('message', (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch (e) { return; }
      if (msg.id && this._pending.has(msg.id)) {
        const { resolve, reject, timer } = this._pending.get(msg.id);
        this._pending.delete(msg.id);
        clearTimeout(timer);
        if (msg.error) reject(new Error(msg.error.message || JSON.stringify(msg.error)));
        else resolve(msg.result);
      }
    });
    ws.addEventListener('close', () => {
      this._closed = true;
      for (const [, p] of this._pending) { clearTimeout(p.timer); p.reject(new Error('CDP 连接已关闭')); }
      this._pending.clear();
    });
  }

  static async connect(wsUrl, timeoutMs = 15000) {
    const ws = new WebSocket(wsUrl);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('CDP WebSocket 连接超时: ' + wsUrl)), timeoutMs);
      ws.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
      ws.addEventListener('error', (e) => { clearTimeout(timer); reject(new Error('CDP WebSocket 连接失败: ' + (e.message || wsUrl))); }, { once: true });
    });
    return new CDP(ws);
  }

  send(method, params = {}, timeoutMs = 180000) {
    if (this._closed) return Promise.reject(new Error('CDP 连接已关闭，无法发送 ' + method));
    const id = ++this._id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this._pending.has(id)) { this._pending.delete(id); reject(new Error('CDP 调用超时(' + timeoutMs + 'ms): ' + method)); }
      }, timeoutMs);
      this._pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  /* 在页面里求值。默认 awaitPromise + 取回值，异常直接抛出（不静默吞掉）。 */
  async eval(expression, opts = {}) {
    const r = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: opts.awaitPromise !== false,
      returnByValue: true,
      userGesture: opts.userGesture !== false,
      ...(opts.params || {}),
    });
    if (r.exceptionDetails) {
      const d = r.exceptionDetails;
      const desc = (d.exception && (d.exception.description || d.exception.value)) || d.text || '未知异常';
      throw new Error('页面内异常: ' + desc);
    }
    return r.result ? r.result.value : undefined;
  }

  /* 等待页面内条件成立（轮询），用于「等异步流程走完」。 */
  async waitFor(expression, { timeoutMs = 120000, intervalMs = 60, label = expression } = {}) {
    const t0 = Date.now();
    for (;;) {
      const v = await this.eval('(() => { try { return !!(' + expression + '); } catch (e) { return false; } })()', { awaitPromise: false });
      if (v) return true;
      if (Date.now() - t0 > timeoutMs) throw new Error('等待超时(' + timeoutMs + 'ms): ' + label);
      await sleep(intervalMs);
    }
  }

  close() { try { this.ws.close(); } catch (e) {} }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/* ---------- 浏览器进程管理 ---------- */
async function launchBrowser({ port, profileDir, windowSize = '1400,900', extraArgs = [] } = {}) {
  const exe = findBrowser();
  fs.mkdirSync(profileDir, { recursive: true });
  const args = [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-background-networking',
    '--disable-sync',
    '--disable-features=Translate,MediaRouter',
    '--window-size=' + windowSize,
    '--remote-debugging-port=' + port,
    '--user-data-dir=' + profileDir,
    'about:blank',
    ...extraArgs,
  ];
  const child = spawn(exe, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  if (child.stderr) child.stderr.on('data', d => { stderr += d.toString(); });
  child._stderrRef = () => stderr;
  return child;
}

async function waitForDevTools(port, timeoutMs = 25000) {
  const t0 = Date.now();
  for (;;) {
    try {
      const r = await fetch('http://127.0.0.1:' + port + '/json/version');
      if (r.ok) return await r.json();
    } catch (e) { /* 还没起来 */ }
    if (Date.now() - t0 > timeoutMs) throw new Error('调试端口 ' + port + ' 在 ' + timeoutMs + 'ms 内未就绪');
    await sleep(200);
  }
}

async function findPageTarget(port, urlHint) {
  const list = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
  const pages = list.filter(t => t.type === 'page');
  if (!pages.length) throw new Error('调试端口下没有 page target');
  if (urlHint) {
    const hit = pages.find(p => (p.url || '').includes(urlHint));
    if (hit) return hit;
  }
  return pages[0];
}

async function killBrowser(child) {
  if (!child || child.killed) return;
  try {
    if (process.platform === 'win32') {
      // Edge 会 fork 子进程，直接 kill 顶层进程会留孤儿 —— 用 taskkill 连树一起收。
      spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      child.kill('SIGKILL');
    }
  } catch (e) { /* 已退出 */ }
  await sleep(400);
}

module.exports = { CDP, launchBrowser, waitForDevTools, findPageTarget, killBrowser, findBrowser, sleep };
