'use strict';
/* ============================================================================
 * 文件开头书名单独成段 · 回归测试（v1.24-head-title）
 *
 * 病灶：首行书名（有/无书名号）通常没有句末标点，断句前的「换行清洗」会把
 *       「书名\n正文」粘连成一段。修复：layoutParas 增加 head 参数，全文入口
 *       （simpleLayout / simpleLayoutLines / layoutParasFrom 的 cursor===0 首片）
 *       先把文件第一个非空行摘出来单独成段。
 *
 * 覆盖：
 *   A. 无书名号短首行（≤30 字、无句读标点）→ 单独成段
 *   B. 书名号形态《…》→ 书名前缀单独成段
 *   C. 书名号后同行有余文 → 仅书名前缀成段，余文回流正文
 *   D. 首行含句末标点 → 行为不变（不当书名）
 *   E. 首行 >30 字无标点 → 行为不变（不当书名，与后行照旧粘连）
 *
 * 用法：node bench/head-title.js [--port 9534]
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

const BODY = '第一章　车削基础\n\n车削是机械制造中最基础的加工方法之一。车床把工件旋转起来，用刀具沿轴向或径向进给，就能加工出圆柱面、端面和螺纹。';

async function main() {
  const port = (() => {
    const i = process.argv.indexOf('--port');
    return i > 0 ? parseInt(process.argv[i + 1], 10) : 9534;
  })();

  // 样本落盘（临时目录，文件名即用例标识）
  const samples = [
    ['A-无书名号.txt', '机械加工工艺与窍门精选\n' + BODY],
    ['B-书名号.txt', '《机械加工工艺与窍门精选》\n' + BODY],
    ['C-书名号同行余文.txt', '《书名测试》这是同行余文。\n正文第二句。'],
    ['D-首行有句末标点.txt', '夜色渐深。铜铃轻响。\n他推门而出。\n' + BODY],
    ['E-首行超长无标点.txt', '这是一个没有标点并且超过三十个字符长度所以不应该被识别为书名的测试用首行内容继续\n紧随其后的第二行。\n' + BODY],
  ];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'head-title-'));
  const paths = samples.map(([name, content]) => {
    const p = path.join(dir, name);
    fs.writeFileSync(p, content, 'utf8');
    return p;
  });

  const child = await launchBrowser({
    port,
    profileDir: path.join(__dirname, '.profile', 'headtitle' + port),
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

    // 依次打开样本：每个样本前先重载页面（干净状态；连续 setFileInputFiles 不换文件），
    // 读前 6 条渲染行的文本（排版开启时每段一条逻辑行、段间空行）
    const openAndReadRows = async (file) => {
      await cdp.send('Page.reload');
      await cdp.waitFor(`document.readyState === 'complete'`, { timeoutMs: 30000 });
      await cdp.waitFor(`document.getElementById('app') !== null && document.getElementById('fileInput') !== null`, { timeoutMs: 30000, label: '页面标记' });
      await sleep(300);
      const { root } = await cdp.send('DOM.getDocument');
      const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: '#fileInput' });
      await cdp.send('DOM.setFileInputFiles', { nodeId, files: [file] });
      await cdp.waitFor(`document.querySelector('#content .row') !== null`, { timeoutMs: 60000, label: '首屏' });
      await sleep(400);
      const rows = await cdp.eval(`(() => {
        return [...document.querySelectorAll('#content .row')].slice(0, 6)
          .map(r => r.querySelector('.tx') ? r.querySelector('.tx').textContent : r.textContent);
      })()`, { awaitPromise: false, returnByValue: true });
      return rows;
    };

    // 读第一个段落（视觉行会折行：连续非空行拼接直到空行/行尾 = 一个段落）
    const readFirstPara = async () => {
      const rows = await cdp.eval(`(() => {
        return [...document.querySelectorAll('#content .row')].slice(0, 12)
          .map(r => r.querySelector('.tx') ? r.querySelector('.tx').textContent : r.textContent);
      })()`, { awaitPromise: false, returnByValue: true });
      let para = '';
      for (const t of rows) { if (!t) break; para += t; }
      return { para, rows };
    };

    /* ============ 用例 A：无书名号短首行 ============ */
    console.log('\n=== 用例 A · 无书名号 ===');
    let rows = await openAndReadRows(paths[0]);
    check('书名单独成段', rows[0] === '机械加工工艺与窍门精选', JSON.stringify(rows[0]));
    check('书名后有空行', rows[1] === '', JSON.stringify(rows[1]));
    check('正文从第一章起（不与书名粘连）', typeof rows[2] === 'string' && rows[2].startsWith('第一章'), JSON.stringify(rows[2] || '').slice(0, 40));

    /* ============ 用例 B：书名号形态 ============ */
    console.log('\n=== 用例 B · 书名号 ===');
    rows = await openAndReadRows(paths[1]);
    check('书名单独成段（保留书名号）', rows[0] === '《机械加工工艺与窍门精选》', JSON.stringify(rows[0]));
    check('书名后有空行', rows[1] === '', JSON.stringify(rows[1]));
    check('正文从第一章起', typeof rows[2] === 'string' && rows[2].startsWith('第一章'), JSON.stringify(rows[2] || '').slice(0, 40));

    /* ============ 用例 C：书名号后同行有余文 ============ */
    console.log('\n=== 用例 C · 书名号同行余文 ===');
    rows = await openAndReadRows(paths[2]);
    check('仅书名前缀成段', rows[0] === '《书名测试》', JSON.stringify(rows[0]));
    check('余文回流正文（不丢字）', rows[2] === '这是同行余文。', JSON.stringify(rows[2]));
    check('余文之后照常分段', rows[4] === '正文第二句。', JSON.stringify(rows[4]));

    /* ============ 用例 D：首行有句末标点 → 行为不变 ============ */
    console.log('\n=== 用例 D · 首行有句末标点 ===');
    await openAndReadRows(paths[3]);
    let d = await readFirstPara();
    check('连续短句照旧跨行合并（不当书名）', d.para === '夜色渐深。铜铃轻响。他推门而出。', JSON.stringify(d.para.slice(0, 30)));

    /* ============ 用例 E：首行超长无标点 → 行为不变 ============ */
    console.log('\n=== 用例 E · 首行超长无标点 ===');
    await openAndReadRows(paths[4]);
    d = await readFirstPara();
    const longHead = '这是一个没有标点并且超过三十个字符长度所以不应该被识别为书名的测试用首行内容继续';
    check('超长首行不单独成段（与后行照旧粘连）', d.para === longHead + '紧随其后的第二行。', JSON.stringify(d.para.slice(0, 30)) + '…');
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
