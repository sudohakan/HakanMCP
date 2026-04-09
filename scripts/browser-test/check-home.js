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
  await page.click('button[type="submit"], button:has-text("Giriş")');

  console.log('Login clicked, waiting for navigation...');

  // Wait for redirect to home
  await page.waitForURL('**/home**', { timeout: 30000 }).catch(() => {
    console.log('URL did not change to /home, current: ' + page.url());
  });

  console.log('Current URL: ' + page.url());

  // Capture IMMEDIATELY when home loads - before loading finishes
  // Take multiple rapid screenshots to catch the loading state
  for (let i = 0; i < 5; i++) {
    await page.screenshot({ path: `/home/hakan/home-capture-${i}.png`, fullPage: false });
    console.log(`Screenshot ${i} taken at ${new Date().toISOString()}`);

    // Check if any balance/financial data is visible in DOM
    const visibleText = await page.evaluate(() => {
      const body = document.body.innerText;
      const matches = body.match(/₺[\d.,]+/g) || [];
      const spinVisible = document.querySelector('.ant-spin-spinning') !== null;
      const widgetVisible = document.querySelectorAll('[class*="Widget"], [class*="widget"]').length;
      return {
        currencyValues: matches.slice(0, 10),
        spinnerVisible: spinVisible,
        widgetCount: widgetVisible,
        bodySnippet: body.substring(0, 500)
      };
    });
    console.log(`State ${i}:`, JSON.stringify(visibleText, null, 2));
    await page.waitForTimeout(500);
  }

  // Final screenshot after everything loaded
  await page.waitForTimeout(5000);
  await page.screenshot({ path: '/home/hakan/home-final.png', fullPage: true });

  const finalState = await page.evaluate(() => {
    const body = document.body.innerText;
    const matches = body.match(/₺[\d.,]+/g) || [];
    return {
      currencyValues: matches.slice(0, 10),
      url: window.location.href,
      bodySnippet: body.substring(0, 800)
    };
  });
  console.log('Final state:', JSON.stringify(finalState, null, 2));

  await browser.close();
})();
