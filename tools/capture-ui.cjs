const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'docs/screenshots');
const prefix = '/windows-phone-/';
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
const fakePeer = `
class FakeConnection {
  constructor(peer, remote, sid) { this.peer=peer; this.remote=remote; this.sid=sid; this.handlers={}; this.open=false; }
  on(name, fn) { (this.handlers[name] ||= []).push(fn); }
  emit(name, value) { for (const fn of this.handlers[name] || []) fn(value); }
  send(data) { this.peer.bc.postMessage({to:this.remote,from:this.peer.id,sid:this.sid,type:'data',data}); }
  close() { if (!this.open) return; this.open=false; this.peer.bc.postMessage({to:this.remote,from:this.peer.id,sid:this.sid,type:'close'}); this.emit('close'); }
}
window.Peer = class {
  constructor(id) {
    this.id = typeof id === 'string' ? id : 'CLIENT-' + Math.random().toString(36).slice(2);
    this.handlers={}; this.connections=new Map(); this.open=true;
    this.bc=new BroadcastChannel('bailanys-test');
    this.bc.onmessage = ({data:m}) => {
      if (m.to !== this.id) return;
      if (m.type === 'connect') {
        const conn=new FakeConnection(this,m.from,m.sid); this.connections.set(m.sid,conn);
        this.emit('connection',conn);
        setTimeout(() => { conn.open=true; conn.emit('open'); this.bc.postMessage({to:m.from,from:this.id,sid:m.sid,type:'open'}); }, 10);
        return;
      }
      const conn=this.connections.get(m.sid); if (!conn) return;
      if (m.type === 'open') { conn.open=true; conn.emit('open'); }
      if (m.type === 'data') conn.emit('data',m.data);
      if (m.type === 'close') { conn.open=false; conn.emit('close'); }
    };
    setTimeout(() => this.emit('open',this.id), 20);
  }
  on(name,fn) { (this.handlers[name] ||= []).push(fn); }
  emit(name,value) { for (const fn of this.handlers[name] || []) fn(value); }
  connect(remote) {
    const sid=crypto.randomUUID(), conn=new FakeConnection(this,remote,sid);
    this.connections.set(sid,conn);
    this.bc.postMessage({to:remote,from:this.id,sid,type:'connect'});
    return conn;
  }
};`;

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
    const context = await browser.newContext({ permissions: ['clipboard-read','clipboard-write'] });
    await context.route('https://cdn.jsdelivr.net/**', route => route.fulfill({ contentType: 'text/javascript', body: '' }));
    const errors = [];
    const base = `http://127.0.0.1:${server.address().port}${prefix}ui/`;
    const laptop = await context.newPage();
    laptop.on('pageerror', error => errors.push('laptop: ' + error.message));
    await laptop.setViewportSize({ width: 1440, height: 900 });
    await laptop.addInitScript(fakePeer);
    await laptop.goto(base);
    await laptop.locator('#pairCode').waitFor({ state: 'visible' });
    await laptop.waitForFunction(() => /^WP-[A-Z2-9]{16}$/.test(document.getElementById('pairCode').textContent));
    assert.equal(await laptop.locator('body').getAttribute('data-platform'), 'windows');
    assert.equal(await laptop.locator('.primary-nav').evaluate(el => getComputedStyle(el).position), 'static');
    await laptop.screenshot({ path: path.join(output, 'windows.png'), fullPage: true, animations: 'disabled' });

    const mobile = await context.newPage();
    mobile.on('pageerror', error => errors.push('phone: ' + error.message));
    await mobile.setViewportSize({ width: 390, height: 844 });
    await mobile.addInitScript(() => Object.defineProperty(navigator, 'userAgent', { get: () => 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 Chrome/131.0 Mobile Safari/537.36' }));
    await mobile.addInitScript(fakePeer);
    await mobile.goto(base);
    assert.equal(await mobile.locator('body').getAttribute('data-platform'), 'android');
    assert.equal(await mobile.locator('.primary-nav').evaluate(el => getComputedStyle(el).position), 'fixed');
    assert.equal(await mobile.locator('.nav').count(), 3);
    await mobile.screenshot({ path: path.join(output, 'android.png'), fullPage: true, animations: 'disabled' });

    await mobile.locator('.nav[data-tab="clipboard"]').click();
    assert(await mobile.locator('.primary-nav').isVisible());
    await mobile.locator('#sendButton').click();
    assert(await mobile.locator('#connection').isVisible());
    await mobile.locator('#codeInput').fill('wrong');
    await mobile.locator('#pairButton').click();
    await mobile.waitForFunction(() => document.getElementById('pairFeedback').classList.contains('error'));
    const code = await laptop.locator('#pairCode').innerText();
    await mobile.locator('#codeInput').fill(code);
    await mobile.locator('#pairButton').click();
    await laptop.locator('#onlineApproval').waitFor({ state: 'visible' });
    await laptop.locator('#onlineAccept').click();
    await mobile.waitForFunction(() => document.body.dataset.connected === 'true');
    await laptop.waitForFunction(() => document.body.dataset.connected === 'true');
    assert.equal(await mobile.locator('#connectedDevicesCount').innerText(), '1 ҚҰРЫЛҒЫ');
    assert.equal(await laptop.locator('#connectedDevicesCount').innerText(), '1 ҚҰРЫЛҒЫ');
    await mobile.locator('.nav[data-tab="clipboard"]').click();
    const text = 'Сәлем, екі экран! <script>not executable</script>';
    await mobile.locator('#textInput').fill(text);
    await mobile.locator('#sendButton').click();
    await laptop.locator('.nav[data-tab="clipboard"]').click();
    await laptop.locator('#receivedContent').waitFor({ state: 'visible' });
    await laptop.waitForFunction(expected => document.getElementById('receivedContent').textContent === expected, text);
    assert.equal(await laptop.locator('#receivedContent script').count(), 0);
    await laptop.locator('#copyAgain').click();
    assert.equal(await laptop.evaluate(() => navigator.clipboard.readText()), text);
    await mobile.screenshot({ path: path.join(output, 'android-clipboard.png'), fullPage: true, animations: 'disabled' });
    await laptop.screenshot({ path: path.join(output, 'windows-clipboard.png'), fullPage: true, animations: 'disabled' });
    await mobile.locator('#imageTab').click();
    const png = await sharp({ create: { width: 80, height: 48, channels: 3, background: '#9276f7' } }).png().toBuffer();
    await mobile.locator('#browserImageInput').setInputFiles({ name: 'sample.png', mimeType: 'image/png', buffer: png });
    await mobile.locator('#sendButton').click();
    await laptop.waitForFunction(() => document.querySelector('#receivedContent img')?.naturalWidth === 80);
    await laptop.locator('#copyAgain').click();
    await laptop.waitForFunction(() => document.getElementById('receiveBadge').textContent === 'КӨШІРІЛДІ');
    assert(await laptop.evaluate(async () => (await navigator.clipboard.read()).some(item => item.types.includes('image/png'))));
    await mobile.locator('.nav[data-tab="history"]').click();
    assert.equal(await mobile.locator('.history-item').count(), 2);
    await mobile.setViewportSize({ width: 320, height: 700 });
    assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'No horizontal overflow on narrow phones');
    await mobile.locator('.nav[data-tab="connection"]').click();
    await mobile.locator('#disconnectButton').click();
    await laptop.waitForFunction(() => document.body.dataset.connected === 'false');
    assert.deepEqual(errors, []);
    console.log('Passed: desktop and phone layouts, navigation, QR code, approval, text/image transfer, safe rendering, clipboard, history, disconnect, narrow viewport.');
    await context.close();
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
