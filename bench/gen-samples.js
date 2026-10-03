'use strict';
/* ============================================================================
 * 基准样本生成器 —— PLAN-2026-1001-C（大文件性能与移动端）阶段一
 *
 * 生成可复现的中文小说风格样本，按「行数」分档：1 万 / 10 万 / 50 万行。
 * 用固定种子 PRNG（mulberry32），任何机器上生成的结果逐字节一致 ——
 * 这是「基准可比」的前提：换了机器、换了日期，样本不变，数字才有意义。
 *
 * 用法：
 *   node bench/gen-samples.js                       # 生成全部三档
 *   node bench/gen-samples.js --rows 10000,100000   # 只生成指定档
 *   node bench/gen-samples.js --out <dir>           # 自定义输出目录
 *
 * 输出：bench/samples/sample-<行数>.txt（UTF-8 无 BOM，LF 换行）
 * ========================================================================== */

'use strict';
const fs = require('fs');
const path = require('path');

/* ---------- 固定种子 PRNG：保证样本可复现 ---------- */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), 1 | t);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---------- 字源：千字文（常用字覆盖广、无生僻字、无 ASCII） ---------- */
const POOL = (
  '天地玄黄宇宙洪荒日月盈昃辰宿列张寒来暑往秋收冬藏闰余成岁律吕调阳' +
  '云腾致雨露结为霜金生丽水玉出昆冈剑号巨阙珠称夜光果珍李柰菜重芥姜' +
  '海咸河淡鳞潜羽翔龙师火帝鸟官人皇始制文字乃服衣裳推位让国有虞陶唐' +
  '吊民伐罪周发殷汤坐朝问道垂拱平章爱育黎首臣伏戎羌遐迩一体率宾归王' +
  '鸣凤在竹白驹食场化被草木赖及万方盖此身发四大五常恭惟鞠养岂敢毁伤' +
  '女慕贞洁男效才良知过必改得能莫忘罔谈彼短靡恃己长信使可覆器欲难量' +
  '墨悲丝染诗赞羔羊景行维贤克念作圣德建名立形端表正空谷传声虚堂习听' +
  '祸因恶积福缘善庆尺璧非宝寸阴是竞资父事君曰严与敬孝当竭力忠则尽命' +
  '临深履薄夙兴温凊似兰斯馨如松之盛川流不息渊澄取映容止若思言辞安定' +
  '笃初诚美慎终宜令荣业所基籍甚无竟学优登仕摄职从政存以甘棠去而益咏'
).split('');

const END_PUNCT = ['。', '。', '。', '。', '？', '！', '…'];
const MID_PUNCT = ['，', '，', '，', '、', '；', '：'];

/* 生成一行：1–3 个短句，合计 12–40 字，整行以句末标点收尾。
 * 这样既是「一行」也是一个自然的语义单元，便于观察排版（按句分段）开关的差异。 */
function makeLine(rand) {
  const sentences = 1 + Math.floor(rand() * 3);   // 1–3 句
  let out = '';
  for (let s = 0; s < sentences; s++) {
    const len = 6 + Math.floor(rand() * 13);      // 每句 6–18 字
    for (let i = 0; i < len; i++) {
      out += POOL[Math.floor(rand() * POOL.length)];
      // 句内偶尔插入逗号/分号：约 15% 概率，且不落在句首
      if (i > 0 && i < len - 1 && rand() < 0.15) out += MID_PUNCT[Math.floor(rand() * MID_PUNCT.length)];
    }
    out += s === sentences - 1
      ? END_PUNCT[Math.floor(rand() * END_PUNCT.length)]
      : END_PUNCT[Math.floor(rand() * 4)];        // 非末句也收句末标点，保证断句规则可被触发
  }
  return out;
}

/* 流式写出，避免 50 万行时在内存里拼接巨型字符串 */
function generate(rows, file, seed) {
  const rand = mulberry32(seed);
  const fd = fs.openSync(file, 'w');
  const CHUNK = 4096;                              // 每次 write 4096 行
  let buf = [];
  for (let i = 0; i < rows; i++) {
    buf.push(makeLine(rand));
    if (buf.length >= CHUNK) { fs.writeSync(fd, buf.join('\n') + '\n'); buf = []; }
  }
  if (buf.length) fs.writeSync(fd, buf.join('\n') + '\n');
  fs.closeSync(fd);
}

/* ---------- 参数解析 ---------- */
function parseArgs(argv) {
  const out = { rows: [10000, 100000, 500000], outDir: path.join(__dirname, 'samples') };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--rows' && argv[i + 1]) {
      out.rows = argv[++i].split(',').map(s => parseInt(s.trim(), 10)).filter(n => n > 0);
    } else if (argv[i] === '--out' && argv[i + 1]) {
      out.outDir = path.resolve(argv[++i]);
    }
  }
  return out;
}

function main() {
  const { rows, outDir } = parseArgs(process.argv);
  fs.mkdirSync(outDir, { recursive: true });
  console.log('[gen-samples] 输出目录:', outDir);
  for (let k = 0; k < rows.length; k++) {
    const n = rows[k];
    const label = n >= 10000 ? (n / 10000) + 'w' : String(n);
    const file = path.join(outDir, 'sample-' + label + '.txt');
    const t0 = Date.now();
    // 每档用不同种子，避免「小样本是大样本前缀」造成的测量偏差
    generate(n, file, 20261003 + k * 7919);
    const st = fs.statSync(file);
    console.log('[gen-samples] ' + path.basename(file).padEnd(22) +
      ' 行数=' + String(n).padEnd(8) +
      ' 字节=' + String(st.size).padEnd(12) +
      ' 耗时=' + (Date.now() - t0) + 'ms');
  }
  console.log('[gen-samples] 完成。');
}

main();
