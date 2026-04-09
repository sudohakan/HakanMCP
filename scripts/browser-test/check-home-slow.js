const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({
    executablePath: '/usr/bin/chromium-browser',
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await context.newPage();

  // Login first with normal speed
  await page.goto('https://panel.finekra.com/signin', { waitUntil: 'networkidle' });
  await page.fill('input[placeholder*="Email"], input[type="email"], input#email', 'cuneyt@gokcantarim.com');
  await page.fill('input[placeholder*="ifre"], input[type="password"], input#password', 'Ali.3579');
  await page.click('button[type="submit"], button:has-text("Giriş")');
  console.log('Login clicked...');

  await page.waitForURL('**/home**', { timeout: 30000 }).catch(() => {});
  console.log('Logged in, URL: ' + page.url());

  // Now throttle network via CDP — simulate slow 3G
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    downloadThroughput: 50 * 1024,   // 50 KB/s — very slow
    uploadThroughput: 25 * 1024,     // 25 KB/s
    latency: 500                      // 500ms latency
  });
  console.log('Network throttled to slow 3G');

  // Set up MutationObserver before reload
  await page.evaluate(() => {
    window.__captures = [];
    window.__startTime = performance.now();
    const observer = new MutationObserver(() => {
      const body = document.body.innerText;
      const currencies = body.match(/₺[\d.,]+/g) || [];
      const hasSpinner = document.querySelector('.ant-spin-spinning') !== null;
      const has403 = body.includes('403') || body.includes('yetkiniz');
      const elapsed = performance.now() - window.__startTime;
      window.__captures.push({
        ts: elapsed,
        currencies: currencies.slice(0, 5),
        hasCurrency: currencies.length > 0,
        hasSpinner,
        has403,
        snippet: body.substring(0, 400)
      });
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  });

  // Reload to test loading behavior with slow network
  await page.reload({ waitUntil: 'commit' });
  console.log('Page reload started (slow network)...');

  // Rapid screenshots every 100ms for 15 seconds
  const shots = [];
  const start = Date.now();
  let i = 0;
  while (Date.now() - start < 15000) {
    const state = await page.evaluate(() => {
      const body = document.body.innerText;
      return {
        hasCurrency: /₺[\d.,]+/.test(body),
        currencies: (body.match(/₺[\d.,]+/g) || []).slice(0, 5),
        hasSpinner: document.querySelector('.ant-spin-spinning') !== null,
        has403: body.includes('403') || body.includes('yetkiniz'),
        snippet: body.substring(0, 300)
      };
    });

    const elapsed = Date.now() - start;
    shots.push({ i, elapsed, ...state });

    if (state.hasCurrency) {
      const path = `/home/hakan/slow-currency-${String(i).padStart(3, '0')}.png`;
      await page.screenshot({ path, fullPage: false });
      console.log(`!!! ₺ FOUND at ${elapsed}ms (shot ${i}): ${JSON.stringify(state.currencies)}`);
    }

    // Screenshot every 500ms for reference
    if (i % 5 === 0) {
      const path = `/home/hakan/slow-${String(i).padStart(3, '0')}.png`;
      await page.screenshot({ path, fullPage: false });
    }

    i++;
    await page.waitForTimeout(100);
  }

  // Get observer data
  const observerCaptures = await page.evaluate(() => window.__captures || []);
  const currencyEvents = observerCaptures.filter(c => c.hasCurrency);
  console.log(`\nMutationObserver: ${observerCaptures.length} total events, ${currencyEvents.length} with ₺`);
  currencyEvents.forEach((c, idx) => {
    console.log(`  ₺ Event ${idx}: ${c.ts.toFixed(0)}ms ${JSON.stringify(c.currencies)}`);
    console.log(`    snippet: ${c.snippet.substring(0, 200)}`);
  });

  // Summary
  console.log(`\nTotal checks: ${i}`);
  const currencyShots = shots.filter(s => s.hasCurrency);
  const spinnerShots = shots.filter(s => s.hasSpinner);
  const authShots = shots.filter(s => s.has403);
  console.log(`With ₺: ${currencyShots.length} | With spinner: ${spinnerShots.length} | With 403: ${authShots.length}`);

  // Timeline
  console.log('\nTimeline (every 500ms + currency events):');
  shots.forEach(s => {
    const flags = [
      s.hasSpinner ? 'SPIN' : '',
      s.hasCurrency ? '₺₺₺' : '',
      s.has403 ? '403' : '',
    ].filter(Boolean).join('+') || 'blank';
    if (s.i % 5 === 0 || s.hasCurrency) {
      console.log(`  ${String(s.elapsed).padStart(6)}ms [${flags}] ${s.snippet.substring(0, 100)}`);
    }
  });

  await browser.close();
})();
