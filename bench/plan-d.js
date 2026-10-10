'use strict';
/* ============================================================================
 * PLAN-2026-1001-D 标注摘录与知识库导出 · 验收脚本
 *
 * 覆盖验收判据（docs/plans/PLAN-2026-1001-D §6）：
 *   1. 可选中文本生成高亮，刷新后仍在
 *   2. 摘录面板按文件分组，点击可跳回原文位置（含排版开关切换后）
 *   3. 导出 Markdown 含引用与反链格式
 *   4. 多文件摘录互不串档（含同尺寸文件场景）
 *   5. 搜索高亮与摘录高亮可同时正确显示
 *   6. 关闭排版 / 重新打开文件后摘录定位不漂移
 *   7. 不破坏单文件零依赖约束（外部请求数 == 0，见运行输出）
 *
 * 附带验证：toast 引用修复（选区高亮后必须真的弹出提示）。
 *
 * 用法：node bench/out/plan-d-test.js [--port 9530]
 * ========================================================================== */

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { CDP, launchBrowser, waitForDevTools, findPageTarget, killBrowser, sleep } = require('./lib/cdp');

const ROOT = path.resolve(__dirname, '..');   // 本脚本在 bench/ 下（移植自 bench/out/ 时纠正：原 '../..' 少一级）
const MAIN_HTML = path.join(ROOT, 'txt-reader.html');
const SAMPLE = path.join(__dirname, 'samples', 'sample-1w.txt');

/* 构造两个字节长度完全相同、内容不同的双文件样本（判据 4「同尺寸文件」） */
function makePairFiles() {
  const line = (t) => t + '\n';
  const a = []
    + line('第一章 试炼之始')
    + line('清晨的雾气还没有散去，山道上的石阶已经被露水打湿。')
    + line('他背起行囊，回头看了一眼山下的村庄，炊烟正袅袅升起。')
    + line('村口的老槐树下，母亲还在那里站着，一动也不动。')
    + line('甲unique甲：只有文件A才有的句子，用来验证导出不串档。')
    + line('路很长，他要走到山的那一边去。');
  const b = []
    + line('第一章 试炼之始')
    + line('夜色像潮水一样漫过屋顶，油灯在桌上投下摇晃的影子。')
    + line('她把信折了三折，塞进衣袖，推开了后院的木门。')
    + line('院里的桂花开了，香气一阵一阵地涌进屋来。')
    + line('乙unique乙：只有文件B才有的句子，用来验证导出不串档。')
    + line('月亮很圆，圆得像一枚新铸的铜钱。');
  const fa = path.join(__dirname, 'out', 'd-pair-a.txt');
  const fb = path.join(__dirname, 'out', 'd-pair-b.txt');
  // 补齐到等长（在末行后补空格，不影响前面内容）
  const n = Math.max(a.length, b.length);
  const pad = (s) => s + ' '.repeat(n - s.length);
  fs.mkdirSync(path.join(__dirname, 'out'), { recursive: true });
  fs.writeFileSync(fa, pad(a), 'utf8');
  fs.writeFileSync(fb, pad(b), 'utf8');
  return [fa, fb];
}

let passCount = 0, failCount = 0;
function check(name, ok, detail) {
  if (ok) { passCount++; console.log('  PASS  ' + name + (detail ? '  (' + detail + ')' : '')); }
  else { failCount++; console.log('  FAIL  ' + name + (detail ? '  (' + detail + ')' : '')); }
}

async function main() {
  const port = (() => {
    const i = process.argv.indexOf('--port');
    return i > 0 ? parseInt(process.argv[i + 1], 10) : 9530;
  })();
  const pair = makePairFiles();
  const child = await launchBrowser({
    port,
    profileDir: path.join(__dirname, '.profile', 'd' + port),
    url: pathToFileURL(MAIN_HTML).href,
  });
  let cdp = null;
  try {
    await waitForDevTools(port);
    const target = await findPageTarget(port, 'txt-reader');
    // urlHint 必须给：启动早期 /json 里可能有扩展/新标签页类型的 page target 排在前面，
    // 连错 target 时 readyState 照样是 complete、但永远等不到 #app（2026-10-10 实测踩坑）
    cdp = await CDP.connect(target.webSocketDebuggerUrl);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('DOM.enable');
    await cdp.waitFor(`document.readyState === 'complete'`, { timeoutMs: 30000 });
    // 启动竞态防御（2026-10-10 实测踩坑）：readyState 在 about:blank 上也是 'complete' ——
    // 冷 profile 下 Edge 的 file:// 导航可能还没发生，此时 querySelector('#fileInput')
    // 返回 nodeId 0，setFileInputFiles 会报「Could not find node with given id」。
    // 必须等真实页面的标记元素出现，才算导航完成。
    await cdp.waitFor(`document.getElementById('app') !== null && document.getElementById('fileInput') !== null`, { timeoutMs: 30000, label: '页面标记' });
    await sleep(300);

    const openFiles = async (files) => {
      const { root } = await cdp.send('DOM.getDocument');
      const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: '#fileInput' });
      await cdp.send('DOM.setFileInputFiles', { nodeId, files });
    };
    const waitForRows = () => cdp.waitFor(`document.querySelector('#content .row') !== null`, { timeoutMs: 60000, label: '首屏' });
    // 程序化选中第 k 个可见行的 [c1, c2) 字符并等待浮动工具条出现
    const selectAndAct = async (rowIdx, c1, c2, btnId) => {
      await cdp.eval(`(() => {
        const row = document.querySelectorAll('#content .row')[${rowIdx}];
        const tx = row.querySelector('.tx');
        const tn = [...tx.childNodes].find(n => n.nodeType === 3);
        const sel = window.getSelection(); sel.removeAllRanges();
        const r = document.createRange();
        r.setStart(tn, ${c1}); r.setEnd(tn, ${c2});
        sel.addRange(r);
        return tx.textContent.slice(${c1}, ${c2});
      })()`, { awaitPromise: false });
      await sleep(500);          // selectionchange → 320ms 防抖 → showSelBar
      const barShown = await cdp.eval(`document.getElementById('selBar').classList.contains('show')`, { awaitPromise: false });
      if (!barShown) throw new Error('浮动工具条未出现');
      await cdp.eval(`document.getElementById('${btnId}').click(); true`, { awaitPromise: false });
      await sleep(200);
    };
    const rowCount = () => cdp.eval(`document.querySelectorAll('#content .hlx-ch').length`, { awaitPromise: false });

    /* ============ 用例 0：打开样本文件 ============ */
    await openFiles([SAMPLE]);
    await waitForRows();
    await sleep(500);
    const fileName = await cdp.eval(`document.getElementById('stFile').textContent`, { awaitPromise: false });
    console.log('\n=== 用例 0 · 打开文件 ===\n  已打开: ' + fileName);

    /* ============ 判据 1：选中 → 高亮 → 刷新后仍在 ============ */
    console.log('\n=== 判据 1 · 选中生成高亮，刷新后仍在 ===');
    await selectAndAct(6, 2, 14, 'selHlBtn');
    const afterHl = await rowCount();
    check('选中后正文出现摘录高亮 span', afterHl > 0, afterHl + ' 处');
    const toastTxt = await cdp.eval(`document.getElementById('toast').textContent`, { awaitPromise: false });
    const toastShown = await cdp.eval(`document.getElementById('toast').classList.contains('show')`, { awaitPromise: false });
    check('toast 真实弹出（v1 起 toast=null 的隐性缺陷已修）', toastShown && toastTxt.indexOf('已高亮') >= 0, toastTxt);
    const exCount1 = await cdp.eval(`document.getElementById('exCount').textContent`, { awaitPromise: false });
    check('摘录面板计数 +1', exCount1 === '1', 'exCount=' + exCount1);
    const hlText = await cdp.eval(`document.querySelector('#content .hlx-ch').textContent`, { awaitPromise: false });
    const stored = await cdp.eval(`(() => { const m = JSON.parse(localStorage.getItem('txtreader-excerpts-v1') || '{}'); const ks = Object.keys(m); return { keys: ks.length, first: m[ks[0]] && m[ks[0]].entries[0] && m[ks[0]].entries[0].text }; })()`, { awaitPromise: false });
    check('存储里 text 与高亮文本一致', stored.first === hlText, JSON.stringify(stored.first).slice(0, 40));
    // 真重开（先清空文件列表再重开 —— setFileInputFiles 同路径文件会被 addFiles 去重，走不到 openFile）
    await cdp.eval(`document.getElementById('clearFilesBtn').click(); true`, { awaitPromise: false });
    await sleep(400);
    await openFiles([SAMPLE]);
    await waitForRows();
    await sleep(800);
    const afterReload = await rowCount();
    check('重新打开文件后高亮仍在', afterReload > 0, afterReload + ' 处');
    const hlText2 = await cdp.eval(`document.querySelector('#content .hlx-ch').textContent`, { awaitPromise: false });
    check('重开后高亮文本不变', hlText2 === hlText, JSON.stringify(hlText2).slice(0, 40));

    /* ============ 判据 5：搜索高亮与摘录高亮同时正确显示 ============ */
    console.log('\n=== 判据 5 · 搜索高亮与摘录高亮层叠 ===');
    const kw = (hlText || '').slice(0, 2);
    await cdp.eval(`document.getElementById('locSearch').value = ${JSON.stringify(kw)}; true`, { awaitPromise: false });
    await cdp.eval(`document.getElementById('locSearchBtn').click(); true`, { awaitPromise: false });
    await sleep(700);
    const overlap = await cdp.eval(`(() => {
      const rows = document.querySelectorAll('#content .row');
      for (const row of rows) {
        const mark = row.querySelector('mark.kw');
        const hlx = row.querySelector('.hlx-ch');
        if (mark && hlx) {
          // 判定优先级：mark 不得出现在 .hlx-ch 内部（kw 挖走重叠区）
          const nested = !!mark.closest('.hlx-ch');
          return { found: true, nested: nested, markText: mark.textContent, html: row.querySelector('.tx').innerHTML.slice(0, 200) };
        }
      }
      return { found: false };
    })()`, { awaitPromise: false });
    check('同行同时出现 mark.kw 与 hlx-ch', overlap.found === true, overlap.found ? JSON.stringify(overlap.markText) : '未找到同现行');
    check('搜索高亮优先（mark 未被包进摘录 span 内）', overlap.found && overlap.nested === false);
    // 清掉搜索
    await cdp.eval(`document.getElementById('locSearch').value = ''; document.getElementById('locSearchBtn').click(); true`, { awaitPromise: false });
    await sleep(300);

    /* ============ 判据 2 + 6：面板跳回 + 排版开关不漂移 ============ */
    console.log('\n=== 判据 2/6 · 面板跳回与排版开关 ===');
    const itemInfo = await cdp.eval(`(() => {
      const item = document.querySelector('#exList .ex-item');
      return { line: item && item.querySelector('.ex-line').textContent, text: item && item.querySelector('.li-name').textContent };
    })()`, { awaitPromise: false });
    check('面板有条目且带行号', !!(itemInfo.line && itemInfo.line.indexOf('L') === 0), JSON.stringify(itemInfo.line));
    // 滚到文件中部再点跳回
    await cdp.eval(`document.getElementById('viewport').scrollTop = 200000; true`, { awaitPromise: false });
    await sleep(500);
    const sc0 = await cdp.eval(`document.getElementById('viewport').scrollTop`, { awaitPromise: false });
    await cdp.eval(`document.querySelector('#exList .ex-item').click(); true`, { awaitPromise: false });
    await sleep(700);
    const sc1 = await cdp.eval(`document.getElementById('viewport').scrollTop`, { awaitPromise: false });
    check('点击面板条目跳回原文位置', sc0 > 0 && sc1 < 5000, sc0 + ' → ' + sc1);
    const jumpHl = await rowCount();
    check('跳回后高亮可见', jumpHl > 0, jumpHl + ' 处');
    // 切排版开关（当前开 → 关）
    await cdp.eval(`document.getElementById('layoutToggleBtn').click(); true`, { awaitPromise: false });
    await sleep(1200);
    const afterToggle = await rowCount();
    check('关闭排版后高亮仍在（定位不漂移）', afterToggle > 0, afterToggle + ' 处');
    const hlText3 = await cdp.eval(`document.querySelector('#content .hlx-ch').textContent`, { awaitPromise: false });
    check('排版开关后高亮文本不变', hlText3 === hlText, JSON.stringify(hlText3).slice(0, 40));
    // 再跳一次（排版关闭态下）
    await cdp.eval(`document.getElementById('viewport').scrollTop = 200000; true`, { awaitPromise: false });
    await sleep(400);
    await cdp.eval(`document.querySelector('#exList .ex-item').click(); true`, { awaitPromise: false });
    await sleep(700);
    const sc2 = await cdp.eval(`document.getElementById('viewport').scrollTop`, { awaitPromise: false });
    check('排版关闭态下仍能跳回', sc2 < 5000, 'scrollTop=' + sc2);

    /* ============ 判据 3：导出 Markdown 含引用与反链 ============ */
    console.log('\n=== 判据 3 · 导出 Markdown ===');
    const md1 = await cdp.eval(`(async () => {
      let captured = null;
      navigator.clipboard.writeText = (t) => { captured = t; return Promise.resolve(); };
      document.getElementById('exCopyBtn').click();
      await new Promise(r => setTimeout(r, 300));
      return captured;
    })()`, { awaitPromise: true, returnByValue: true });
    check('导出内容非空', !!md1 && md1.length > 50, md1 ? md1.length + ' 字符' : 'null');
    check('含 > 引用块', md1.indexOf('\n> ') >= 0 || md1.indexOf('> ') === 0);
    check('含 [[文件名]] 反链', /\[\[.+\]\]/.test(md1), (md1.match(/\[\[.+?\]\]/g) || []).join(','));
    check('含文件名标题', md1.indexOf('## ' + fileName) >= 0, '## ' + fileName);

    /* ============ 判据 4：多文件（同尺寸）不串档 ============ */
    console.log('\n=== 判据 4 · 多文件同尺寸不串档 ===');
    await cdp.eval(`document.getElementById('clearFilesBtn').click(); true`, { awaitPromise: false });
    await sleep(400);
    const goneMarked = await cdp.eval(`document.getElementById('exList').textContent.indexOf('文件已移除') >= 0`, { awaitPromise: false });
    check('文件关闭后面板标「文件已移除」', goneMarked === true);
    // 清掉判据 1/2 留下的 sample 摘录，让本判据的分组数可精确断言（只动测试数据，不动产品）
    await cdp.eval(`localStorage.removeItem('txtreader-excerpts-v1'); true`, { awaitPromise: false });
    await openFiles(pair);          // 两个同尺寸文件
    await waitForRows();
    await sleep(500);
    // 文件 A：选中独特句加高亮
    await selectAndAct(4, 0, 12, 'selHlBtn');
    const uniqA = '甲unique甲';
    // 切到文件 B（文件列表第 2 项）
    await cdp.eval(`document.querySelectorAll('#fileList .list-item')[1].click(); true`, { awaitPromise: false });
    await sleep(900);
    const nameB = await cdp.eval(`document.getElementById('stFile').textContent`, { awaitPromise: false });
    check('已切到文件 B', path.basename(nameB) === 'd-pair-b.txt', nameB);
    // B 走「摘录」路径：stub 掉 prompt（无头下阻塞对话框），顺带验证备注随摘录落库
    await cdp.eval(`window.prompt = () => '测试备注内容'; true`, { awaitPromise: false });
    await selectAndAct(4, 0, 12, 'selExBtn');
    // 导出并校验两个文件的摘录各归各
    const md2 = await cdp.eval(`(async () => {
      let captured = null;
      navigator.clipboard.writeText = (t) => { captured = t; return Promise.resolve(); };
      document.getElementById('exCopyBtn').click();
      await new Promise(r => setTimeout(r, 300));
      return captured;
    })()`, { awaitPromise: true, returnByValue: true });
    check('导出含 A 文件独特句', md2.indexOf(uniqA) >= 0);
    check('导出含 B 文件独特句', md2.indexOf('乙unique乙') >= 0);
    check('导出按文件分组（两个 ## 小节）', (md2.match(/^## /gm) || []).length === 2, (md2.match(/^## /gm) || []).length + ' 节');
    check('反链含两个文件名', md2.indexOf('[[d-pair-a]]') >= 0 && md2.indexOf('[[d-pair-b]]') >= 0);
    check('备注随摘录导出', md2.indexOf('备注：测试备注内容') >= 0);
    check('A 的摘录没串到 B 名下', (() => {
      const secB = md2.slice(md2.indexOf('## d-pair-b.txt'));
      return secB.indexOf(uniqA) < 0;
    })());
    // 回到文件 A：高亮仍在（指纹隔离不串档的另一面 —— 同 key 回来就恢复）
    await cdp.eval(`document.querySelectorAll('#fileList .list-item')[0].click(); true`, { awaitPromise: false });
    await sleep(900);
    const backA = await rowCount();
    check('切回文件 A 后摘录高亮恢复', backA > 0, backA + ' 处');

    /* ============ 判据 7：零依赖（无外部请求） ============ */
    const ext = await cdp.eval(`performance.getEntriesByType('resource').filter(r => !r.name.startsWith('file://')).length`, { awaitPromise: false });
    check('零外部资源请求', ext === 0, ext + ' 个外部请求');
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
