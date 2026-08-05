const os = require('os');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '../..');
const PUPPETEER =
  process.env.PUPPETEER_CORE ||
  (() => {
    try {
      return require.resolve('puppeteer-core', { paths: [ROOT] });
    } catch {
      return path.join(ROOT, 'node_modules/puppeteer-core');
    }
  })();
const puppeteer = require(PUPPETEER);

const CHROME = process.env.CHROME_BIN || '/data/data/com.termux/files/usr/bin/chromium-browser';
const PORT = process.env.E2E_PORT ? Number(process.env.E2E_PORT) : 8787;
const BASE = `http://localhost:${PORT}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const logs = [];

async function waitFor(fn, { timeout = 90000, step = 1000, label = 'condition' } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const v = await fn();
      if (v) return v;
    } catch {}
    await sleep(step);
  }
  throw new Error(`timeout waiting for ${label}`);
}

async function resolveUrl(page, label, url) {
  console.log(`\n=== ${label}: ${url}`);
  await page.evaluateOnNewDocument(() => {
    const orig = window.fetch;
    window.fetch = function (input, init) {
      const u = String(input);
      if (u.includes('youtubei') || u.includes('youtube.com')) {
        console.log('[fetch-trace]', u.slice(0, 90), '|', (new Error().stack || '').split('\n').slice(1, 4).join(' < ').slice(0, 200));
      }
      return orig.apply(this, arguments);
    };
  });
  await page.goto(`${BASE}/?url=${encodeURIComponent(url)}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(2500);
  const dialog = await waitFor(
    () =>
      page
        .$('[role="dialog"]')
        .then((el) => !!el)
        .catch(() => false),
    { timeout: 120000, label: 'picker dialog' }
  ).catch(async (e) => {
    const txt = await page.evaluate(() => document.body.innerText.slice(0, 600)).catch(() => '<n/a>');
    console.log('FAILED to open dialog. page url:', page.url());
    console.log('page text:', txt.slice(0, 400));
    console.log('console tail:', logs.slice(-20).join(' || '));
    throw e;
  });
  if (!dialog) {
    const errText = await page.evaluate(() => document.body.innerText.slice(0, 400));
    console.log('NO DIALOG. page text:', errText.slice(0, 300));
    return null;
  }
  const formats = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('[role="dialog"] button')];
    return rows.map((b) => (b.innerText || '').trim().slice(0, 40)).filter(Boolean).slice(0, 15);
  });
  console.log('formats found:', formats.length);
  console.log(formats.join(' | '));
  return formats;
}

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--window-size=1280,900',
      '--autoplay-policy=no-user-gesture-required',
    ],
  });
  const page = await browser.newPage();
  page.setDefaultTimeout(60000);
  page.on('console', async (msg) => {
    const t = msg.text();
    if (t && t.length < 3000) logs.push(t);
    for (const arg of msg.args()) {
      try {
        const v = await arg.jsonValue();
        if (v && typeof v === 'object' && v.stack) logs.push('WARN-STACK: ' + String(v.stack).slice(0, 900));
      } catch {}
    }
  });
  page.on('pageerror', (err) => logs.push('PAGEERROR: ' + String(err).slice(0, 300)));
  page.on('requestfailed', (r) => logs.push('REQFAIL: ' + r.method() + ' ' + r.url().slice(0, 120) + ' -> ' + (r.failure()?.errorText || '?')));
  page.on('request', (r) => {
    if (r.url().includes('youtube') && !r.url().includes('localhost')) {
      logs.push('DIRECT-REQ [' + r.resourceType() + '] ' + r.method() + ' ' + r.url().slice(0, 110));
    }
  });
  page.on('response', async (r) => {
    if (r.status() >= 400) logs.push('HTTP' + r.status() + ': ' + r.url().slice(0, 120));
    if (decodeURIComponent(r.url()).includes('youtubei/v1/player') || decodeURIComponent(r.url()).includes('youtubei/v1/next')) {
      try {
        const txt = await r.text();
        const name = decodeURIComponent(r.url()).includes('player') ? 'player' : 'next';
        logs.push(name.toUpperCase() + '-RESP: HTTP' + r.status() + ' len=' + txt.length);
        const dumpDir = path.join(os.tmpdir(), 'phantom-e2e');
        fs.mkdirSync(dumpDir, { recursive: true });
        fs.appendFileSync(path.join(dumpDir, name + '.json'), txt + '\n===EOF===\n');
      } catch {}
    }
  });

  const urlArg = process.argv[2];
  if (!urlArg) {
    console.log('usage: node run.cjs <youtube|spotify|short|rick>');
    await browser.close();
    process.exit(1);
  }
  const urls = {
    youtube: 'https://www.youtube.com/watch?v=BaW_jenozKc',
    short: 'https://youtu.be/BaW_jenozKc',
    rick: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    spotify: 'https://open.spotify.com/track/5dbNhoJHwTFykNZJnCBMuL',
  };
  const results = {};
  if (urls[urlArg]) {
    results[urlArg] = await resolveUrl(page, urlArg.toUpperCase(), urls[urlArg]);
  } else {
    for (const [k, v] of Object.entries(urls)) {
      results[k] = await resolveUrl(page, k.toUpperCase(), v);
      if (k === 'youtube' && results[k]) break;
    }
  }
  console.log('\n--- console tail ---');
  console.log(logs.slice(-25).join('\n'));
  await browser.close();
  const ok = Object.values(results).some((r) => r && r.length > 0);
  console.log(ok ? '\nRESULT: PASS' : '\nRESULT: FAIL');
  process.exit(ok ? 0 : 1);
})().catch((e) => {
  console.error('E2E error:', e.message);
  process.exit(1);
});
