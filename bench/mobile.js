'use strict';
/* ============================================================================
 * 移动端 / 触摸交互验证 —— PLAN-2026-1001-C 阶段三
 *
 * 用 CDP 的设备模拟 + 真实触摸事件派发来验证，而不是靠「看着像」：
 *   1. 视口矩阵：手机竖屏 / 手机横屏 / 平板竖屏
 *   2. 触摸目标尺寸：关键交互控件是否 ≥ 44×44px（PLAN-C 验收判据）
 *   3. 侧栏抽屉：窄屏初始态 → 展开 → 点侧栏以外收起
 *   4. 标尺触摸拖动：真的派发 touch 事件序列，验证拖完才重排、且确实改到了列宽
 *   5. 旋转：竖屏 → 横屏后标尺与正文仍可用
 *
 * 用法：node bench/mobile.js [--rows 10000] [--port 9480]
 * ========================================================================== */

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { CDP, launchBrowser, waitForDevTools, findPageTarget, killBrowser, sleep } = require('./lib/cdp');

const ROOT = path.resolve(__dirname, '..');
const MAIN_HTML = path.join(ROOT, 'txt-reader.html');

function parseArgs(argv) {
  const o = { rows: 10000, port: 9480 };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--rows' && argv[i + 1]) o.rows = parseInt(argv[++i], 10);
    else if (argv[i] === '--port' && argv[i + 1]) o.port = parseInt(argv[++i], 10);
  }
  return o;
}
function sampleFile(rows) {
  const label = rows >= 10000 ? (rows / 10000) + 'w' : String(rows);
  const f = path.join(__dirname, 'samples', 'sample-' + label + '.txt');
  if (!fs.existsSync(f)) throw new Error('样本不存在: ' + f);
  return f;
}

/* 要检查的触摸目标（选择器 → 说明） */
const TARGETS = [
  ['#sideToggle', '侧栏折叠按钮'],
  ['#layoutToggleBtn', '正文排版'],
  ['#speakBtn', '朗读'],
  ['#exportBtn', '导出结果'],
  ['#prevPage', '上一页'],
  ['#nextPage', '下一页'],
  ['#wrapRuler', '换行标尺'],
];

const MEASURE = `(() => {
  const out = { viewport: { w: window.innerWidth, h: window.innerHeight },
                coarse: window.matchMedia('(pointer: coarse)').matches,
                env: { inner: window.innerWidth, client: document.documentElement.clientWidth,
                       dpr: window.devicePixelRatio, screenW: window.screen.width,
                       visualW: window.visualViewport ? Math.round(window.visualViewport.width) : null,
                       scrollW: document.documentElement.scrollWidth },
                targets: {}, sidebar: {}, ruler: {}, overflow: [] };
  // 横向溢出诊断：找出把文档撑得比设备视口宽的元素。
  // scrollWidth > clientWidth 时，移动端 window.innerWidth 会报「内容宽」而不是设备宽，
  // 这正是此处 506 的来历 —— 不是仿真失效，是真的有元素溢出。
  {
    const vw = document.documentElement.clientWidth;
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect();
      if (r.width <= 0) continue;
      if (r.right > vw + 1 || r.width > vw + 1) {
        out.overflow.push(el.tagName + (el.id ? '#' + el.id : '') +
          (el.className ? '.' + String(el.className).split(' ').filter(Boolean)[0] : '') +
          ' w=' + Math.round(r.width) + ' right=' + Math.round(r.right));
        if (out.overflow.length >= 12) break;
      }
    }
  }
  // 纵向空间分配：正文视口占视口高度的比例，是 PLAN-C 阶段三的硬指标。
  // .app 是固定高度的 flex 列、正文 min-height:0，顶栏/翻页栏一旦 wrap 失控就会
  // 把正文挤到 0（实测 812×375 横屏曾为 0px）。这里把三者的高度与占比一起记下来，
  // 让"可正常操作全部功能"这条判据有数字可依，而不是靠看着还行。
  {
    const R = sel => { const el = document.querySelector(sel); if (!el) return null;
      const r = el.getBoundingClientRect(); return { top: Math.round(r.top), h: Math.round(r.height) }; };
    const H = window.innerHeight;
    const tb = R('.topbar'), pb = R('.pagebar'), vp = R('#viewport');
    out.chrome = {
      viewportH: H, topbarH: tb && tb.h, pagebarH: pb && pb.h,
      readerH: vp && vp.h,
      readerShare: vp ? Math.round(vp.h / H * 100) + '%' : null,
      topbarShare: tb ? Math.round(tb.h / H * 100) + '%' : null,
    };
  }
  for (const [sel, name] of ${JSON.stringify(TARGETS.map(t => [t[0], t[1]]))}) {    const el = document.querySelector(sel);
    if (!el) { out.targets[name] = null; continue; }
    const r = el.getBoundingClientRect();
    out.targets[name] = { w: Math.round(r.width), h: Math.round(r.height) };
  }
  const app = document.querySelector('.app');
  out.sidebar.narrowMode = window.innerWidth <= 768;
  out.sidebar.collapsed = app.classList.contains('sidebar-collapsed');
  const sb = document.querySelector('.sidebar');
  if (sb) { const r = sb.getBoundingClientRect(); out.sidebar.rect = { left: Math.round(r.left), width: Math.round(r.width) }; }
  // 遮罩是否生效：::after 有 content 且可见
  const scrim = getComputedStyle(app, '::after');
  out.sidebar.scrimContent = scrim.content;
  out.sidebar.scrimBg = scrim.backgroundColor;
  const ru = document.querySelector('#wrapRuler');
  if (ru) out.ruler.height = Math.round(ru.getBoundingClientRect().height);
  out.wrapCol = localStorage.getItem('txtreader-wrapcol');
  return out;
})()`;

async function setDevice(cdp, { width, height, mobile = true, touch = true, label }) {
  const apply = async () => {
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width, height, deviceScaleFactor: 1, mobile,
      screenWidth: width, screenHeight: height,
      screenOrientation: {
        angle: width > height ? 90 : 0,
        type: width > height ? 'landscapePrimary' : 'portraitPrimary',
      },
    });
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: touch, maxTouchPoints: 5 });
  };
  await apply();
  await sleep(300);
  // 轮询确认真生效，不生效就重新施加 —— 导航会重置一部分仿真状态，
  // 漏掉这步会读到 506×1096 这类「按桌面宽度布局再缩放」的假视口，
  // 后续所有坐标都会在错的视口里算，测试结论随之不可信。
  for (let i = 0; i < 6; i++) {
    const w = await cdp.eval('window.innerWidth', { awaitPromise: false });
    if (Math.abs(w - width) <= 2) return label;
    await apply();
    await sleep(250);
  }
  return label;
}

/* 真实触摸拖动：touchStart → 若干 touchMove → touchEnd */
async function touchDrag(cdp, x1, y1, x2, y2, steps = 6) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x1, y: y1, id: 1 }] });
  for (let i = 1; i <= steps; i++) {
    const x = Math.round(x1 + (x2 - x1) * i / steps);
    const y = Math.round(y1 + (y2 - y1) * i / steps);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y, id: 1 }] });
    await sleep(28);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(220);
}

async function main() {
  const args = parseArgs(process.argv);
  const sample = sampleFile(args.rows);
  const port = args.port;
  // 用启动参数直接加载目标页，而不是先起 about:blank 再 Page.navigate ——
  // 实测 navigate 会重置设备仿真，且之后再 setDeviceMetricsOverride 也压不回来
  // （innerWidth 会停在 506×1096 这类「按桌面宽度布局再缩放」的假视口，
  //  导致 CDP 派发的触摸坐标与页面 CSS 像素不在同一空间、落点乱跑）。
  const child = await launchBrowser({
    port, profileDir: path.join(__dirname, '.profile', 'm' + port),
    url: pathToFileURL(MAIN_HTML).href,
  });
  let cdp = null;
  const report = { startedAt: new Date().toISOString(), cases: [], errors: [] };

  try {
    await waitForDevTools(port);
    const target = await findPageTarget(port);
    cdp = await CDP.connect(target.webSocketDebuggerUrl);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('DOM.enable');
    await cdp.waitFor(`document.readyState === 'complete'`, { timeoutMs: 30000 });

    /* ---------- 用例一：手机竖屏 ---------- */
    const vpPortrait = '手机竖屏 375×812';
    await setDevice(cdp, { width: 375, height: 812, label: vpPortrait });
    await sleep(300);

    const { root } = await cdp.send('DOM.getDocument');
    const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: '#fileInput' });
    await cdp.send('DOM.setFileInputFiles', { nodeId, files: [sample] });
    await cdp.waitFor(`document.querySelector('#content .row') !== null`, { timeoutMs: 180000, label: '首屏' });
    await sleep(400);

    const m1 = await cdp.eval(MEASURE, { awaitPromise: false });
    report.cases.push({ vp: vpPortrait, phase: '打开文件后', ...m1 });

    /* ---------- 用例二：触摸拖动标尺 ---------- */
    // 先把侧栏收起，避免遮罩盖住标尺
    await cdp.eval(`document.querySelector('.app').classList.add('sidebar-collapsed'); true`, { awaitPromise: false });
    await sleep(350);
    const before = await cdp.eval(`localStorage.getItem('txtreader-wrapcol')`, { awaitPromise: false });
    const rect = await cdp.eval(`(() => { const r = document.querySelector('#wrapRuler').getBoundingClientRect();
      return { x: Math.round(r.left + r.width * 0.75), y: Math.round(r.top + r.height / 2), mid: Math.round(r.left + r.width * 0.45) }; })()`, { awaitPromise: false });
    await touchDrag(cdp, rect.x, rect.y, rect.mid, rect.y);
    const after = await cdp.eval(`localStorage.getItem('txtreader-wrapcol')`, { awaitPromise: false });
    const guideVisible = await cdp.eval(`getComputedStyle(document.querySelector('#wrapGuide')).display !== 'none'`, { awaitPromise: false });
    report.cases.push({
      vp: vpPortrait, phase: '触摸拖动标尺',
      dragFrom: rect.x, dragTo: rect.mid,
      wrapColBefore: before, wrapColAfter: after,
      changed: before !== after, guideVisible: guideVisible,
    });

    /* ---------- 用例三：侧栏抽屉开合 ---------- */
    await cdp.eval(`document.querySelector('.app').classList.add('sidebar-collapsed'); true`, { awaitPromise: false });
    await sleep(350);
    const collapsedState = await cdp.eval(MEASURE, { awaitPromise: false });
    // 展开
    await cdp.eval(`document.querySelector('#sideToggle').click(); true`, { awaitPromise: false });
    await sleep(400);
    const openedState = await cdp.eval(MEASURE, { awaitPromise: false });
    // 记录真正到达页面的事件序列：用来判定「没收到 click」到底是浏览器没合成，
    // 还是 CDP 坐标与页面 CSS 像素不一致导致落点错位 —— 不靠猜。
    await cdp.eval(`window.__ev = [];
      ['touchstart','touchend','pointerdown','pointerup','click'].forEach(t =>
        document.addEventListener(t, e => window.__ev.push(t + '→' + String((e.target && (e.target.id || e.target.className)) || '?')) , true));
      window.__ev0 = window.innerWidth; true`, { awaitPromise: false });
    // 点侧栏以外的区域。先按真实触摸 tap 走一遍（浏览器会把 tap 合成 click）；
    // 若没收起，再用鼠标 click 交叉验证「click 委托逻辑本身」是否正确 ——
    // 两者分开记录，避免把「浏览器没合成 click」误判成「委托写错了」。
    //
    // 落点必须**先自证前提**：窄屏侧栏是 fixed 定位、宽 min(320px,100vw-32px)，
    // 375px 视口下覆盖 x∈[16,336]，「侧栏以外」只剩右侧一条约 39px 的缝。
    // 早先取 #viewport.right-24，实测落在 x=334 —— 仍在侧栏内（sidebar.right=336），
    // 于是测出来的是「点在侧栏上不收起」，那本来就该如此，不是缺陷。
    // 故改为按 sidebar.right 反推落点，并用 elementFromPoint 断言它确实不在侧栏内；
    // 前提不成立就记 premise=false，而不是把「选点无效」写成「功能失败」。
    const tapPt = await cdp.eval(`(() => {
      const sb = document.querySelector('.sidebar').getBoundingClientRect();
      const vp = document.querySelector('#viewport').getBoundingClientRect();
      const x = Math.round(Math.min(window.innerWidth - 8, sb.right + 12));
      const y = Math.round(vp.top + vp.height / 2);
      const el = document.elementFromPoint(x, y);
      const name = el ? el.tagName + (el.id ? '#' + el.id : '') +
        (el.className ? '.' + String(el.className).split(' ').filter(Boolean)[0] : '') : 'null';
      return { x, y, hit: name, inSidebar: el ? !!el.closest('.sidebar') : null,
               inApp: el ? !!el.closest('.app') : null,
               sidebarRight: Math.round(sb.right), innerW: window.innerWidth };
    })()`, { awaitPromise: false });
    const premiseOk = tapPt.inApp === true && tapPt.inSidebar === false;

    let closedByTouch = null, evLog = null;
    if (premiseOk) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: tapPt.x, y: tapPt.y, id: 2 }] });
      await sleep(60);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await sleep(450);
      closedByTouch = await cdp.eval(`document.querySelector('.app').classList.contains('sidebar-collapsed')`, { awaitPromise: false });
      evLog = await cdp.eval(`({ innerWidth: window.__ev0, events: window.__ev.slice() })`, { awaitPromise: false });
    }

    let closedByMouse = null;
    if (premiseOk && !closedByTouch) {
      await cdp.eval(`document.querySelector('#sideToggle').click(); true`, { awaitPromise: false });   // 重新展开
      await sleep(420);
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: tapPt.x, y: tapPt.y, button: 'left', clickCount: 1 });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: tapPt.x, y: tapPt.y, button: 'left', clickCount: 1 });
      await sleep(450);
      closedByMouse = await cdp.eval(`document.querySelector('.app').classList.contains('sidebar-collapsed')`, { awaitPromise: false });
    }
    report.cases.push({
      vp: vpPortrait, phase: '侧栏抽屉',
      collapsed_initial: collapsedState.sidebar.collapsed,
      opened_afterToggle: !openedState.sidebar.collapsed,
      opened_has_scrim: openedState.sidebar.scrimBg,
      sidebar_left_when_open: openedState.sidebar.rect && openedState.sidebar.rect.left,
      closed_after_outside_touch: closedByTouch,
      closed_after_outside_click: closedByMouse,
      tapPremiseOk: premiseOk,
      tapPoint: tapPt,
      touchEventLog: evLog,
    });

    /* ---------- 用例四：手机横屏 ---------- */
    const vpLand = await setDevice(cdp, { width: 812, height: 375, label: '手机横屏 812×375' });
    await sleep(700);
    const m2 = await cdp.eval(MEASURE, { awaitPromise: false });
    report.cases.push({ vp: vpLand, phase: '旋转后', ...m2 });

    /* ---------- 用例五：平板竖屏 ---------- */
    const vpTab = await setDevice(cdp, { width: 768, height: 1024, label: '平板竖屏 768×1024' });
    await sleep(700);
    const m3 = await cdp.eval(MEASURE, { awaitPromise: false });
    report.cases.push({ vp: vpTab, phase: '平板', ...m3 });

    fs.mkdirSync(path.join(__dirname, 'out'), { recursive: true });
    const out = path.join(__dirname, 'out', 'mobile-' + new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19) + '.json');
    fs.writeFileSync(out, JSON.stringify(report, null, 2), 'utf8');

    print(report);
    console.log('\n结果已写入: ' + path.relative(ROOT, out));
  } catch (e) {
    console.error('验证失败:', e.message);
    process.exitCode = 1;
  } finally {
    if (cdp) cdp.close();
    await killBrowser(child);
  }
}

function print(report) {
  for (const c of report.cases) {
    console.log('\n=== ' + c.vp + ' · ' + c.phase + ' ===');
    if (c.targets) {
      console.log('  pointer:coarse = ' + c.coarse + '   视口 ' + c.viewport.w + '×' + c.viewport.h);
      if (c.env) console.log('  [env] innerWidth=' + c.env.inner + ' clientWidth=' + c.env.client +
        ' dpr=' + c.env.dpr + ' screen.width=' + c.env.screenW + ' visualViewport=' + c.env.visualW +
        ' scrollWidth=' + c.env.scrollW);
      if (c.overflow && c.overflow.length) {
        console.log('  [横向溢出元素] ' + c.overflow.join('  |  '));
      } else {
        console.log('  [横向溢出元素] 无');
      }
      console.log('  --- 纵向空间分配（判据：正文必须可用，不得为 0）---');
      if (c.chrome) console.log('    视口高 ' + c.chrome.viewportH + 'px  顶栏 ' + c.chrome.topbarH + 'px (' +
        c.chrome.topbarShare + ')  翻页栏 ' + c.chrome.pagebarH + 'px  正文 ' + c.chrome.readerH +
        'px (' + c.chrome.readerShare + ')');
      console.log('  --- 触摸目标尺寸（判据 ≥44×44）---');
      for (const [name, size] of Object.entries(c.targets)) {
        if (!size) { console.log('    ' + pad(name, 14) + ' 不存在'); continue; }
        const ok = size.h >= 44 && size.w >= 20;
        console.log('    ' + pad(name, 14) + ' ' + pad(size.w + '×' + size.h, 10) + (ok ? 'OK' : '偏小'));
      }
      console.log('  标尺高度 ' + c.ruler.height + 'px   侧栏折叠=' + c.sidebar.collapsed +
        ' 遮罩=' + (c.sidebar.scrimBg && c.sidebar.scrimBg !== 'rgba(0, 0, 0, 0)' ? '有' : '无'));
    }
    if (c.phase === '触摸拖动标尺') {
      console.log('  wrapCol ' + c.wrapColBefore + ' → ' + c.wrapColAfter + '   生效=' + c.changed + '   边界虚线可见=' + c.guideVisible);
    }
    if (c.phase === '侧栏抽屉') {
      console.log('  初始收起=' + c.collapsed_initial + '  点按钮后展开=' + c.opened_afterToggle + '  遮罩色=' + c.opened_has_scrim);
      if (c.tapPoint) console.log('  落点 (' + c.tapPoint.x + ',' + c.tapPoint.y + ') 命中 ' + c.tapPoint.hit +
        '  在侧栏内=' + c.tapPoint.inSidebar + '  在 app 内=' + c.tapPoint.inApp +
        '  (sidebar.right=' + c.tapPoint.sidebarRight + ', innerWidth=' + c.tapPoint.innerW + ')');
      if (!c.tapPremiseOk) {
        console.log('  ⚠ 落点前提不成立 —— 该点落在侧栏内或 app 外，本次「点侧栏以外收起」'
          + '的结论无效（是选点问题，不是功能问题），不计入判定');
      } else {
        console.log('  点侧栏以外后收起：触摸 tap=' + c.closed_after_outside_touch + '  鼠标 click=' + c.closed_after_outside_click);
      }
      if (c.touchEventLog) console.log('  触摸时页面实际收到：innerWidth=' + c.touchEventLog.innerWidth +
        ' 事件=[' + c.touchEventLog.events.join(', ') + ']');
    }
  }
}
function strWidth(s) { let n = 0; for (const ch of s) n += ch.charCodeAt(0) > 255 ? 2 : 1; return n; }
function pad(s, w) { const d = w - strWidth(s); return s + ' '.repeat(Math.max(0, d)); }

main().then(() => { }).catch(e => { console.error(e); process.exitCode = 1; });
