const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({
    executablePath: '/usr/bin/chromium-browser',
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await context.newPage();

  // Login
  await page.goto('https://panel.finekra.com/signin', { waitUntil: 'networkidle' });
  await page.fill('input[placeholder*="Email"], input[type="email"], input#email', 'cuneyt@gokcantarim.com');
  await page.fill('input[placeholder*="ifre"], input[type="password"], input#password', 'Ali.3579');

  // Before clicking login, set up rapid DOM observer
  await page.evaluate(() => {
    window.__captures = [];
    const observer = new MutationObserver(() => {
      const body = document.body.innerText;
      const hasCurrency = /₺[\d.,]+/.test(body);
      const hasWidget = document.querySelectorAll('[class*="Widget"], [class*="widget"], .gx-card, .ant-card').length;
      const hasSpinner = document.querySelector('.ant-spin-spinning') !== null;
      const has403 = body.includes('403') || body.includes('yetkiniz');
      if (hasCurrency || hasWidget > 0) {
        window.__captures.push({
          ts: performance.now(),
          hasCurrency,
          widgetCount: hasWidget,
          hasSpinner,
          has403,
          snippet: body.substring(0, 600)
        });
      }
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  });

  await page.click('button[type="submit"], button:has-text("Giriş")');
  console.log('Login clicked...');

  // Wait for home page
  await page.waitForURL('**/home**', { timeout: 30000 }).catch(() => {});
  console.log('URL: ' + page.url());

  // Rapid-fire screenshots every 50ms for 3 seconds
  const shots = [];
  const start = Date.now();
  let i = 0;
  while (Date.now() - start < 3000) {
    const path = `/home/hakan/rapid-${String(i).padStart(3, '0')}.png`;
    await page.screenshot({ path, fullPage: false });

    const state = await page.evaluate(() => {
      const body = document.body.innerText;
      return {
        hasCurrency: /₺[\d.,]+/.test(body),
        currencies: (body.match(/₺[\d.,]+/g) || []).slice(0, 5),
        hasSpinner: document.querySelector('.ant-spin-spinning') !== null,
        has403: body.includes('403') || body.includes('yetkiniz'),
        bodyLen: body.length,
        snippet: body.substring(0, 300)
      };
    });

    const elapsed = Date.now() - start;
    if (state.hasCurrency) {
      console.log(`!!! CURRENCY FOUND at ${elapsed}ms (shot ${i}): ${JSON.stringify(state.currencies)}`);
    }
    shots.push({ i, elapsed, ...state });
    i++;
    // No delay - as fast as possible
  }

  // Check MutationObserver captures
  const observerCaptures = await page.evaluate(() => window.__captures || []);
  console.log(`\nMutationObserver captured ${observerCaptures.length} events with widgets/currency`);
  observerCaptures.forEach((c, idx) => {
    console.log(`  Observer ${idx}: ts=${c.ts.toFixed(0)}ms currency=${c.hasCurrency} widgets=${c.widgetCount} spinner=${c.hasSpinner} 403=${c.has403}`);
    if (c.hasCurrency) console.log(`    SNIPPET: ${c.snippet.substring(0, 200)}`);
  });

  // Summary
  console.log(`\nTotal screenshots: ${i}`);
  const currencyShots = shots.filter(s => s.hasCurrency);
  console.log(`Screenshots with ₺ values: ${currencyShots.length}`);
  if (currencyShots.length > 0) {
    currencyShots.forEach(s => console.log(`  Shot ${s.i} (${s.elapsed}ms): ${JSON.stringify(s.currencies)}`));
  }

  const spinnerShots = shots.filter(s => s.hasSpinner);
  console.log(`Screenshots with spinner: ${spinnerShots.length}`);
  const authShots = shots.filter(s => s.has403);
  console.log(`Screenshots with 403: ${authShots.length}`);

  // Print timeline
  console.log('\nTimeline:');
  shots.forEach(s => {
    const flags = [
      s.hasSpinner ? 'SPIN' : '',
      s.hasCurrency ? '₺₺₺' : '',
      s.has403 ? '403' : '',
    ].filter(Boolean).join('+') || 'empty';
    if (s.i % 5 === 0 || s.hasCurrency) {
      console.log(`  ${s.elapsed}ms [${flags}] ${s.snippet.substring(0, 80)}`);
    }
  });

  await browser.close();
})();
