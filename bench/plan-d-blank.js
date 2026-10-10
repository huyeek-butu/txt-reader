'use strict';
/* ============================================================================
 * 跨空行摘录 · 回归测试（v1.21-blank-excerpt 修复验证）
 *
 * 病根（v1.20）：captureSelection 按「行内区间 e>s」过滤，空行的 [0,0) 区间被丢弃
 *   → 文本快照丢空行（"甲\n乙"，实际应为 "甲\n\n乙"）
 *   → resolveAll 逐行反查走到真实空行处断链 → 高亮定位失败、跳转失效。
 *
 * 覆盖：
 *   1. 跨排版合成空行选区（排版开）→ 快照保住 \n\n，两侧均有高亮
 *   2. 跨真实空行选区 → 快照正确；排版开/关两种视图下都能定位（不漂移）
 *   3. 面板跳回（跨空行条目）
 *   4. 选区止于空行（尾部空段）→ 仍能定位
 *   5. 导出 Markdown 空行为 '> ' 行（引用块不断裂）
 *
 * 已知边界（v1.20 起既有，非本次引入，不在本测试断言范围）：
 *   跨「排版合成空行」的多行摘录，切到排版关后快照的 '\n' 边界与原文行形态不一致 → 失定位。
 *   快照格式本身是「逐逻辑行」的，跨视图互认只在真实空行处成立。
 *
 * 用法：node bench/plan-d-blank.js [--port 9531]
 * ========================================================================== */

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { CDP, launchBrowser, waitForDevTools, findPageTarget, killBrowser, sleep } = require('./lib/cdp');

const ROOT = path.resolve(__dirname, '..');
const MAIN_HTML = path.join(ROOT, 'txt-reader.html');
const SAMPLE = path.join(__dirname, 'out', 'blank-sample.txt');

/* 样本：前三段夹真实空行（排版开/关两种视图都保留）；每行 >6 字（SHORT_SENT），
 * 排版开时每句独立成段、段间合成空行 —— 两种空行形态都能测到。
 * 末尾 150 个填充段把文件撑高，否则小文件滚不动，「跳回」断言前提不成立。 */
function makeSample() {
  fs.mkdirSync(path.join(__dirname, 'out'), { recursive: true });
  const head = [
    '第一章 风起',
    '夜风掠过屋檐，铜铃轻响。',
    '他推门而出，院中月色如水。',
    '',
    '远处传来更鼓声声，已是三更天。',
    '山道尽头有一点灯火，忽明忽暗。',
    '',
    '天亮之前，他必须赶回村里。',
    '母亲会把热汤留在灶上。',
  ].join('\n') + '\n';
  let filler = '';
  for (let i = 0; i < 150; i++) filler += '填充第' + (i + 1) + '段，这一行用来把文件撑高让滚动真实存在。\n';
  fs.writeFileSync(SAMPLE, head + filler, 'utf8');
  return SAMPLE;
}

let passCount = 0, failCount = 0;
function check(name, ok, detail) {
  if (ok) { passCount++; console.log('  PASS  ' + name + (detail ? '  (' + detail + ')' : '')); }
  else { failCount++; console.log('  FAIL  ' + name + (detail ? '  (' + detail + ')' : '')); }
}

async function main() {
  const port = (() => {
    const i = process.argv.indexOf('--port');
    return i > 0 ? parseInt(process.argv[i + 1], 10) : 9531;
  })();
  makeSample();
  const child = await launchBrowser({
    port,
    profileDir: path.join(__dirname, '.profile', 'blank' + port),
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
    const rowCount = () => cdp.eval(`document.querySelectorAll('#content .hlx-ch').length`, { awaitPromise: false });

    // 程序化跨行选区：从含 sub1 的行的 sub1 处，到含 sub2 的行的 sub2 末尾；
    // sub2 传 null 则选区止于「下一非空行」行首（即尾部带一个空行的边缘形态）
    const selectAcross = async (sub1, sub2) => {
      const ok = await cdp.eval(`(() => {
        const findRow = (sub) => [...document.querySelectorAll('#content .row')]
          .find(r => r.querySelector('.tx').textContent.indexOf(sub) >= 0);
        const ra = findRow(${JSON.stringify(sub1)});
        if (!ra) return 'row1未找到';
        const findTn = (el, sub) => {
          for (const n of el.querySelector('.tx').childNodes) {
            if (n.nodeType === 3) { const i = n.textContent.indexOf(sub); if (i >= 0) return [n, i]; }
          }
          return null;
        };
        const A = findTn(ra, ${JSON.stringify(sub1)});
        if (!A) return 'textnode1未找到';
        const sel = window.getSelection(); sel.removeAllRanges();
        const r = document.createRange();
        r.setStart(A[0], A[1]);
        if (${sub2 ? 'true' : 'false'}) {
          const rb = findRow(${JSON.stringify(sub2)});
          if (!rb) return 'row2未找到';
          const B = findTn(rb, ${JSON.stringify(sub2)});
          if (!B) return 'textnode2未找到';
          r.setEnd(B[0], B[1] + ${JSON.stringify(sub2)}.length);
        } else {
          const rows = [...document.querySelectorAll('#content .row')];
          const i0 = rows.indexOf(ra);
          const nxt = rows.slice(i0 + 1).find(x => x.querySelector('.tx').textContent.length > 0);
          if (!nxt) return '下一非空行未找到';
          const tn = [...nxt.querySelector('.tx').childNodes].find(n => n.nodeType === 3);
          if (!tn) return '下一非空行无文本节点';
          r.setEnd(tn, 0);
        }
        sel.addRange(r);
        return true;
      })()`, { awaitPromise: false });
      if (ok !== true) throw new Error('选区构造失败: ' + ok);
      await sleep(500);          // selectionchange → 320ms 防抖 → showSelBar
      const barShown = await cdp.eval(`document.getElementById('selBar').classList.contains('show')`, { awaitPromise: false });
      if (!barShown) throw new Error('浮动工具条未出现');
    };
    const clickBtn = async (btnId) => {
      await cdp.eval(`document.getElementById('${btnId}').click(); true`, { awaitPromise: false });
      await sleep(300);
    };
    const storedTexts = async () => cdp.eval(`(() => {
      const m = JSON.parse(localStorage.getItem('txtreader-excerpts-v1') || '{}');
      return Object.keys(m).flatMap(k => (m[k].entries || []).map(e => e.text));
    })()`, { awaitPromise: false });
    // 摘录高亮的行级探针：返回含 sub 的行上、文本含 sub 的 .hlx-ch（同行可能有多条摘录高亮）
    const hlOf = (sub) => cdp.eval(`(() => {
      const row = [...document.querySelectorAll('#content .row')]
        .find(r => r.querySelector('.tx').textContent.indexOf(${JSON.stringify(sub)}) >= 0);
      if (!row) return 'row未渲染';
      const hlx = [...row.querySelectorAll('.hlx-ch')].find(h => h.textContent.indexOf(${JSON.stringify(sub)}) >= 0);
      return hlx ? hlx.textContent : null;
    })()`, { awaitPromise: false });

    /* ============ 准备：清历史摘录 + 开样本（排版默认开） ============ */
    await cdp.eval(`localStorage.removeItem('txtreader-excerpts-v1'); true`, { awaitPromise: false });
    await openFiles([SAMPLE]);
    await cdp.waitFor(`document.querySelector('#content .row') !== null`, { timeoutMs: 60000, label: '首屏' });
    await sleep(500);

    /* ============ 用例 1：跨「排版合成空行」选区（排版开） ============ */
    console.log('\n=== 用例 1 · 跨合成空行（排版开） ===');
    await selectAcross('铜铃轻响', '推门而出');    // 快照应为「铜铃轻响。\n\n他推门而出」
    await clickBtn('selHlBtn');
    const texts1 = await storedTexts();
    check('快照文本保住空行（\\n\\n）', texts1.indexOf('铜铃轻响。\n\n他推门而出') >= 0, JSON.stringify(texts1));
    check('空行前一行有高亮', (await hlOf('铜铃轻响')) === '铜铃轻响。', JSON.stringify(await hlOf('铜铃轻响')));
    check('空行后一行有高亮', (await hlOf('推门而出')) === '他推门而出', JSON.stringify(await hlOf('推门而出')));
    const exCount1 = await cdp.eval(`document.getElementById('exCount').textContent`, { awaitPromise: false });
    check('摘录面板计数 = 1', exCount1 === '1', 'exCount=' + exCount1);

    /* ============ 用例 2：跨「真实空行」选区（排版开，空行在原文里也存在） ============ */
    console.log('\n=== 用例 2 · 跨真实空行（排版开） ===');
    await selectAcross('月色如水', '远处传来');    // 快照应为「月色如水。\n\n远处传来」
    await clickBtn('selHlBtn');
    const texts2 = await storedTexts();
    check('快照文本正确', texts2.indexOf('月色如水。\n\n远处传来') >= 0, JSON.stringify(texts2));
    check('空行前一行有高亮', (await hlOf('月色如水')) === '月色如水。', JSON.stringify(await hlOf('月色如水')));
    check('空行后一行有高亮', (await hlOf('远处传来')) === '远处传来', JSON.stringify(await hlOf('远处传来')));
    const exCount2 = await cdp.eval(`document.getElementById('exCount').textContent`, { awaitPromise: false });
    check('摘录面板计数 = 2', exCount2 === '2', 'exCount=' + exCount2);

    /* ============ 用例 3：面板跳回 ============ */
    console.log('\n=== 用例 3 · 跨空行条目跳回 ===');
    await cdp.eval(`document.getElementById('viewport').scrollTop = 200000; true`, { awaitPromise: false });
    await sleep(400);
    const sc0 = await cdp.eval(`document.getElementById('viewport').scrollTop`, { awaitPromise: false });
    await cdp.eval(`document.querySelector('#exList .ex-item').click(); true`, { awaitPromise: false });
    await sleep(700);
    const sc1 = await cdp.eval(`document.getElementById('viewport').scrollTop`, { awaitPromise: false });
    check('点击面板条目跳回原文', sc0 > 0 && sc1 < 5000, sc0 + ' → ' + sc1);
    check('跳回后高亮可见', (await rowCount()) > 0);

    /* ============ 用例 4：排版开关后「真实空行」摘录不漂移 ============ */
    console.log('\n=== 用例 4 · 排版开关不漂移（真实空行） ===');
    await cdp.eval(`document.getElementById('layoutToggleBtn').click(); true`, { awaitPromise: false });
    await sleep(1200);
    check('关闭排版后「月色如水」行仍有高亮', (await hlOf('月色如水')) === '月色如水。', JSON.stringify(await hlOf('月色如水')));
    check('关闭排版后「远处传来」行仍有高亮', (await hlOf('远处传来')) === '远处传来', JSON.stringify(await hlOf('远处传来')));
    await cdp.eval(`document.getElementById('viewport').scrollTop = 200000; true`, { awaitPromise: false });
    await sleep(400);
    // 点「月色如水」那条（面板预览含该词）
    await cdp.eval(`(() => {
      const item = [...document.querySelectorAll('#exList .ex-item')].find(x => x.textContent.indexOf('月色如水') >= 0);
      if (item) item.click();
      return !!item;
    })()`, { awaitPromise: false });
    await sleep(700);
    const sc2 = await cdp.eval(`document.getElementById('viewport').scrollTop`, { awaitPromise: false });
    check('排版关闭态下仍能跳回', sc2 < 5000, 'scrollTop=' + sc2);

    /* ============ 用例 5：选区止于空行（尾部空段，排版关） ============ */
    console.log('\n=== 用例 5 · 选区止于空行 ===');
    await selectAcross('灯火，忽明忽暗', null);    // 快照应为「灯火，忽明忽暗。\n」（尾部空段）
    await clickBtn('selHlBtn');
    const texts5 = await storedTexts();
    check('尾部空段快照保留', texts5.indexOf('灯火，忽明忽暗。\n') >= 0, JSON.stringify(texts5));
    check('止于空行的摘录仍能定位高亮', (await hlOf('灯火，忽明忽暗')) === '灯火，忽明忽暗。', JSON.stringify(await hlOf('灯火，忽明忽暗')));

    /* ============ 用例 6：导出 Markdown 空行为 '> ' 行 ============ */
    console.log('\n=== 用例 6 · 导出 Markdown ===');
    const md = await cdp.eval(`(async () => {
      let captured = null;
      navigator.clipboard.writeText = (t) => { captured = t; return Promise.resolve(); };
      document.getElementById('exCopyBtn').click();
      await new Promise(r => setTimeout(r, 300));
      return captured;
    })()`, { awaitPromise: true, returnByValue: true });
    check('空行在引用块内为 "> " 行（块不断裂）', md.indexOf('> 铜铃轻响。\n> \n> 他推门而出') >= 0);
    check('真实空行摘录同样保留', md.indexOf('> 月色如水。\n> \n> 远处传来') >= 0);
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
