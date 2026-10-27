const { chromium } = require('playwright');
const sharp = require('sharp');
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'docs/screenshots');
const prefix = '/windows-phone-/';
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };

(async () => {
  fs.mkdirSync(output, { recursive: true });
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://localhost');
    if (!url.pathname.startsWith(prefix)) { response.writeHead(404).end(); return; }
    let file = path.resolve(root, '.' + url.pathname.slice(prefix.length - 1));
    if (!file.startsWith(root + path.sep) && file !== root) { response.writeHead(403).end(); return; }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!fs.existsSync(file)) { response.writeHead(404).end(); return; }
    response.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(response);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || undefined, args: ['--no-sandbox'] });
    const context = await browser.newContext({ viewport: { width: 412, height: 892 }, permissions: ['clipboard-read', 'clipboard-write'] });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const base = `http://127.0.0.1:${server.address().port}${prefix}`;
    await page.goto(base + '?platform=android');
    await page.waitForURL('**/ui/?platform=android');
    await page.locator('#previewToolbar').waitFor({ state: 'visible' });
    assert.equal(await page.locator('body').getAttribute('data-platform'), 'android', 'Root keeps platform query');
    await page.screenshot({ path: path.join(output, 'android.png'), fullPage: true });

    await page.locator('#sendButton').click();
    assert(await page.locator('#connection').isVisible(), 'Disconnected send opens pairing');
    assert(await page.locator('#disconnectButton').isDisabled(), 'Disconnected action is disabled');
    await page.locator('#demoConnect').click();
    await page.locator('#sendButton').click();
    assert.match(await page.locator('#feedback').innerText(), /Мәтінді/, 'Empty text is rejected');
    const text = 'const message = "Сәлем, бро!";\n<script>window.injected = true</script>';
    await page.locator('#textInput').fill(text);
    assert.equal(await page.locator('#charCount').innerText(), text.length + ' таңба');
    await page.locator('#sendButton').click();
    await page.locator('#showDemoResult').click();
    assert.equal(await page.locator('#receivedContent').innerText(), text, 'Text arrives unchanged');
    assert.equal(await page.locator('#receivedContent script').count(), 0, 'Received text stays text');
    await page.locator('#copyAgain').click();
    await page.waitForFunction(() => document.getElementById('receiveBadge').textContent === 'Буферге көшірілді');
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), text, 'Copy writes the clipboard');
    await page.setViewportSize({ width: 1130, height: 900 });
    await page.screenshot({ path: path.join(output, 'windows.png'), fullPage: true });
    await page.locator('.nav[data-tab="history"]').click();
    assert.equal(await page.locator('.history-item').count(), 1);

    await page.locator('#previewAndroid').click();
    await page.locator('#imageTab').click();
    await page.locator('#sendButton').click();
    assert.match(await page.locator('#feedback').innerText(), /суретті таңда/, 'Missing image is rejected');
    const png = await sharp({ create: { width: 100, height: 60, channels: 3, background: '#0866db' } }).png().toBuffer();
    await page.locator('#browserImageInput').setInputFiles({ name: 'test-image.png', mimeType: 'image/png', buffer: png });
    await page.waitForFunction(() => document.getElementById('imageName').textContent === 'test-image.png');
    await page.locator('#sendButton').click();
    await page.locator('#transferCanvas[data-active="true"]').waitFor({ state: 'visible' });
    assert(Number(await page.locator('#transferCanvas').getAttribute('data-particles')) > 100, 'Image breaks into real fragments');
    await page.screenshot({ path: path.join(output, 'particles.png') });
    await page.locator('#showDemoResult').click();
    await page.locator('#receivedContent img').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#receivedContent img').evaluate(img => img.naturalWidth), 100);
    await page.locator('#copyAgain').click();
    await page.waitForFunction(() => document.getElementById('receiveBadge').textContent === 'Буферге көшірілді');
    assert(await page.evaluate(async () => (await navigator.clipboard.read()).some(item => item.types.includes('image/png'))), 'PNG can be copied');

    await page.locator('#previewAndroid').click();
    await page.locator('#browserImageInput').setInputFiles({ name: 'bad.txt', mimeType: 'text/plain', buffer: Buffer.from('not an image') });
    assert.match(await page.locator('#feedback').innerText(), /PNG немесе JPEG/, 'Other file types are rejected');
    await page.locator('#browserImageInput').setInputFiles({ name: 'broken.png', mimeType: 'image/png', buffer: Buffer.from('not an image') });
    await page.waitForFunction(() => document.getElementById('feedback').textContent.includes('ашу мүмкін болмады'));
    await page.locator('#textTab').click();
    for (let i = 0; i < 11; i++) {
      await page.locator('#textInput').fill('Демо хабарлама ' + i);
      await page.locator('#sendButton').click();
      await page.waitForFunction(() => !document.getElementById('sendButton').disabled);
    }
    await page.locator('.nav[data-tab="history"]').click();
    assert.equal(await page.locator('.history-item').count(), 10, 'History is bounded');
    await page.locator('.nav[data-tab="connection"]').click();
    await page.locator('#disconnectButton').click();
    assert(await page.locator('#demoConnect').isEnabled(), 'Disconnect restores pairing');
    await page.locator('.nav[data-tab="clipboard"]').click();
    await page.locator('#sendButton').click();
    assert(await page.locator('#connection').isVisible(), 'Sending is blocked after disconnect');

    for (const platform of ['android', 'windows']) {
      await page.locator(platform === 'android' ? '#previewAndroid' : '#previewWindows').click();
      for (const width of [320, 412, 720, 1130]) {
        await page.setViewportSize({ width, height: 892 });
        for (const section of ['clipboard', 'connection', 'history']) {
          await page.locator(`.nav[data-tab="${section}"]`).click();
          assert(await page.locator('#' + section).isVisible(), `${platform}: ${section} navigation`);
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${platform}: ${section} overflow at ${width}`);
        }
      }
    }
    await page.reload();
    await page.locator('#previewToolbar').waitFor({ state: 'visible' });
    assert.equal(await page.locator('.history-item').count(), 0, 'Reload clears demo history');
    assert(await page.locator('#copyAgain').isDisabled(), 'Reload clears received data');
    assert(await page.locator('#disconnectButton').isDisabled(), 'Reload clears demo connection');
    await page.locator('#demoStart').click();
    await page.waitForFunction(() => document.getElementById('imagePreview').complete && document.getElementById('imagePreview').naturalWidth > 0);
    assert.equal(await page.locator('body').getAttribute('data-platform'), 'android', 'One-click effect demo opens sender');
    await page.setViewportSize({ width: 412, height: 892 });
    await page.screenshot({ path: path.join(output, 'android.png'), fullPage: true });
    await page.locator('#sendButton').click();
    await page.locator('#showDemoResult').waitFor({ state: 'visible' });
    await page.waitForFunction(() => !document.getElementById('sendButton').disabled);
    assert.equal(await page.locator('#transferCanvas').getAttribute('data-active'), 'false', 'Animation canvas is cleaned up');
    assert.equal(await page.locator('#imagePreview').evaluate(img => img.classList.contains('image-sending')), false, 'Image returns after the effect');
    assert.deepEqual(errors, [], 'No browser script errors');
    await context.close();

    const quiet = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 1130, height: 900 } });
    const quietPage = await quiet.newPage();
    await quietPage.goto(base + 'ui/?platform=windows');
    await quietPage.locator('#demoStart').click();
    await quietPage.locator('#sendButton').click();
    await quietPage.waitForFunction(() => !document.getElementById('sendButton').disabled);
    assert.notEqual(await quietPage.locator('#transferCanvas').getAttribute('data-active'), 'true', 'Reduced motion skips image particles');
    await quiet.close();

    // Smoke check that embedded clients still use their native message bridge.
    const native = await browser.newContext({ viewport: { width: 1130, height: 780 } });
    await native.addInitScript(() => {
      window.BailanysNative = { postMessage(request) {
        const { id, action } = JSON.parse(request);
        if (action === 'ready') queueMicrotask(() => window.Bailanys.receive({ id, result: { connected: true, deviceName: 'Native test' } }));
      } };
    });
    const nativePage = await native.newPage();
    await nativePage.goto(base + 'ui/?platform=windows');
    assert(await nativePage.locator('#previewToolbar').isHidden(), 'Native client hides browser controls');
    assert.equal(await nativePage.locator('#deviceName').innerText(), 'Native test');
    await native.close();
    const desktop = await sharp(path.join(output, 'windows.png')).resize({ width: 980 }).png().toBuffer();
    const desktopHeight = (await sharp(desktop).metadata()).height;
    const mobile = await sharp(path.join(output, 'android.png')).resize({ height: 740 }).png().toBuffer();
    await sharp({ create: { width: 1380, height: Math.max(830, desktopHeight + 50), channels: 4, background: '#edf1f7' } })
      .composite([{ input: desktop, left: 22, top: 25 }, { input: mobile, left: 1025, top: 40 }])
      .png().toFile(path.join(output, 'bailanys.png'));
    console.log('Passed: root/subpath links, both views, pairing, text/image sending, clipboard, validation, history, disconnect, reload, responsive navigation, native bridge.');
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
