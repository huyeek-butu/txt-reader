'use strict';
/* ============================================================================
 * 窄屏 / 横屏纵向空间下钻 —— PLAN-2026-1001-C 阶段三
 *
 * 为什么需要单独一个脚本：
 *   mobile.js 只能告诉你「正文视口是 97px」这个结论，不能告诉你**高度被谁吃掉了**。
 *   .app 是固定高度的 flex 列（height: 100vh）、正文 min-height: 0 —— 顶栏和翻页栏
 *   一旦 wrap 成多层，就会把正文一路挤到 0。要定位，必须把纵向各段的高度逐一量出来，
 *   并且把顶栏子项按 top 值分组，看清它到底是几行、每行多高。
 *
 *   这个脚本就是这么发现 812×375 横屏下正文为 0px 的：宽 812 > 768，
 *   @media (max-width: 768px) 根本不匹配，所以只按宽度设的约束在横屏永远不生效。
 *
 * 用法：node bench/layout.js [--port 9488]
 * ========================================================================== */

const path = require('path');
const { pathToFileURL } = require('url');
const { CDP, launchBrowser, waitForDevTools, findPageTarget, killBrowser, sleep } = require('./lib/cdp');

const ROOT = path.resolve(__dirname, '..');
const MAIN_HTML = path.join(ROOT, 'txt-reader.html');

const SEL = ['.app', '.topbar', '.body', '.sidebar', '.reader-col', '.reader-wrap',
  '#wrapRuler', '#viewport', '.pagebar', '.statusbar', '#empty', '.help-card'];

const VIEWPORTS = [
  [375, 812, '手机竖屏'],
  [812, 375, '手机横屏'],
  [768, 1024, '平板竖屏'],
  [1440, 900, '桌面（对照，不应被上限影响）'],
];

function parseArgs(argv) {
  const o = { port: 9488 };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--port' && argv[i + 1]) o.port = parseInt(argv[++i], 10);
  }
  return o;
}

async function main() {
  const args = parseArgs(process.argv);
  const child = await launchBrowser({
    port: args.port,
    profileDir: path.join(__dirname, '.profile', 'layout' + args.port),
    url: pathToFileURL(MAIN_HTML).href,
  });
  let cdp = null;
  try {
    await waitForDevTools(args.port);
    const target = await findPageTarget(args.port);
    cdp = await CDP.connect(target.webSocketDebuggerUrl);

    const apply = async (w, h, mobile) => {
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: w, height: h, deviceScaleFactor: 1, mobile,
        screenWidth: w, screenHeight: h,
        screenOrientation: { angle: w > h ? 90 : 0, type: w > h ? 'landscapePrimary' : 'portraitPrimary' },
      });
      await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: mobile, maxTouchPoints: 5 });
    };

    for (const [w, h, label] of VIEWPORTS) {
      const mobile = w <= 768;
      await apply(w, h, mobile);
      await sleep(450);
      // 轮询确认真生效：仿真未生效时读到的是「按桌面宽度布局再缩放」的假视口，
      // 后续所有高度结论都会建立在错的尺寸上。
      for (let i = 0; i < 6; i++) {
        const got = await cdp.eval('window.innerWidth', { awaitPromise: false });
        if (Math.abs(got - w) <= 2) break;
        await apply(w, h, mobile);
        await sleep(250);
      }

      const dump = await cdp.eval(`(() => {
        const R = sel => { const el = document.querySelector(sel); if (!el) return null;
          const r = el.getBoundingClientRect();
          return { top: Math.round(r.top), h: Math.round(r.height), w: Math.round(r.width), left: Math.round(r.left) }; };
        const out = { vp: { w: window.innerWidth, h: window.innerHeight }, boxes: {}, topbarKids: [], pagebarKids: [] };
        for (const s of ${JSON.stringify(SEL)}) out.boxes[s] = R(s);
        const tb = document.querySelector('.topbar');
        for (const k of tb.children) {
          const r = k.getBoundingClientRect();
          out.topbarKids.push({ tag: k.tagName + (k.id ? '#' + k.id : '') +
            (k.className ? '.' + String(k.className).split(' ').filter(Boolean)[0] : ''),
            top: Math.round(r.top), h: Math.round(r.height), w: Math.round(r.width),
            txt: (k.textContent || '').trim().slice(0, 14) });
        }
        const pb = document.querySelector('.pagebar');
        out.pagebarKids = pb ? Array.from(pb.children).map(k => {
          const r = k.getBoundingClientRect();
          return { tag: k.tagName + (k.id ? '#' + k.id : '') +
            (k.className ? '.' + String(k.className).split(' ').filter(Boolean)[0] : ''),
            top: Math.round(r.top), h: Math.round(r.height), w: Math.round(r.width) };
        }) : [];
        return out;
      })()`, { awaitPromise: false });

      // 「子项 top 不同的个数」不等于行数（同一行内高度不同的项 top 也不同），
      // 所以只报真正有意义的量：盒子高度，以及有几个控件落在盒子**可见范围之外**
      // —— 那些必须在该盒子内部滚动才能看到，是可用性的真实代价。
      const outOf = (box, kids) => {
        if (!box) return '—';
        const top = box.top, bot = box.top + box.h;
        const n = kids.filter(k => (k.top - 1) < top || (k.top + k.h) > bot + 1).length;
        return n === 0 ? '全部可见' : n + ' 个需内部滚动';
      };
      const tbBox = dump.boxes['.topbar'], pbBox = dump.boxes['.pagebar'];
      const vpH = dump.boxes['#viewport'] ? dump.boxes['#viewport'].h : null;
      console.log('\n===== ' + label + ' ' + dump.vp.w + '×' + dump.vp.h + ' =====');
      console.log('  顶栏 ' + (tbBox ? tbBox.h : 0) + 'px（' + dump.topbarKids.length + ' 个控件，' +
        outOf(tbBox, dump.topbarKids) + '）' +
        '   翻页栏 ' + (pbBox ? pbBox.h : 0) + 'px（' + dump.pagebarKids.length + ' 个，' +
        outOf(pbBox, dump.pagebarKids) + '）' +
        '   正文 ' + vpH + 'px' + (vpH ? ' (' + Math.round(vpH / dump.vp.h * 100) + '%)' : '') +
        (vpH === 0 ? '   ← ⚠ 正文为 0，不可读' : ''));
      for (const s of SEL) {
        const b = dump.boxes[s];
        if (b) console.log('    ' + s.padEnd(14) + ' top=' + String(b.top).padStart(4) +
          ' h=' + String(b.h).padStart(4) + ' w=' + b.w);
      }
      console.log('  -- topbar 子项（top 值相同即同一行）--');
      for (const k of dump.topbarKids) console.log('    top=' + String(k.top).padStart(4) + ' ' +
        String(k.w + '×' + k.h).padEnd(9) + k.tag + '  「' + k.txt + '」');
      console.log('  -- pagebar 子项 --');
      for (const k of dump.pagebarKids) console.log('    top=' + String(k.top).padStart(4) + ' ' +
        String(k.w + '×' + k.h).padEnd(9) + k.tag);
    }
  } catch (e) {
    console.error('下钻失败:', e.message);
    process.exitCode = 1;
  } finally {
    if (cdp) cdp.close();
    await killBrowser(child);
  }
}

main().catch(e => { console.error(e); process.exitCode = 1; });
