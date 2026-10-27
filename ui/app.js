(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const android = window.BailanysNative;
  const windows = window.chrome?.webview;
  const browser = !android && !windows;
  const preview = false;
  const requestedPlatform = new URLSearchParams(location.search).get('platform');
  const actualPhone = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && innerWidth <= 820);
  let platform = browser ? (actualPhone ? 'android' : 'windows') : (['android', 'windows'].includes(requestedPlatform) ? requestedPlatform : (actualPhone ? 'android' : 'windows'));
  let connected = false, mode = 'text', image = null, last = null, sequence = 0, busy = false;
  const pending = new Map(), historyItems = [];
  const effects = window.BailanysEffects;
  const navigation = document.querySelector('nav');
  const sidebar = document.querySelector('.sidebar');
  let pairingLink = '';
  let qrAutoStarted = false;
  let connectedPhone = { name: platform === 'android' ? 'Ноутбук' : 'Телефон', os: platform === 'android' ? 'Ноутбук' : 'Телефон' };
  function drawConnectedDevices() {
    const panel = $('connectedDevices');
    if (!panel) return;
    panel.hidden = !connected;
    const list = $('connectedDevicesList');
    const count = $('connectedDevicesCount');
    list.replaceChildren();
    count.textContent = connected ? '1 құрылғы' : '0 құрылғы';
    if (!connected) {
      const empty = document.createElement('div');
      empty.className = 'connected-device-empty';
      const symbol = document.createElement('span');
      symbol.className = 'connected-device-empty-icon';
      symbol.textContent = '⌁';
      symbol.setAttribute('aria-hidden', 'true');
      const body = document.createElement('div');
      const heading = document.createElement('strong');
      heading.textContent = 'Әзірге құрылғы қосылмаған';
      const description = document.createElement('p');
      description.textContent = platform === 'android' ? 'Ноутбуктағы QR-кодты сканерлеп, қосылуды раста.' : 'Телефонмен QR-кодты сканерлеп, ноутбукта қосылуды раста.';
      body.append(heading, description);
      empty.append(symbol, body);
      list.append(empty);
      return;
    }
    const row = document.createElement('div');
    row.className = 'connected-device-row';
    const icon = document.createElement('span');
    icon.className = 'connected-device-phone-icon';
    icon.textContent = platform === 'android' ? '▱' : '▯';
    icon.setAttribute('aria-hidden', 'true');
    const info = document.createElement('div');
    info.className = 'connected-device-info';
    const name = document.createElement('strong');
    name.textContent = connectedPhone.name;
    const details = document.createElement('span');
    details.textContent = connectedPhone.os + ' · WebRTC шифрланған байланыс';
    info.append(name, details);
    const live = document.createElement('span');
    live.className = 'connected-device-live';
    live.textContent = '● Онлайн';
    row.append(icon, info, live);
    list.append(row);
  }
  function renderPairQr(code) {
    pairingLink = '';
    const root = $('pairQr');
    root.replaceChildren();
    $('copyPairLink').disabled = true;
    if (!/^WP-[A-Z2-9]{16}$/.test(code)) {
      $('qrStatus').textContent = 'QR-код жасалмады. Бетті қайта жүкте.';
      return;
    }
    const url = new URL(location.href);
    url.searchParams.delete('platform');
    url.searchParams.delete('pair');
    url.searchParams.set('pair', code);
    pairingLink = url.href;
    $('copyPairLink').disabled = false;
    if (typeof window.QRCode !== 'function') {
      $('qrStatus').textContent = 'QR кітапханасы жүктелмеді. Кодты қолмен енгіз.';
      return;
    }
    try {
      new window.QRCode(root, {
        text: pairingLink, width: 232, height: 232,
        colorDark: '#22162d', colorLight: '#ffffff',
        correctLevel: window.QRCode.CorrectLevel.M
      });
      $('qrStatus').textContent = 'QR дайын. Телефон камерасымен сканерле.';
    } catch (error) {
      $('qrStatus').textContent = 'QR құрастыру қатесі. Код арқылы қосыл.';
    }
  }
  async function autoPairFromQr() {
    if (!browser || platform !== 'android' || qrAutoStarted) return;
    const url = new URL(location.href);
    const code = url.searchParams.get('pair');
    if (!code) return;
    url.searchParams.delete('pair');
    window.history.replaceState(null, '', url);
    if (!/^WP-[A-Z2-9]{16}$/.test(code)) {
      tab('connection');
      feedback('QR сілтемесі жарамсыз. Ноутбуктағы кодты қолмен енгіз.', true, 'pairFeedback');
      return;
    }
    qrAutoStarted = true;
    $('codeInput').value = code;
    tab('connection');
    feedback('QR сканерленді. Ноутбуктың растауын күтуде…', false, 'pairFeedback');
    $('pairButton').click();
  }


  let cameraStream = null;
  let cameraAnimation = 0;
  let cameraDetecting = false;
  let cameraLastFrame = 0;
  const cameraCanvas = document.createElement('canvas');
  const cameraContext = cameraCanvas.getContext('2d', { willReadFrequently: true });
  function cameraMessage(text) { $('cameraFeedback').textContent = text; $('cameraHelp').textContent = text; }
  function stopQrCamera() {
    if (cameraAnimation) cancelAnimationFrame(cameraAnimation);
    cameraAnimation = 0;
    const video = $('qrCameraVideo');
    video.pause();
    video.srcObject = null;
    if (cameraStream) cameraStream.getTracks().forEach(track => track.stop());
    cameraStream = null;
    cameraDetecting = false;
    $('cameraArea').hidden = true;
    $('startQrCamera').disabled = false;
  }
  function qrCodeFromValue(value) {
    if (typeof value !== 'string' || value.length > 2048) return null;
    try {
      const url = new URL(value);
      if (url.origin !== location.origin || !url.pathname.endsWith('/ui/')) return null;
      const code = url.searchParams.get('pair');
      return code && /^WP-[A-Z2-9]{16}$/.test(code) ? code : null;
    } catch {
      const code = value.trim().toUpperCase();
      return /^WP-[A-Z2-9]{16}$/.test(code) ? code : null;
    }
  }
  function completeQrScan(value) {
    const code = qrCodeFromValue(value);
    if (!code) {
      cameraMessage('Бұл осы сайттың QR-коды емес. Ноутбуктағы QR-кодты көрсет.');
      return;
    }
    stopQrCamera();
    $('codeInput').value = code;
    tab('connection');
    feedback('QR танылды. Ноутбукте қосылуға рұқсат бер.', false, 'pairFeedback');
    if (!connected && !busy) $('pairButton').click();
  }
  async function startQrCamera() {
    if (!browser || platform !== 'android' || cameraStream) return;
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      cameraMessage('Браузер камераны бұғаттады. Сайтты Chrome/Safari-де тікелей HTTPS арқылы аш немесе «QR-кодты фотоға түсіру» батырмасын бас.');
      return;
    }
    if (!cameraContext || typeof window.jsQR !== 'function') {
      cameraMessage('QR тану кітапханасы жүктелмеген. Сайтты қайта жаңарт.');
      return;
    }
    $('startQrCamera').disabled = true;
    $('cameraArea').hidden = false;
    cameraMessage('Камераға рұқсат бер…');
    try {
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: 'environment' } });
      } catch (error) {
        if (error.name !== 'OverconstrainedError' && error.name !== 'NotFoundError') throw error;
        stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: true });
      }
      cameraStream = stream;
      const video = $('qrCameraVideo');
      video.srcObject = stream;
      video.muted = true;
      video.setAttribute('playsinline', '');
      // Don't block indefinitely if the browser stalls the play() promise.
      video.play().catch(() => {
        cameraMessage('Камера іске қосыла алмады. QR-ды фотоға түсіру режимін таңда.');
        stopQrCamera();
      });
      cameraMessage('Камера қосылуда… QR-кодты жақтаудың ішіне орналастыр.');
      cameraDetecting = true;
      const frame = now => {
        if (!cameraDetecting) return;
        cameraAnimation = requestAnimationFrame(frame);
        if (now - cameraLastFrame < 130 || video.readyState < 2) return;
        cameraLastFrame = now;
        const width = Math.min(640, video.videoWidth);
        if (!width || !video.videoHeight) return;
        const height = Math.round(width * video.videoHeight / video.videoWidth);
        cameraCanvas.width = width; cameraCanvas.height = height;
        try {
          cameraContext.drawImage(video, 0, 0, width, height);
          const pixels = cameraContext.getImageData(0, 0, width, height);
          const found = window.jsQR(pixels.data, width, height, { inversionAttempts: 'attemptBoth' });
          if (found?.data) completeQrScan(found.data);
        } catch (error) {
          cameraMessage('QR тану қатесі. QR-ды фотоға түсіріп көр.');
          stopQrCamera();
        }
      };
      cameraAnimation = requestAnimationFrame(frame);
    } catch (error) {
      stopQrCamera();
      const message = ['NotAllowedError','PermissionDeniedError','SecurityError'].includes(error?.name)
        ? 'Камераға рұқсат берілмеді. Браузерден камераға рұқсат бер немесе QR фотосын таңда.'
        : ['NotReadableError','TrackStartError','AbortError'].includes(error?.name)
        ? 'Камера бос емес. Басқа камера қолданбасын жап немесе QR фотосын таңда.'
        : 'Камера ашылмады (' + (error?.name || 'қате') + '). «QR-кодты фотоға түсіру» батырмасын пайдалан.';
      cameraMessage(message);
    }
  }
  async function scanQrImage(file) {
    if (!file) return;
    if (typeof window.jsQR !== 'function' || !cameraContext) {
      cameraMessage('QR тану кітапханасы жүктелмеген. Сайтты жаңарт.');
      return;
    }
    if (file.size > 20 * 1024 * 1024) { cameraMessage('Сурет 20 МБ-тан аспасын.'); return; }
    try {
      const url = URL.createObjectURL(file);
      const photo = new Image();
      try {
        photo.src = url;
        await photo.decode();
        const width = Math.min(1600, photo.naturalWidth);
        const height = Math.round(width * photo.naturalHeight / photo.naturalWidth);
        cameraCanvas.width = width; cameraCanvas.height = height;
        cameraContext.drawImage(photo,0,0,width,height);
        const pixels = cameraContext.getImageData(0,0,width,height);
        const result = window.jsQR(pixels.data,width,height,{inversionAttempts:'attemptBoth'});
        if (!result?.data) cameraMessage('Суреттен QR оқылмады. Анығырақ түсір.');
        else completeQrScan(result.data);
      } finally { URL.revokeObjectURL(url); }
    } catch (error) { cameraMessage('Фотоны оқу мүмкін болмады. Басқа сурет таңда.'); }
  }
  $('takeQrPhoto').onclick = () => { $('qrCameraCapture').value = ''; $('qrCameraCapture').click(); };
  $('chooseQrPhoto').onclick = () => { $('qrImagePicker').value = ''; $('qrImagePicker').click(); };
  $('qrCameraCapture').onchange = event => scanQrImage(event.target.files?.[0]);
  $('qrImagePicker').onchange = event => scanQrImage(event.target.files?.[0]);
  $('startQrCamera').onclick = startQrCamera;
  $('stopQrCamera').onclick = stopQrCamera;
  document.addEventListener('visibilitychange', () => { if (document.hidden) stopQrCamera(); });
  window.addEventListener('pagehide', stopQrCamera);

  function tab(id) {
    if (id !== 'connection' && cameraStream) stopQrCamera();
    document.querySelectorAll('.page').forEach(page => { page.hidden = page.id !== id; });
    document.querySelectorAll('.nav').forEach(button => {
      button.classList.toggle('active', button.dataset.tab === id);
      if (button.dataset.tab === id) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });
  }

  function arrangeNavigation() {
    if (platform === 'android' || innerWidth <= 900) document.querySelector('main').append(navigation);
    else sidebar.insertBefore(navigation, document.querySelector('.device'));
  }

  function renderPlatform(value) {
    platform = value;
    document.body.dataset.platform = platform;
    const phone = platform === 'android';
    $('senderPanel').hidden = !phone;
    $('receiverPanel').hidden = phone;
    $('androidPair').hidden = !phone;
    $('windowsPair').hidden = phone;
    $('subtitle').textContent = preview
      ? (phone ? 'Мәтін мен суретті жіберіп, интерфейсті тексер.' : 'Демо жіберілімнің нәтижесі осы жерде көрінеді.')
      : (phone ? 'Сурет, мәтін немесе код — бір батырмамен.' : 'Телефоннан келген сурет, мәтін және код — ноутбук буферінде.');
    $('previewAndroid').setAttribute('aria-pressed', String(phone));
    $('previewWindows').setAttribute('aria-pressed', String(!phone));
    arrangeNavigation();
    drawConnectedDevices();
    if (browser) {
      const url = new URL(location.href);
      url.searchParams.set('platform', value);
      window.history.replaceState(null, '', url);
      state({ connected });
    }
  }

  function feedback(message, error = false, id = 'feedback') {
    $(id).textContent = message;
    $(id).className = 'feedback ' + (error ? 'error' : 'success');
  }

  function state(data) {
    connected = Boolean(data.connected);
    if (!connected) connectedPhone = { name: platform === 'android' ? 'Ноутбук' : 'Телефон', os: platform === 'android' ? 'Ноутбук' : 'Телефон' };
    drawConnectedDevices();
    document.body.dataset.connected = String(connected);
    if (!connected) effects?.reset();
    const device = data.deviceName || (platform === 'windows' ? 'Телефон' : 'Ноутбук');
    $('deviceName').textContent = connected ? device : 'Құрылғы қосылмаған';
    $('statusText').textContent = connected ? ('Онлайн қосылды') : 'Қосылмаған';
    $('statusDot').classList.toggle('online', connected);
    $('connectionHeading').textContent = connected
      ? device : (platform === 'windows' ? 'Телефонды қос' : 'Ноутбукке қосыл');
    $('connectionDescription').textContent = browser
      ? (connected ? 'Шифрланған WebRTC арнасы қосылды.' : 'Интернет арқылы қосыл. Бір Wi-Fi міндетті емес.')
      : (connected ? 'Жеке Wi-Fi байланысы' : 'Құрылғыға қосылу керек.');
    $('openConnection').textContent = connected ? 'Басқару →' : 'Қосылу →';
    $('disconnectButton').disabled = !connected;
    $('demoConnect').disabled = connected;
    $('demoConnect').textContent = connected ? 'Демо байланыс қосылды' : 'Демо байланысты қосу';
    if (data.addresses) $('localAddresses').value = data.addresses.join('  /  ');
    if (data.code) $('pairCode').textContent = data.code;
    if (data.fingerprint) $('fingerprint').value = data.fingerprint;
    if (data.host) $('hostInput').value = data.host;
  }

  function call(action, data = {}) {
    return new Promise((resolve, reject) => {
      if (preview) {
        reject(new Error('Бұл бет интерфейсті демо режимде тексеруге арналған.'));
        return;
      }
      const id = ++sequence;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error('Күту уақыты аяқталды. Байланысты тексер.'));
      }, 65000);
      pending.set(id, { resolve, reject, timer });
      const request = JSON.stringify({ id, action, data });
      try {
        if (android) android.postMessage(request);
        else windows.postMessage(request);
      } catch (error) {
        clearTimeout(timer);
        pending.delete(id);
        reject(error);
      }
    });
  }

  window.Bailanys = {
    receive(message) {
      if (typeof message === 'string') message = JSON.parse(message);
      if (message.id) {
        const item = pending.get(message.id);
        if (!item) return;
        clearTimeout(item.timer);
        pending.delete(message.id);
        if (message.error) item.reject(new Error(message.error));
        else item.resolve(message.result);
        return;
      }
      if (message.event === 'state') state(message.data);
      if (message.event === 'received') received(message.data);
      if (message.event === 'sharedText') {
        $('textInput').value = message.data.text;
        setMode('text'); updateCount(); tab('clipboard');
      }
      if (message.event === 'sharedImage') {
        image = message.data;
        setMode('image'); showImage(); tab('clipboard');
      }
    }
  };
  if (windows) windows.addEventListener('message', event => window.Bailanys.receive(event.data));

  function setMode(value) {
    mode = value;
    document.body.dataset.mode = value;
    $('textPanel').hidden = value !== 'text';
    $('imagePanel').hidden = value !== 'image';
    for (const type of ['text', 'image']) {
      $(type + 'Tab').classList.toggle('selected', type === value);
      $(type + 'Tab').setAttribute('aria-selected', String(type === value));
      $(type + 'Tab').tabIndex = type === value ? 0 : -1;
    }
  }
  $('textTab').onclick = () => setMode('text');
  $('imageTab').onclick = () => setMode('image');
  for (const id of ['textTab', 'imageTab']) {
    $(id).onkeydown = event => {
      if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
        event.preventDefault();
        const value = event.key === 'Home' ? 'text' : event.key === 'End' ? 'image' : mode === 'text' ? 'image' : 'text';
        setMode(value); $(value + 'Tab').focus();
      }
    };
  }
  function updateCount() { $('charCount').textContent = $('textInput').value.length + ' таңба'; }
  $('textInput').oninput = updateCount;
  function showImage() {
    if (image?.preview) { $('imagePreview').src = image.preview; $('imagePreview').hidden = false; }
    $('imageName').textContent = image?.name || 'Сурет таңдалды';
    $('imagePicker').classList.toggle('has-image', Boolean(image));
  }
  $('pickImage').onclick = async () => {
    if (browser) { $('browserImageInput').value = ''; $('browserImageInput').click(); return; }
    try {
      const result = await call('pickImage');
      if (result) { image = result; showImage(); }
    } catch (error) { feedback(error.message, true); }
  };
  $('browserImageInput').onchange = async event => {
    const file = event.target.files[0];
    if (!file) return;
    if (!['image/png', 'image/jpeg'].includes(file.type)) { feedback('PNG немесе JPEG суретін таңда.', true); return; }
    if (file.size > 20 * 1024 * 1024) { feedback('Сурет көлемі 20 МБ-тан аспауы керек.', true); return; }
    try {
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('Суретті оқу мүмкін болмады.'));
        reader.readAsDataURL(file);
      });
      const decoded = new Image(); decoded.src = dataUrl; await decoded.decode();
      image = { name: file.name, preview: dataUrl, file };
      showImage(); feedback('Сурет жіберуге дайын.');
    } catch { feedback('Сурет файлын ашу мүмкін болмады. Басқа суретті таңда.', true); }
  };

  function record(title, type, direction) {
    historyItems.unshift({ title, type, direction, time: new Date().toLocaleTimeString('kk-KZ', { hour: '2-digit', minute: '2-digit' }) });
    historyItems.splice(10);
    $('historyList').replaceChildren();
    for (const item of historyItems) {
      const row = document.createElement('div'); row.className = 'history-item';
      const icon = document.createElement('span'); icon.textContent = item.type === 'image' ? '▧' : '▤';
      const body = document.createElement('div'), strong = document.createElement('strong'), small = document.createElement('small');
      strong.textContent = item.title.slice(0, 100);
      small.textContent = item.time + ' · ' + item.direction;
      body.append(strong, small); row.append(icon, body); $('historyList').append(row);
    }
  }

  $('sendButton').onclick = async () => {
    if (busy) return;
    if (!connected) { tab('connection'); feedback('Алдымен ноутбукке қосыл.', true, 'pairFeedback'); return; }
    if (mode === 'text' && !$('textInput').value.trim()) { feedback('Мәтінді немесе кодыңды енгіз.', true); return; }
    if (mode === 'image' && !image) { feedback('Алдымен суретті таңда.', true); return; }
    busy = true; $('sendButton').disabled = true;
    $('sendButton').classList.add('is-sending');
    const sendLabel = $('sendButton').firstElementChild.textContent;
    $('sendButton').firstElementChild.textContent = mode === 'image' ? 'Бөлшектерге айналып…' : 'Жіберілуде…';
    for (const id of ['previewAndroid', 'previewWindows', 'showDemoResult', 'pickImage', 'useDemoImage', 'textTab', 'imageTab']) {
      if ($(id)) $(id).disabled = true;
    }
    try {
      if (browser) {
        if (mode === 'text') await window.OnlineLink.sendText($('textInput').value);
        else await window.OnlineLink.sendImage(image.preview, image.name);
        await effects?.send({ type: mode });
        feedback('Ноутбукқа онлайн жеткізілді.');
        record(mode === 'text' ? $('textInput').value : image.name, mode, 'Жіберілді');
      } else {
        feedback('Жіберілуде…');
        await call(mode === 'text' ? 'sendText' : 'sendImage', mode === 'text' ? { text: $('textInput').value } : { imageId: image.id });
        await effects?.send({ type: mode });
        feedback('Жіберілді. Ноутбукта Ctrl + V бас.');
        record(mode === 'text' ? $('textInput').value : image.name || 'Сурет', mode, 'Жіберілді');
      }
    } catch (error) { feedback(error.message, true); }
    finally {
      busy = false; $('sendButton').disabled = false;
      $('sendButton').classList.remove('is-sending');
      $('sendButton').firstElementChild.textContent = sendLabel;
      for (const id of ['previewAndroid', 'previewWindows', 'showDemoResult', 'pickImage', 'useDemoImage', 'textTab', 'imageTab']) {
        if ($(id)) $(id).disabled = false;
      }
    }
  };

  $('demoConnect').onclick = () => {
    state({ connected: true });
    feedback('Демо байланыс қосылды. «Телефон» көрінісінен мәтін немесе сурет жібер.', false, 'pairFeedback');
    tab('clipboard');
  };
  $('pairButton').onclick = async () => {
    if (busy) return;
    busy = true; $('pairButton').disabled = true;
    try {
      if (browser) {
        feedback('Ноутбук растауын күтуде…', false, 'pairFeedback');
        await window.OnlineLink.connect($('codeInput').value.trim());
        feedback('Ноутбукпен онлайн байланыс орнады.', false, 'pairFeedback');
        tab('clipboard');
      } else {
        const host = $('hostInput').value.trim(), code = $('codeInput').value.trim();
        if (!/^\d{6}$/.test(code)) throw new Error('Ноутбуктағы 6 таңбалы кодты енгіз.');
        const probe = await call('probe', { host });
        $('trustFingerprint').textContent = probe.fingerprint;
        const trusted = await new Promise(resolve => {
          $('confirmTrust').onclick = () => { $('trustDialog').close(); resolve(true); };
          $('rejectTrust').onclick = () => { $('trustDialog').close(); resolve(false); };
          $('trustDialog').oncancel = () => resolve(false);
          $('trustDialog').showModal();
        });
        if (!trusted) throw new Error('Жұптасу тоқтатылды.');
        state(await call('pair', { host, code, pin: probe.pin }));
      }
    } catch (error) { feedback(error.message, true, 'pairFeedback'); }
    finally { busy = false; $('pairButton').disabled = false; }
  };
  $('disconnectButton').onclick = async () => {
    try {
      if (browser) { window.OnlineLink.disconnect(); state({ connected: false }); }
      else state(await call('disconnect'));
      feedback('Байланыс ажыратылды.', false, 'pairFeedback');
    } catch (error) { feedback(error.message, true, 'pairFeedback'); }
  };

  function received(data) {
    last = data;
    $('receivedContent').replaceChildren();
    if (data.type === 'image') {
      const img = document.createElement('img'); img.src = data.preview; img.alt = 'Қабылданған сурет';
      $('receivedContent').append(img);
    } else $('receivedContent').textContent = data.text;
    $('receiveBadge').textContent = data.copied ? 'Буферге көшірілді' : 'Қабылданды';
    $('copyAgain').disabled = false;
    $('demoStart').hidden = true;
    effects?.receive($('receivedContent'));
    record(data.type === 'image' ? data.name || 'Сурет' : data.text, data.type, 'Қабылданды');
    if (true) feedback(data.copied ? 'Буферге көшірілді. Ctrl + V бас.' : 'Қабылданды. Буферге қайта көшіруге болады.');
  }

  // Called from the copy click so browser clipboard access keeps the user's gesture.
  function copyPreview() {
    if (!navigator.clipboard) return Promise.reject(new Error('Буферге көшіру бұл браузерде қолжетімсіз.'));
    if (last.type === 'text') return navigator.clipboard.writeText(last.text);
    if (!window.ClipboardItem || !navigator.clipboard.write) return Promise.reject(new Error('Сурет көшіруді қолдайтын Chrome немесе Edge браузерін аш.'));
    const png = new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas'); canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
        canvas.getContext('2d').drawImage(img, 0, 0);
        canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Суретті көшіру мүмкін болмады.')), 'image/png');
      };
      img.onerror = () => reject(new Error('Суретті ашу мүмкін болмады.'));
      img.src = last.preview;
    });
    return navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
  }
  $('copyAgain').onclick = async () => {
    if (!last) return;
    try {
      await (browser ? copyPreview() : call('copyAgain'));
      $('receiveBadge').textContent = 'Буферге көшірілді'; feedback('Осы құрылғының буферіне көшірілді.');
    } catch { feedback('Көшіру орындалмады. Браузердің буферге рұқсатын тексер немесе мәтінді белгілеп көшір.', true); }
  };
  $('autoCopy').onchange = async () => {
    try { if (!browser) await call('autoCopy', { enabled: $('autoCopy').checked }); }
    catch (error) { feedback(error.message, true); }
  };

  document.querySelectorAll('.nav').forEach(button => { button.onclick = () => tab(button.dataset.tab); });
  $('openConnection').onclick = () => tab('connection');
  window.addEventListener('resize', arrangeNavigation);
  if (browser) {
    document.body.classList.add('browser-preview');
    $('environment').hidden = true;
    $('previewToolbar').hidden = true;
    $('demoPair').hidden = true;
    $('demoStart').hidden = true;
    $('useDemoImage').hidden = true;
    $('copyAgain').textContent = 'Буферге көшіру';
    $('sendButton').firstElementChild.textContent = 'Ноутбукке онлайн жіберу';
    $('transferHint').textContent = 'Жіберген сурет пен мәтін ноутбукта бірден көрсетіледі.';
    document.querySelector('.switch-row').hidden = true;
    document.querySelector('#receivedContent p').textContent = 'Телефоннан жіберілген мәтін не сурет осы жерде пайда болады.';
    $('privacyTitle').textContent = 'Шифрланған тікелей байланыс';
    $('privacyText').textContent = 'Жұптастыру үшін PeerJS сервері қолданылады, ал мәлімет WebRTC арқылы жіберіледі.';
    $('previewAndroid').onclick = () => {};
    $('previewWindows').onclick = () => {};
    const dialog = $('onlineApproval');
    window.OnlineLink.init(platform, {
      onStatus: value => state({ connected: value, deviceName: connectedPhone.name }),
      onDevice: device => {
        connectedPhone = { name: device.name || 'Телефон', os: device.os || 'Телефон' };
        if (connected) {
          state({ connected: true, deviceName: connectedPhone.name });
        }
      },
      onCode: code => { $('pairCode').textContent = code; renderPairQr(code); },
      onReceive: received,
      onNotice: (message, isError) => feedback(message, isError, 'pairFeedback'),
      onProgress: percent => feedback('Жіберілуде: ' + percent + '%'),
      onApproval: () => new Promise(resolve => {
        if (dialog.open) { resolve(false); return; }
        const finish = value => { dialog.close(); resolve(value); };
        $('onlineAccept').onclick = () => finish(true);
        $('onlineReject').onclick = () => finish(false);
        dialog.oncancel = event => { event.preventDefault(); finish(false); };
        dialog.showModal();
      })
    });
    if (platform === 'windows') tab('connection');
    $('copyPairLink').onclick = async () => {
      if (!pairingLink) return;
      try { await navigator.clipboard.writeText(pairingLink); feedback('Қосылу сілтемесі көшірілді.', false, 'pairFeedback'); }
      catch { feedback('Сілтемені көшіруге рұқсат жоқ.', true, 'pairFeedback'); }
    };
  }
  renderPlatform(platform);
  setMode('text');
  if (!browser || platform === 'android') tab('clipboard');
  if (browser) autoPairFromQr();
  if (!browser) call('ready').then(result => { if (result) state(result); }).catch(error => feedback(error.message, true));
})();
