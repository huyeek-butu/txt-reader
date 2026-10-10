'use strict';
/* ============================================================================
 * 章节目录 · 回归测试（v1.25-toc）
 *
 * 功能：侧栏「目录」面板自动识别章节标题（Layout.matchHeadLine 单一规则），
 *       单击跳转；排版开时标题行单独成段（v1.25 同步修复：标题行行尾换行
 *       保留为边界 + 标题句强制独立成段，否则标题被换行清洗粘进正文段落，
 *       目录扫描不到）。
 *
 * 覆盖：
 *   A. 排版开：识别 5 个标题（序章/第一章/第一节/第二节/第二章），节级缩进
 *   B. 单击「第二章」→ 含该标题的行进入视口
 *   C. 排版关：目录仍识别（原文行），跳转仍工作
 *   D. 无章节标题的文件 → 空态提示
 *
 * 用法：node bench/toc.js [--port 9535]
 * ========================================================================== */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { pathToFileURL } = require('url');
const { CDP, launchBrowser, waitForDevTools, findPageTarget, killBrowser, sleep } = require('./lib/cdp');

const ROOT = path.resolve(__dirname, '..');
const MAIN_HTML = path.join(ROOT, 'txt-reader.html');

let passCount = 0, failCount = 0;
function check(name, ok, detail) {
  if (ok) { passCount++; console.log('  PASS  ' + name + (detail ? '  (' + detail + ')' : '')); }
  else { failCount++; console.log('  FAIL  ' + name + (detail ? '  (' + detail + ')' : '')); }
}

const bodyOf = (s) => s + '这是用来撑起段落的正文内容，句子必须足够长才能够超过短句合并的阈值成为独立的段落。'.repeat(3);
const SAMPLE = [
  '机械加工工艺与窍门精选',
  '',
  '序章',
  bodyOf('阅读加工工艺类的书籍需要一点耐心。'),
  '第一章　初识车床',
  bodyOf('车床是机械制造中最基础的设备之一。'),
  '第一节　车床的结构',
  bodyOf('主轴箱、进给箱、溜板箱与床身构成了车床的主体。'),
  '第二节　刀具的安装',
  bodyOf('刀具安装时刀尖应与工件轴线等高。'),
  '第二章　车削工艺要点',
  bodyOf('外圆车削分粗车与精车两个阶段。'),
].join('\n');
const PLAIN = ['这是一本没有章节结构的普通文集。', bodyOf('随手记下的一些想法。'), bodyOf('另一段正文内容。')].join('\n');

async function main() {
  const port = (() => {
    const i = process.argv.indexOf('--port');
    return i > 0 ? parseInt(process.argv[i + 1], 10) : 9535;
  })();

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'toc-'));
  const pChap = path.join(dir, '带章节.txt');
  const pPlain = path.join(dir, '无章节.txt');
  fs.writeFileSync(pChap, SAMPLE, 'utf8');
  fs.writeFileSync(pPlain, PLAIN, 'utf8');

  const child = await launchBrowser({
    port,
    profileDir: path.join(__dirname, '.profile', 'toc' + port),
    url: pathToFileURL(MAIN_HTML).href,
  });
  let cdp = null;
  try {
    await waitForDevTools(port);
    const target = await findPageTarget(port, 'txt-reader');
    cdp = await CDP.connect(target.webSocketDebuggerUrl);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('DOM.enable');
    await cdp.waitFor(`document.readyState === 'complete'`, { timeoutMs: 30000 });
    await cdp.waitFor(`document.getElementById('app') !== null && document.getElementById('fileInput') !== null`, { timeoutMs: 30000, label: '页面标记' });
    await sleep(300);

    const openFile = async (file) => {
      const { root } = await cdp.send('DOM.getDocument');
      const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: '#fileInput' });
      await cdp.send('DOM.setFileInputFiles', { nodeId, files: [file] });
    };
    const waitToc = (n, label) => cdp.waitFor(`document.querySelectorAll('#tocList .list-item').length >= ${n}`, { timeoutMs: 30000, label });
    const readToc = () => cdp.eval(`(() => {
      return {
        count: document.getElementById('tocCount').textContent,
        items: [...document.querySelectorAll('#tocList .list-item')].map(el => ({ t: el.textContent, lv1: el.classList.contains('lv1') })),
        empty: !!document.querySelector('#tocList .empty-list'),
      };
    })()`, { awaitPromise: false, returnByValue: true });
    const norm = (s) => String(s).replace(/\u3000/g, ' ');   // 排版开时句内空白压成单空格（全角→半角），比较前归一化
    const clickToc = async (text) => {
      const r = await cdp.eval(`(() => {
        const want = ${JSON.stringify(text)}.replace(/\\u3000/g, ' ');
        const el = [...document.querySelectorAll('#tocList .list-item')].find(e => e.textContent.replace(/\\u3000/g, ' ').indexOf(want) >= 0);
        if (!el) return '未找到条目';
        el.click();
        return true;
      })()`, { awaitPromise: false });
      if (r !== true) throw new Error('点击目录条目失败: ' + r);
      await sleep(400);
    };
    const rowVisible = async (sub) => cdp.eval(`(() => {
      const want = ${JSON.stringify(sub)}.replace(/\\u3000/g, ' ');
      const row = [...document.querySelectorAll('#content .row')]
        .find(r => r.querySelector('.tx') && r.querySelector('.tx').textContent.replace(/\\u3000/g, ' ').indexOf(want) >= 0);
      if (!row) return 'row未渲染';
      const r = row.getBoundingClientRect();
      return (r.top >= 0 && r.top < window.innerHeight) ? true : 'top=' + Math.round(r.top);
    })()`, { awaitPromise: false });
    const toggleLayout = async () => {
      await cdp.eval(`document.getElementById('layoutToggleBtn').click(); true`, { awaitPromise: false });
      await sleep(600);
    };

    /* ============ 用例 A：排版开 · 识别与层级 ============ */
    console.log('\n=== 用例 A · 排版开 · 识别与层级 ===');
    await openFile(pChap);
    await cdp.waitFor(`document.querySelector('#content .row') !== null`, { timeoutMs: 60000, label: '首屏' });
    await waitToc(5, '目录条目');
    await sleep(300);
    let toc = await readToc();
    check('识别 5 个标题', toc.items.length === 5, JSON.stringify(toc.items.map(x => x.t)));
    check('计数一致', toc.count === '5', toc.count);
    check('序章在最前（固定词命中）', toc.items[0].t === '序章', JSON.stringify(toc.items[0].t));
    check('章级不缩进', norm(toc.items[1].t) === '第一章 初识车床' && !toc.items[1].lv1, JSON.stringify(toc.items[1]));
    check('节级缩进（lv1）', norm(toc.items[2].t) === '第一节 车床的结构' && toc.items[2].lv1 && toc.items[3].lv1, JSON.stringify(toc.items[2]));

    /* ============ 用例 B：单击跳转 ============ */
    console.log('\n=== 用例 B · 单击跳转 ===');
    await clickToc('第二章　车削工艺要点');
    // 轮询等行进入视口（虚拟滚动渲染 + 滚动事件异步，固定 sleep 偶发不够）
    let bOk = false, bLast = '未执行';
    for (let i = 0; i < 20 && !bOk; i++) {
      await sleep(250);
      bLast = await rowVisible('第二章　车削工艺要点');
      bOk = bLast === true;
    }
    check('第二章行进入视口', bOk, bLast);

    /* ============ 用例 C：排版关 · 目录仍可用 ============ */
    console.log('\n=== 用例 C · 排版关 ===');
    await toggleLayout();
    await waitToc(5, '排版关后目录条目');
    toc = await readToc();
    check('原文行同样识别 5 个标题', toc.items.length === 5, JSON.stringify(toc.items.map(x => x.t)));
    await clickToc('第一节　车床的结构');
    check('排版关下跳转仍工作', (await rowVisible('第一节　车床的结构')) === true, String(await rowVisible('第一节　车床的结构')));
    await toggleLayout();          // 排版开回来（收尾）
    await sleep(400);

    /* ============ 用例 D：无章节文件 → 空态 ============ */
    console.log('\n=== 用例 D · 无章节文件 ===');
    await cdp.send('Page.reload');
    await cdp.waitFor(`document.readyState === 'complete'`, { timeoutMs: 30000 });
    await cdp.waitFor(`document.getElementById('app') !== null && document.getElementById('fileInput') !== null`, { timeoutMs: 30000, label: '页面标记(重载后)' });
    await sleep(300);
    await openFile(pPlain);
    await cdp.waitFor(`document.querySelector('#content .row') !== null`, { timeoutMs: 60000, label: '首屏' });
    await sleep(900);              // 防抖 300ms + 扫描
    toc = await readToc();
    check('无标题 → 空态提示', toc.empty === true && toc.items.length === 0, JSON.stringify(toc));
  } catch (e) {
    console.error('验证失败:', e.stack);
    failCount++;
  } finally {
    if (cdp) cdp.close();
    await killBrowser(child);
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
  console.log('PASS ' + passCount + ' FAIL ' + failCount);
  process.exitCode = failCount ? 1 : 0;
}

main().catch(e => { console.error(e); process.exit(1); });
