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

  // Throttle network via CDP — slow 3G
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    downloadThroughput: 50 * 1024,
    uploadThroughput: 25 * 1024,
    latency: 500
  });
  console.log('Network throttled to slow 3G');

  // Reload and wait for page to be ready
  await page.reload({ waitUntil: 'domcontentloaded' });
  console.log('Page reloaded...');

  // Wait a bit for React to mount
  await page.waitForTimeout(1000);

  // Rapid checks every 100ms for 15 seconds
  const shots = [];
  const start = Date.now();
  let i = 0;
  while (Date.now() - start < 15000) {
    try {
      const state = await page.evaluate(() => {
        if (!document.body) return { error: 'no body' };
        const body = document.body.innerText || '';
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

      if (i % 10 === 0) {
        const path = `/home/hakan/slow-${String(i).padStart(3, '0')}.png`;
        await page.screenshot({ path, fullPage: false });
        const flags = [
          state.hasSpinner ? 'SPIN' : '',
          state.hasCurrency ? '₺₺₺' : '',
          state.has403 ? '403' : '',
        ].filter(Boolean).join('+') || 'blank';
        console.log(`  ${String(elapsed).padStart(6)}ms [${flags}] ${state.snippet.substring(0, 120)}`);
      }
    } catch (e) {
      // page might be navigating
    }

    i++;
    await page.waitForTimeout(100);
  }

  // Summary
  console.log(`\nTotal checks: ${i}`);
  const currencyShots = shots.filter(s => s.hasCurrency);
  const spinnerShots = shots.filter(s => s.hasSpinner);
  const authShots = shots.filter(s => s.has403);
  console.log(`With ₺: ${currencyShots.length} | With spinner: ${spinnerShots.length} | With 403: ${authShots.length}`);

  if (currencyShots.length > 0) {
    console.log('\n!!! CURRENCY LEAK DETECTED:');
    currencyShots.forEach(s => console.log(`  ${s.elapsed}ms: ${JSON.stringify(s.currencies)}`));
  } else {
    console.log('\n✓ No currency data leaked during loading');
  }

  // Timeline
  console.log('\nFull timeline:');
  shots.forEach(s => {
    const flags = [
      s.hasSpinner ? 'SPIN' : '',
      s.hasCurrency ? '₺₺₺' : '',
      s.has403 ? '403' : '',
    ].filter(Boolean).join('+') || 'blank';
    if (s.i % 10 === 0 || s.hasCurrency) {
      console.log(`  ${String(s.elapsed).padStart(6)}ms [${flags}]`);
    }
  });

  await browser.close();
})();
