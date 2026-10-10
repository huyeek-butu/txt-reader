'use strict';
/* ============================================================================
 * 侧栏面板独占 · 回归测试（v1.23-panel-solo）
 *
 * 需求：单击面板标题栏 → 其他栏最小化为标题条、该栏铺满其余空间；
 *       再单击该栏标题栏 → 恢复三栏默认均分。
 *
 * 覆盖：
 *   0. 基线：三栏默认均分
 *   1. 单击标题栏 → 独占（其他栏 body 隐藏、高度=标题条；该栏铺满）
 *   2. 标题栏内按钮不触发独占（chev 折叠照旧、面板操作按钮照旧）
 *   3. 独占中点另一栏 → 切换独占
 *   4. 再单击独占栏标题栏 → 还原三栏均分
 *   5. 被折叠过的栏独占时自动展开
 *
 * 用法：node bench/panel-solo.js [--port 9533]
 * ========================================================================== */

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { CDP, launchBrowser, waitForDevTools, findPageTarget, killBrowser, sleep } = require('./lib/cdp');

const ROOT = path.resolve(__dirname, '..');
const MAIN_HTML = path.join(ROOT, 'txt-reader.html');
const SAMPLE = path.join(__dirname, 'samples', 'sample-1w.txt');

let passCount = 0, failCount = 0;
function check(name, ok, detail) {
  if (ok) { passCount++; console.log('  PASS  ' + name + (detail ? '  (' + detail + ')' : '')); }
  else { failCount++; console.log('  FAIL  ' + name + (detail ? '  (' + detail + ')' : '')); }
}

async function main() {
  const port = (() => {
    const i = process.argv.indexOf('--port');
    return i > 0 ? parseInt(process.argv[i + 1], 10) : 9533;
  })();
  const child = await launchBrowser({
    port,
    profileDir: path.join(__dirname, '.profile', 'solo' + port),
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

    const openFiles = async (files) => {
      const { root } = await cdp.send('DOM.getDocument');
      const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: '#fileInput' });
      await cdp.send('DOM.setFileInputFiles', { nodeId, files });
    };
    await openFiles([SAMPLE]);
    await cdp.waitFor(`document.querySelector('#content .row') !== null`, { timeoutMs: 60000, label: '首屏' });
    await sleep(500);

    // 布局读数：三栏高度 / body 可见性 / solo-mode 状态
    const readLayout = () => cdp.eval(`(() => {
      const ids = ['filePanel', 'searchPanel', 'excerptPanel'];
      const o = { soloMode: document.getElementById('sidebar').classList.contains('solo-mode') };
      for (const id of ids) {
        const p = document.getElementById(id);
        const body = p.querySelector('.panel-body');
        o[id] = {
          h: Math.round(p.getBoundingClientRect().height),
          bodyH: body.getBoundingClientRect().height,
          bodyShown: getComputedStyle(body).display !== 'none',
          soloed: p.classList.contains('soloed'),
          collapsed: p.classList.contains('collapsed'),
        };
      }
      const sb = document.getElementById('sidebar');
      o.sidebarH = sb.clientHeight;
      o.panelCount = sb.querySelectorAll('.panel').length;   // v1.25 起四栏（文件/搜索/目录/摘录）
      o.allSum = [...sb.querySelectorAll('.panel')].reduce((a, p) => a + Math.round(p.getBoundingClientRect().height), 0);
      return o;
    })()`, { awaitPromise: false, returnByValue: true });
    // 点击标题栏（target 指定栏、点标题文字而非按钮）；times 参数保留兼容旧调用
    const clickHead = async (panelId, times) => {
      await cdp.eval(`(() => {
        const head = document.querySelector('#${panelId} > .panel-head');
        const span = head.querySelector('span');           // 标题文字，非按钮
        for (let i = 0; i < ${times || 1}; i++) span.click();
        return true;
      })()`, { awaitPromise: false });
      await sleep(150);
    };
    const approx = (a, b, tol) => Math.abs(a - b) <= tol;
    // 独占是否铺满：全部面板高度和 = 侧栏内高 − 间隙（12px × (栏数−1)；v1.25 起四栏 3 间隙）
    // 各栏标题条因按钮数不同不等高，不能假设统一 header 高
    const fillsSolo = (L) => approx(L.allSum, L.sidebarH - 12 * (L.panelCount - 1), 4);

    /* ============ 用例 0：三栏默认均分 ============ */
    console.log('\n=== 用例 0 · 三栏默认均分 ===');
    let L = await readLayout();
    check('无 solo-mode', L.soloMode === false);
    check('三栏高度均分（±2px）', approx(L.filePanel.h, L.searchPanel.h, 2) && approx(L.searchPanel.h, L.excerptPanel.h, 2), L.filePanel.h + '/' + L.searchPanel.h + '/' + L.excerptPanel.h);
    check('三栏 body 均可见', L.filePanel.bodyShown && L.searchPanel.bodyShown && L.excerptPanel.bodyShown);

    /* ============ 用例 1：单击标题栏 → 独占 ============ */
    console.log('\n=== 用例 1 · 单击独占 ===');
    await clickHead('searchPanel', 1);
    L = await readLayout();
    check('sidebar 进入 solo-mode', L.soloMode === true);
    check('searchPanel 标记 soloed', L.searchPanel.soloed === true);
    check('其他两栏 body 隐藏', !L.filePanel.bodyShown && !L.excerptPanel.bodyShown);
    const headerH = L.filePanel.h;
    check('其他两栏收成标题条（<60px）', L.filePanel.h < 60 && L.excerptPanel.h < 60, headerH + '/' + L.excerptPanel.h);
    check('独占栏铺满其余空间（全部面板和=侧栏内高−间隙，±4px）', fillsSolo(L), 'allSum=' + L.allSum + ' 期望≈' + (L.sidebarH - 12 * (L.panelCount - 1)));
    check('独占栏 body 可见', L.searchPanel.bodyShown === true);

    /* ============ 用例 2：标题栏内按钮不触发独占 ============ */
    console.log('\n=== 用例 2 · 按钮照旧 ===');
    await cdp.eval(`document.querySelector('#filePanel .chev').click(); true`, { awaitPromise: false });
    await sleep(150);
    L = await readLayout();
    check('chev 折叠照旧（collapsed 类生效）', L.filePanel.collapsed === true);
    check('chev 点击未改变独占状态', L.soloMode === true && L.searchPanel.soloed === true);
    await cdp.eval(`document.querySelector('#filePanel .chev').click(); true`, { awaitPromise: false });   // 还原折叠
    await sleep(150);
    await cdp.eval(`document.getElementById('exCopyBtn').click(); true`, { awaitPromise: false });          // 无摘录 → 只 toast
    await sleep(150);
    L = await readLayout();
    check('面板操作按钮（exCopyBtn）不触发独占', L.soloMode === true && L.searchPanel.soloed === true && !L.excerptPanel.soloed);

    /* ============ 用例 3：独占中点另一栏 → 切换 ============ */
    console.log('\n=== 用例 3 · 切换独占 ===');
    await clickHead('filePanel', 1);
    L = await readLayout();
    check('filePanel 成为独占栏', L.soloMode === true && L.filePanel.soloed === true);
    check('searchPanel 退回标题条', !L.searchPanel.soloed && !L.searchPanel.bodyShown && L.searchPanel.h < 60);
    check('filePanel 铺满（全部面板和=侧栏内高−间隙，±4px）', fillsSolo(L), 'allSum=' + L.allSum + ' 期望≈' + (L.sidebarH - 12 * (L.panelCount - 1)));

    /* ============ 用例 4：再单击独占栏标题栏 → 还原 ============ */
    console.log('\n=== 用例 4 · 单击还原 ===');
    await clickHead('filePanel', 1);
    L = await readLayout();
    check('退出 solo-mode', L.soloMode === false);
    check('三栏均无 soloed 标记', !L.filePanel.soloed && !L.searchPanel.soloed && !L.excerptPanel.soloed);
    check('三栏恢复均分（±2px）', approx(L.filePanel.h, L.searchPanel.h, 2) && approx(L.searchPanel.h, L.excerptPanel.h, 2), L.filePanel.h + '/' + L.searchPanel.h + '/' + L.excerptPanel.h);
    check('三栏 body 均恢复可见', L.filePanel.bodyShown && L.searchPanel.bodyShown && L.excerptPanel.bodyShown);

    /* ============ 用例 5：被折叠过的栏独占时自动展开 ============ */
    console.log('\n=== 用例 5 · 折叠栏独占自动展开 ===');
    await cdp.eval(`document.querySelector('#excerptPanel .chev').click(); true`, { awaitPromise: false }); // 先折叠摘录栏
    await sleep(150);
    await clickHead('excerptPanel', 1);
    L = await readLayout();
    check('折叠态被独占清除（collapsed 移除）', L.excerptPanel.collapsed === false);
    check('独占栏 body 可见且铺满', L.excerptPanel.bodyShown && fillsSolo(L), 'allSum=' + L.allSum + ' 期望≈' + (L.sidebarH - 12 * (L.panelCount - 1)));
    await clickHead('excerptPanel', 1);      // 再单击 → 还原，收尾
    await sleep(150);
    L = await readLayout();
    check('还原后退出独占', L.soloMode === false);
  } catch (e) {
    console.error('验证失败:', e.stack);
    failCount++;
  } finally {
    if (cdp) cdp.close();
    await killBrowser(child);
  }
  console.log('PASS ' + passCount + ' FAIL ' + failCount);
  process.exitCode = failCount ? 1 : 0;
}

main().catch(e => { console.error(e); process.exit(1); });
