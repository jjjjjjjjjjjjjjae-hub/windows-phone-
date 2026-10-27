(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const nativeAndroid = window.BailanysNative;
  const nativeWindows = window.chrome?.webview;
  const browser = !nativeAndroid && !nativeWindows;
  const requested = new URLSearchParams(location.search).get('platform');
  const phone = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const platform = browser ? (phone ? 'android' : 'windows') : (['android','windows'].includes(requested) ? requested : (phone ? 'android' : 'windows'));
  const effects = window.BailanysEffects;
  const historyItems = [];
  const pending = new Map();
  let sequence = 0, connected = false, mode = 'text', selectedImage = null, lastReceived = null, busy = false;
  let remoteActive = false, nativeCapturePending = false, rootState = 'idle';
  const phoneControlNative = window.PhoneControlNative?.postMessage ? window.PhoneControlNative : null;
  let connectedDevice = { name: platform === 'android' ? 'Ноутбук' : 'Телефон', os: platform === 'android' ? 'Ноутбук' : 'Телефон' };
  let pairingLink = '', cameraStream = null, cameraFrame = 0, cameraActive = false, qrStarted = false;
  const cameraCanvas = document.createElement('canvas');
  const cameraContext = cameraCanvas.getContext('2d', { willReadFrequently: true });
  document.body.dataset.platform = platform;

  function message(text, error = false, target = 'feedback') {
    const node = $(target);
    node.textContent = text;
    node.className = 'feedback ' + (error ? 'error' : 'success');
  }
  function tab(id) {
    if (id !== 'connection') stopCamera();
    for (const page of document.querySelectorAll('.page')) page.hidden = page.id !== id;
    for (const button of document.querySelectorAll('.nav')) {
      button.classList.toggle('active', button.dataset.tab === id);
      if (button.dataset.tab === id) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    }
    $('crumbName').textContent = { connection: 'Құрылғылар', clipboard: 'Ортақ буфер', history: 'Жіберу тарихы' }[id];
    window.scrollTo({ top: 0, behavior: 'instant' });
  }
  document.querySelectorAll('.nav').forEach(button => button.addEventListener('click', () => tab(button.dataset.tab)));
  $('openConnection').addEventListener('click', () => tab('connection'));

  function drawDevices() {
    const list = $('connectedDevicesList');
    list.replaceChildren();
    $('connectedDevicesCount').textContent = connected ? '1 ҚҰРЫЛҒЫ' : '0 ҚҰРЫЛҒЫ';
    const row = document.createElement('div');
    row.className = connected ? 'connected-device-row' : 'connected-device-empty';
    const icon = document.createElement('span');
    icon.className = connected ? 'connected-device-phone-icon' : 'connected-device-empty-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = connected ? (platform === 'android' ? '▱' : '▯') : '◇';
    const details = document.createElement('div');
    details.className = 'connected-device-info';
    const title = document.createElement('strong');
    title.textContent = connected ? connectedDevice.name : 'Әзірге құрылғы қосылмаған';
    const description = document.createElement('span');
    description.textContent = connected ? connectedDevice.os + ' · Шифрланған арна' : (platform === 'android' ? 'Ноутбуктағы QR-кодты сканерле.' : 'Телефонмен QR-кодты сканерле.');
    details.append(title, description);
    row.append(icon, details);
    if (connected) { const live = document.createElement('span'); live.className = 'connected-device-live'; live.textContent = '● Онлайн'; row.append(live); }
    list.append(row);
  }
  function state(value) {
    connected = Boolean(value.connected);
    if (!connected) {
      connectedDevice = { name: platform === 'android' ? 'Ноутбук' : 'Телефон', os: platform === 'android' ? 'Ноутбук' : 'Телефон' };
      effects?.reset();
    }
    if (connected && cameraStream) stopCamera();
    document.body.dataset.connected = String(connected);
    const name = value.deviceName || connectedDevice.name;
    $('deviceName').textContent = connected ? name : 'Құрылғы қосылмаған';
    $('statusText').textContent = connected ? 'Онлайн' : 'Қосылмаған';
    $('statusDot').classList.toggle('online', connected);
    document.querySelector('.top-status').classList.toggle('online', connected);
    $('topStatus').textContent = connected ? 'Онлайн қосылды' : 'Байланыс күтілуде';
    $('connectionHeading').textContent = connected ? name + ' қосылды' : 'Құрылғы қосылмаған';
    $('connectionDescription').textContent = connected ? 'Мәлімет жіберуге дайын.' : 'Қосу үшін төмендегі қадамды орында.';
    $('connectionStatus').textContent = connected ? 'ҚОСЫЛДЫ' : 'ЖҰПТАСТЫРУ КҮТІЛУДЕ';
    $('sceneStatus').textContent = connected ? 'ОНЛАЙН' : 'КҮТУДЕ';
    $('bannerHeading').textContent = connected ? name + ' байланыста' : 'Алдымен құрылғыны қос';
    $('bannerDescription').textContent = connected ? 'Шифрланған арна мәлімет жіберуге дайын.' : 'Жұптастырған соң тасымал осы жерде іске қосылады.';
    $('androidPair').hidden = connected || platform !== 'android';
    $('windowsPair').hidden = connected || platform !== 'windows';
    $('disconnectButton').disabled = !connected;
    if (value.code) $('pairCode').textContent = value.code;
    if (value.host) $('hostInput').value = value.host;
    if (value.fingerprint) $('fingerprint').value = value.fingerprint;
    if (value.addresses) $('localAddresses').value = value.addresses.join(' / ');
    drawDevices();
    if (!connected && (remoteActive || nativeCapturePending)) stopRemoteLocal();
    renderRemote();
  }
  state({ connected: false });
  $('subtitle').textContent = platform === 'android' ? 'Мәтін мен суретті ноутбукке жібер.' : 'Телефоннан келген мәтін мен сурет осында.';
  $('senderPanel').hidden = platform !== 'android';
  $('receiverPanel').hidden = platform !== 'windows';
  tab('connection');

  function renderQR(code) {
    pairingLink = '';
    const root = $('pairQr');
    root.replaceChildren();
    $('copyPairLink').disabled = true;
    if (!/^WP-[A-Z2-9]{16}$/.test(code)) { $('qrStatus').textContent = 'Код жасалмады. Бетті жаңарт.'; return; }
    const url = new URL(location.href);
    url.searchParams.delete('platform'); url.searchParams.delete('pair'); url.searchParams.delete('utm_source');
    url.searchParams.set('pair', code);
    pairingLink = url.href;
    $('copyPairLink').disabled = false;
    if (typeof window.QRCode !== 'function') { $('qrStatus').textContent = 'QR кітапханасы жүктелмеді. Кодты қолмен енгіз.'; return; }
    try {
      new window.QRCode(root, { text: pairingLink, width: 155, height: 155, colorDark: '#18223c', colorLight: '#ffffff', correctLevel: window.QRCode.CorrectLevel.M });
      $('qrStatus').textContent = 'QR дайын. Телефонмен сканерле.';
    } catch { $('qrStatus').textContent = 'QR жасау мүмкін болмады. Кодты қолмен енгіз.'; }
  }
  $('copyPairLink').addEventListener('click', async () => {
    if (!pairingLink) return;
    try { await navigator.clipboard.writeText(pairingLink); message('Қосылу сілтемесі көшірілді.', false, 'pairFeedback'); }
    catch { message('Сілтемені көшіруге рұқсат берілмеді.', true, 'pairFeedback'); }
  });
  async function autoPair() {
    if (!browser || platform !== 'android' || qrStarted) return;
    const url = new URL(location.href), code = url.searchParams.get('pair');
    if (!code) return;
    qrStarted = true;
    url.searchParams.delete('pair'); history.replaceState(null, '', url);
    tab('connection');
    if (!/^WP-[A-Z2-9]{16}$/.test(code)) { message('QR сілтемесі жарамсыз. Кодты қолмен енгіз.', true, 'pairFeedback'); return; }
    $('codeInput').value = code;
    message('QR танылды. Ноутбуктағы растауды күтуде…', false, 'pairFeedback');
    $('pairButton').click();
  }
  function cameraMessage(text) { $('cameraFeedback').textContent = text; $('cameraHelp').textContent = text; }
  function stopCamera() {
    cameraActive = false;
    if (cameraFrame) cancelAnimationFrame(cameraFrame);
    cameraFrame = 0;
    const video = $('qrCameraVideo');
    video.pause(); video.srcObject = null;
    if (cameraStream) cameraStream.getTracks().forEach(track => track.stop());
    cameraStream = null;
    $('cameraArea').hidden = true;
    $('startQrCamera').disabled = false;
  }
  function codeFromQR(value) {
    if (typeof value !== 'string' || value.length > 2048) return null;
    try {
      const url = new URL(value);
      if (url.origin !== location.origin || !url.pathname.endsWith('/ui/')) return null;
      const code = url.searchParams.get('pair');
      return /^WP-[A-Z2-9]{16}$/.test(code || '') ? code : null;
    } catch {
      const code = value.trim().toUpperCase();
      return /^WP-[A-Z2-9]{16}$/.test(code) ? code : null;
    }
  }
  function finishScan(value) {
    const code = codeFromQR(value);
    if (!code) { cameraMessage('Бұл осы сайттың QR-коды емес. Ноутбуктағы QR-кодты көрсет.'); return; }
    stopCamera(); $('codeInput').value = code;
    message('QR танылды. Ноутбукта рұқсат бер.', false, 'pairFeedback');
    if (!connected && !busy) $('pairButton').click();
  }
  async function startCamera() {
    if (!browser || platform !== 'android' || cameraStream || connected) return;
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) { cameraMessage('Камера үшін сайтты HTTPS арқылы аш. Болмаса QR суретін таңда.'); return; }
    if (!cameraContext || typeof window.jsQR !== 'function') { cameraMessage('QR оқу модулі жүктелмеді. Бетті жаңарт.'); return; }
    $('startQrCamera').disabled = true; $('cameraArea').hidden = false;
    cameraMessage('Камераға рұқсат бер…');
    try {
      try { cameraStream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: 'environment' } }); }
      catch (error) {
        if (!['OverconstrainedError','NotFoundError'].includes(error.name)) throw error;
        cameraStream = await navigator.mediaDevices.getUserMedia({ audio: false, video: true });
      }
      const video = $('qrCameraVideo'); video.srcObject = cameraStream;
      video.play().catch(() => { cameraMessage('Камера ашылмады. QR суретін таңда.'); stopCamera(); });
      cameraMessage('QR-кодты жақтаудың ішіне орналастыр.');
      cameraActive = true;
      let lastFrame = 0;
      const scan = now => {
        if (!cameraActive) return;
        cameraFrame = requestAnimationFrame(scan);
        if (now - lastFrame < 140 || video.readyState < 2) return;
        lastFrame = now;
        const width = Math.min(video.videoWidth, 640);
        if (!width || !video.videoHeight) return;
        const height = Math.round(width * video.videoHeight / video.videoWidth);
        cameraCanvas.width = width; cameraCanvas.height = height;
        try {
          cameraContext.drawImage(video, 0, 0, width, height);
          const pixels = cameraContext.getImageData(0, 0, width, height);
          const found = window.jsQR(pixels.data, width, height, { inversionAttempts: 'attemptBoth' });
          if (found?.data) finishScan(found.data);
        } catch { cameraMessage('QR оқу қатесі. QR фотосын таңда.'); stopCamera(); }
      };
      cameraFrame = requestAnimationFrame(scan);
    } catch (error) {
      stopCamera();
      cameraMessage(['NotAllowedError','PermissionDeniedError'].includes(error?.name) ? 'Камераға рұқсат берілмеді. Рұқсатты қос немесе QR суретін таңда.' : 'Камера ашылмады. QR суретін таңда.');
    }
  }
  async function scanImage(file) {
    if (!file) return;
    if (!cameraContext || typeof window.jsQR !== 'function') { cameraMessage('QR оқу модулі жүктелмеді.'); return; }
    if (file.size > 20 * 1024 * 1024) { cameraMessage('Сурет 20 МБ-тан аспасын.'); return; }
    const url = URL.createObjectURL(file);
    try {
      const photo = new Image(); photo.src = url; await photo.decode();
      const width = Math.min(1600, photo.naturalWidth);
      const height = Math.round(width * photo.naturalHeight / photo.naturalWidth);
      cameraCanvas.width = width; cameraCanvas.height = height;
      cameraContext.drawImage(photo, 0, 0, width, height);
      const pixels = cameraContext.getImageData(0, 0, width, height);
      const found = window.jsQR(pixels.data, width, height, { inversionAttempts: 'attemptBoth' });
      if (found?.data) finishScan(found.data); else cameraMessage('Суреттен QR оқылмады. Анығырақ түсір.');
    } catch { cameraMessage('Фото ашылмады. Басқасын таңда.'); }
    finally { URL.revokeObjectURL(url); }
  }
  $('startQrCamera').onclick = startCamera;
  $('stopQrCamera').onclick = stopCamera;
  $('takeQrPhoto').onclick = () => { $('qrCameraCapture').value = ''; $('qrCameraCapture').click(); };
  $('chooseQrPhoto').onclick = () => { $('qrImagePicker').value = ''; $('qrImagePicker').click(); };
  $('qrCameraCapture').onchange = event => scanImage(event.target.files?.[0]);
  $('qrImagePicker').onchange = event => scanImage(event.target.files?.[0]);
  document.addEventListener('visibilitychange', () => { if (document.hidden) stopCamera(); });
  window.addEventListener('pagehide', stopCamera);

  function nativeCall(action, data = {}) {
    return new Promise((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error('Күту уақыты аяқталды.')); }, 65000);
      pending.set(id, { resolve, reject, timer });
      try {
        const payload = JSON.stringify({ id, action, data });
        if (nativeAndroid) nativeAndroid.postMessage(payload); else nativeWindows.postMessage(payload);
      } catch (error) { clearTimeout(timer); pending.delete(id); reject(error); }
    });
  }
  window.Bailanys = { receive(packet) {
    try { if (typeof packet === 'string') packet = JSON.parse(packet); } catch { return; }
    if (packet.id) {
      const item = pending.get(packet.id);
      if (!item) return;
      clearTimeout(item.timer); pending.delete(packet.id);
      if (packet.error) item.reject(new Error(packet.error)); else item.resolve(packet.result);
      return;
    }
    if (packet.event === 'state') state(packet.data);
    if (packet.event === 'received') received(packet.data);
    if (packet.event === 'sharedText') { $('textInput').value = packet.data.text; setMode('text'); updateCount(); tab('clipboard'); }
    if (packet.event === 'sharedImage') { selectedImage = packet.data; setMode('image'); showImage(); tab('clipboard'); }
  } };
  if (nativeWindows) nativeWindows.addEventListener('message', event => window.Bailanys.receive(event.data));

  function setMode(value) {
    mode = value;
    $('textPanel').hidden = value !== 'text'; $('imagePanel').hidden = value !== 'image';
    for (const type of ['text','image']) {
      $(type + 'Tab').classList.toggle('selected', type === value);
      $(type + 'Tab').setAttribute('aria-selected', String(type === value));
      $(type + 'Tab').tabIndex = type === value ? 0 : -1;
    }
  }
  $('textTab').onclick = () => setMode('text'); $('imageTab').onclick = () => setMode('image');
  for (const type of ['text','image']) $(type + 'Tab').onkeydown = event => {
    if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
    event.preventDefault(); const next = event.key === 'Home' ? 'text' : event.key === 'End' ? 'image' : mode === 'text' ? 'image' : 'text';
    setMode(next); $(next + 'Tab').focus();
  };
  function updateCount() { $('charCount').textContent = $('textInput').value.length + ' таңба'; }
  $('textInput').oninput = updateCount;
  function showImage() {
    $('imagePreview').hidden = !selectedImage?.preview;
    if (selectedImage?.preview) $('imagePreview').src = selectedImage.preview;
    $('imageName').textContent = selectedImage?.name || '';
    $('imagePicker').classList.toggle('has-image', Boolean(selectedImage));
  }
  $('pickImage').onclick = async () => {
    if (browser) { $('browserImageInput').value = ''; $('browserImageInput').click(); return; }
    try { const result = await nativeCall('pickImage'); if (result) { selectedImage = result; showImage(); } }
    catch (error) { message(error.message, true); }
  };
  $('browserImageInput').onchange = async event => {
    const file = event.target.files?.[0]; if (!file) return;
    if (!['image/png','image/jpeg'].includes(file.type)) { message('PNG немесе JPEG суретін таңда.', true); return; }
    if (file.size > 20 * 1024 * 1024) { message('Сурет көлемі 20 МБ-тан аспасын.', true); return; }
    try {
      const preview = await new Promise((resolve, reject) => {
        const reader = new FileReader(); reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('Суретті оқу мүмкін болмады.')); reader.readAsDataURL(file);
      });
      const decoded = new Image(); decoded.src = preview; await decoded.decode();
      selectedImage = { name: file.name, preview }; showImage(); message('Сурет жіберуге дайын.');
    } catch { message('Сурет ашылмады. Басқасын таңда.', true); }
  };
  function record(title, type, direction) {
    historyItems.unshift({ title, type, direction, time: new Date().toLocaleTimeString('kk-KZ', { hour: '2-digit', minute: '2-digit' }) });
    historyItems.splice(10);
    const list = $('historyList'); list.replaceChildren();
    for (const item of historyItems) {
      const row = document.createElement('div'); row.className = 'history-item';
      const icon = document.createElement('span'); icon.textContent = item.type === 'image' ? '▧' : '≡';
      const body = document.createElement('div'), title = document.createElement('strong'), time = document.createElement('small');
      title.textContent = String(item.title).slice(0, 100); time.textContent = item.time + ' · ' + item.direction;
      body.append(title, time); row.append(icon, body); list.append(row);
    }
  }
  $('sendButton').onclick = async () => {
    if (busy) return;
    if (!connected) { tab('connection'); message('Алдымен ноутбукке қосыл.', true, 'pairFeedback'); return; }
    if (mode === 'text' && !$('textInput').value.trim()) { message('Мәтін немесе код енгіз.', true); return; }
    if (mode === 'image' && !selectedImage) { message('Алдымен суретті таңда.', true); return; }
    busy = true; $('sendButton').disabled = true;
    const label = $('sendButton').firstElementChild;
    label.textContent = 'Жіберілуде…';
    try {
      if (browser) {
        if (mode === 'text') await window.OnlineLink.sendText($('textInput').value);
        else await window.OnlineLink.sendImage(selectedImage.preview, selectedImage.name);
      } else await nativeCall(mode === 'text' ? 'sendText' : 'sendImage', mode === 'text' ? { text: $('textInput').value } : { imageId: selectedImage.id });
      await effects?.send({ type: mode });
      record(mode === 'text' ? $('textInput').value : selectedImage.name, mode, 'Жіберілді');
      message('Ноутбукке жеткізілді.');
    } catch (error) { message(error.message, true); }
    finally { busy = false; $('sendButton').disabled = false; label.textContent = 'Ноутбукке жіберу'; }
  };
  $('pairButton').onclick = async () => {
    if (busy) return;
    busy = true; $('pairButton').disabled = true;
    try {
      if (browser) {
        message('Ноутбук растауын күтуде…', false, 'pairFeedback');
        await window.OnlineLink.connect($('codeInput').value.trim());
        message('Ноутбукпен байланыс орнады.', false, 'pairFeedback'); tab('clipboard');
      } else {
        const code = $('codeInput').value.trim(), host = $('hostInput').value.trim();
        if (!/^\d{6}$/.test(code)) throw new Error('Ноутбуктағы 6 таңбалы кодты енгіз.');
        const probe = await nativeCall('probe', { host });
        $('trustFingerprint').textContent = probe.fingerprint;
        const approved = await new Promise(resolve => {
          const dialog = $('trustDialog');
          $('confirmTrust').onclick = () => { dialog.close(); resolve(true); };
          $('rejectTrust').onclick = () => { dialog.close(); resolve(false); };
          dialog.oncancel = () => resolve(false); dialog.showModal();
        });
        if (!approved) throw new Error('Жұптастыру тоқтатылды.');
        state(await nativeCall('pair', { host, code, pin: probe.pin }));
      }
    } catch (error) { message(error.message, true, 'pairFeedback'); }
    finally { busy = false; $('pairButton').disabled = false; }
  };
  $('disconnectButton').onclick = async () => {
    try {
      if (browser) { window.OnlineLink.disconnect(); state({ connected: false }); }
      else state(await nativeCall('disconnect'));
      message('Байланыс ажыратылды.', false, 'pairFeedback');
    } catch (error) { message(error.message, true, 'pairFeedback'); }
  };
  function received(data) {
    lastReceived = data;
    const root = $('receivedContent'); root.replaceChildren();
    root.classList.add('has-content');
    root.classList.toggle('has-image', data.type === 'image');
    if (data.type === 'image') { const img = document.createElement('img'); img.src = data.preview; img.alt = 'Қабылданған сурет'; root.append(img); }
    else root.textContent = data.text;
    $('receiveBadge').textContent = data.copied ? 'КӨШІРІЛДІ' : 'ҚАБЫЛДАНДЫ';
    $('copyAgain').disabled = false;
    effects?.receive(root);
    record(data.type === 'image' ? data.name || 'Сурет' : data.text, data.type, 'Қабылданды');
    message(data.copied ? 'Буферге көшірілді.' : 'Қабылданды. Буферге көшіруге болады.');
  }
  function copyInBrowser() {
    if (!navigator.clipboard) return Promise.reject(new Error('Буфер қолжетімсіз.'));
    if (lastReceived.type === 'text') return navigator.clipboard.writeText(lastReceived.text);
    if (!window.ClipboardItem || !navigator.clipboard.write) return Promise.reject(new Error('Сурет көшіруді браузер қолдамайды.'));
    const png = new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas'); canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
        canvas.getContext('2d').drawImage(img, 0, 0);
        canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Көшіру мүмкін болмады.')), 'image/png');
      };
      img.onerror = () => reject(new Error('Сурет ашылмады.')); img.src = lastReceived.preview;
    });
    return navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
  }
  $('copyAgain').onclick = async () => {
    if (!lastReceived) return;
    try { await (browser ? copyInBrowser() : nativeCall('copyAgain')); $('receiveBadge').textContent = 'КӨШІРІЛДІ'; message('Буферге көшірілді.'); }
    catch { message('Көшіру мүмкін болмады. Браузердің рұқсатын тексер.', true); }
  };
  $('autoCopy').onchange = async () => { if (!browser) try { await nativeCall('autoCopy', { enabled: $('autoCopy').checked }); } catch (error) { message(error.message, true); } };

  function renderRemote() {
    document.body.dataset.remote = remoteActive ? 'active' : 'idle';
    $('remoteBadge').textContent = remoteActive ? 'БАСҚАРЫЛУДА' : 'ӨШІРУЛІ';
    $('requestRemote').hidden = platform !== 'windows' || remoteActive;
    $('requestRemote').disabled = !connected;
    $('stopRemote').hidden = !remoteActive;
    $('remoteActions').hidden = !remoteActive || platform !== 'windows';
    $('requestRoot').hidden = platform !== 'android' || !phoneControlNative || remoteActive;
    $('rootStatus').hidden = platform !== 'android' || !phoneControlNative;
    $('openAccessibility').hidden = platform !== 'android' || !phoneControlNative || remoteActive;
    $('androidAppLink').hidden = platform !== 'android' || Boolean(phoneControlNative);
    $('remoteDescription').textContent = remoteActive
      ? (platform === 'android' ? 'Экран ноутбукке көрсетіліп тұр. Осы жерден бірден тоқтата аласың.' : 'Экранды бас немесе сырғыт. Төмендегі батырмалар жүйелік әрекеттерді орындайды.')
      : !connected ? 'Алдымен телефонды қос, кейін басқаруға сұрау жібер.'
      : platform === 'windows' ? 'Телефон иесіне басқару сұрауын жібер. Ол экранды бөлісуге өзі рұқсат береді.'
      : phoneControlNative ? 'Root рұқсатын сұра немесе Android басқару рұқсатын қос. Ноутбуктан сұрау келгенде раста.'
      : 'Толық экранды басқару үшін телефонға Android қолданбасын орнат.';
    if (!remoteActive) { $('remoteScreen').hidden = true; $('remoteEmpty').hidden = false; }
  }
  function stopRemoteLocal(stopNative = true) {
    const shouldStop = remoteActive || nativeCapturePending;
    remoteActive = false; nativeCapturePending = false;
    if (stopNative && shouldStop && phoneControlNative) phoneControlNative.postMessage(JSON.stringify({ type: 'stop' }));
    $('remoteScreen').removeAttribute('src');
    renderRemote();
  }
  $('requestRemote').onclick = () => {
    try { window.OnlineLink.requestRemote(); message('Телефондағы рұқсат күтілуде…', false, 'remoteFeedback'); }
    catch (error) { message(error.message, true, 'remoteFeedback'); }
  };
  $('stopRemote').onclick = () => { window.OnlineLink.stopRemote(); stopRemoteLocal(); message('Басқару тоқтатылды.', false, 'remoteFeedback'); };
  $('requestRoot').onclick = () => phoneControlNative?.postMessage(JSON.stringify({ type: 'request-root' }));
  $('openAccessibility').onclick = () => phoneControlNative?.postMessage(JSON.stringify({ type: 'accessibility' }));
  $('remoteReject').onclick = () => { $('remoteApproval').close(); window.OnlineLink.denyRemote(); };
  $('remoteAccept').onclick = () => {
    $('remoteApproval').close();
    if (!phoneControlNative) { window.OnlineLink.denyRemote(); return; }
    nativeCapturePending = true;
    phoneControlNative.postMessage(JSON.stringify({ type: 'start' }));
    message('Root тексерісі мен Android экран бөлісу рұқсатын раста.', false, 'remoteFeedback');
  };
  $('remoteApproval').oncancel = () => window.OnlineLink.denyRemote();
  window.PhoneRemote = {
    nativeRootStatus(value) {
      rootState = ['checking', 'granted', 'denied'].includes(value) ? value : 'idle';
      $('requestRoot').disabled = rootState === 'checking';
      $('rootStatus').dataset.state = rootState;
      $('rootStatus').textContent = {
        checking: 'Root рұқсаты тексерілуде…',
        granted: 'Root берілді. Басу мен сырғыту осы рұқсатпен орындалады.',
        denied: 'Root берілмеді. Magisk → Superuser бөлімінен «Екі экранға» рұқсат бер немесе Android басқару рұқсатын қос.',
        idle: ''
      }[rootState];
    },
    nativeStarted() {
      nativeCapturePending = false;
      if (!connected || !window.OnlineLink.approveRemote()) { phoneControlNative?.postMessage(JSON.stringify({ type: 'stop' })); return; }
      remoteActive = true; renderRemote();
      message('Экран бөлісіліп тұр. Телефоннан тоқтатуға болады.', false, 'remoteFeedback');
    },
    nativeStopped() {
      const wasActive = remoteActive;
      const wasPending = nativeCapturePending;
      stopRemoteLocal(false);
      if (wasActive) window.OnlineLink.stopRemote();
      else if (wasPending) window.OnlineLink.denyRemote();
    },
    nativeError(text) {
      if (nativeCapturePending) { nativeCapturePending = false; window.OnlineLink.denyRemote(); }
      message(String(text).slice(0, 160), true, 'remoteFeedback');
    },
    nativeFrame(frame) {
      if (!remoteActive || !connected || !frame || typeof frame.data !== 'string') return;
      window.OnlineLink.sendRemoteFrame(frame.data, frame.width, frame.height);
    }
  };
  let pointerStart = null;
  function pointOnScreen(event) {
    const box = $('remoteScreen').getBoundingClientRect();
    return { x: Math.max(0, Math.min(1, (event.clientX - box.left) / box.width)), y: Math.max(0, Math.min(1, (event.clientY - box.top) / box.height)) };
  }
  $('remoteScreen').addEventListener('pointerdown', event => {
    if (!remoteActive) return;
    event.preventDefault(); pointerStart = pointOnScreen(event);
    $('remoteScreen').setPointerCapture(event.pointerId);
  });
  $('remoteScreen').addEventListener('pointerup', event => {
    if (!remoteActive || !pointerStart) return;
    event.preventDefault();
    const end = pointOnScreen(event), start = pointerStart; pointerStart = null;
    const distance = Math.hypot(end.x - start.x, end.y - start.y);
    window.OnlineLink.sendRemoteAction(distance > .025
      ? { kind: 'swipe', x: start.x, y: start.y, x2: end.x, y2: end.y, duration: 350 }
      : { kind: 'tap', x: end.x, y: end.y });
  });
  $('remoteScreen').addEventListener('pointercancel', () => { pointerStart = null; });
  for (const [id, kind] of [['remoteBack','back'],['remoteHome','home'],['remoteRecents','recents']])
    $(id).onclick = () => window.OnlineLink.sendRemoteAction({ kind });

  if (browser) {
    const dialog = $('onlineApproval');
    window.OnlineLink.init(platform, {
      onStatus: value => state({ connected: value, deviceName: connectedDevice.name }),
      onDevice: device => { connectedDevice = { name: device.name || connectedDevice.name, os: device.os || connectedDevice.os }; if (connected) state({ connected: true, deviceName: connectedDevice.name }); },
      onCode: code => { $('pairCode').textContent = code; renderQR(code); },
      onReceive: received,
      onRemoteRequest: () => {
        if (!phoneControlNative || !connected) { window.OnlineLink.denyRemote(); message('Телефонды толық басқару үшін Android қолданбасын аш.', true, 'remoteFeedback'); return; }
        if (!$('remoteApproval').open) $('remoteApproval').showModal();
      },
      onRemoteDenied: () => message('Телефон басқаруға рұқсат бермеді.', true, 'remoteFeedback'),
      onRemoteStart: () => { remoteActive = true; renderRemote(); message('Телефон экраны күтілуде…', false, 'remoteFeedback'); },
      onRemoteStop: () => {
        if ($('remoteApproval').open) $('remoteApproval').close();
        stopRemoteLocal(); message('Басқару тоқтатылды.', false, 'remoteFeedback');
      },
      onRemoteFrame: frame => new Promise(resolve => {
        const screen = $('remoteScreen');
        screen.onload = () => { screen.hidden = false; $('remoteEmpty').hidden = true; resolve(); };
        screen.onerror = () => resolve();
        screen.src = frame.image;
      }),
      onRemoteFrameAck: () => phoneControlNative?.postMessage(JSON.stringify({ type: 'frame-ready' })),
      onRemoteAction: action => phoneControlNative?.postMessage(JSON.stringify({ type: 'gesture', ...action })),
      onNotice: (text, isError) => message(text, isError, 'pairFeedback'),
      onProgress: percent => message('Жіберілуде: ' + percent + '%'),
      onApproval: () => new Promise(resolve => {
        if (dialog.open) { resolve(false); return; }
        const finish = approved => { dialog.close(); resolve(approved); };
        $('onlineAccept').onclick = () => finish(true);
        $('onlineReject').onclick = () => finish(false);
        dialog.oncancel = event => { event.preventDefault(); finish(false); };
        dialog.showModal();
      })
    });
    autoPair();
  } else nativeCall('ready').then(result => { if (result) state(result); }).catch(error => message(error.message, true, 'pairFeedback'));
})();
