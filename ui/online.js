/* Live browser-to-browser WebRTC transfer. PeerJS Cloud only brokers discovery; content goes over the encrypted data channel. */
(() => {
  'use strict';
  const SIZE_LIMIT = 28 * 1024 * 1024;
  const CHUNK = 16 * 1024;
  const WINDOW = 16;
  const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let peer, channel, role, hooks = {}, pendingConnect, pendingSend, incoming = null, authenticated = false;
  let peerReadyResolve, peerReadyReject;
  let peerReady = new Promise((resolve, reject) => { peerReadyResolve = resolve; peerReadyReject = reject; });
  const isOpen = () => Boolean(channel?.open && authenticated);

  function randomCode() {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return 'WP-' + Array.from(bytes, b => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
  }
  function rejectSend(message) {
    if (pendingSend) {
      clearTimeout(pendingSend.timer);
      pendingSend.reject(new Error(message));
      pendingSend = null;
    }
  }
  function report(message, error = false) { hooks.onNotice?.(message, error); }
  function status(connected) { hooks.onStatus?.(connected); }

  function setChannel(next) {
    if (channel && channel !== next && channel.open) channel.close();
    channel = next;
    authenticated = false;
    next.on('data', data => handleData(next, data));
    next.on('close', () => {
      if (channel !== next) return;
      authenticated = false;
      incoming = null;
      rejectSend('Жіберілім үзілді. Қайта қосыл.');
      if (pendingConnect) { pendingConnect.reject(new Error('Құрылғы қосылмады.')); pendingConnect = null; }
      status(false);
    });
    next.on('error', error => {
      report('Қосылым қатесі: ' + (error?.message || 'Желі қатесі'), true);
      if (pendingConnect) { pendingConnect.reject(new Error('Қосылу сәтсіз аяқталды.')); pendingConnect = null; }
    });
    next.on('open', async () => {
      if (role !== 'windows') return;
      let allowed = false;
      try { allowed = await hooks.onApproval?.(); }
      catch { allowed = false; }
      if (channel !== next || !next.open) return;
      if (!allowed) { next.send({ t: 'rejected' }); setTimeout(() => next.close(), 300); return; }
      authenticated = true;
      next.send({ t: 'accepted' });
      // Share the laptop's general platform after the user approves pairing.
      // Browsers cannot reveal the computer's personal device/host name.
      const ua = navigator.userAgent || '';
      const os = /Windows/i.test(ua) ? 'Windows' :
        /Macintosh|Mac OS X/i.test(ua) ? 'macOS' :
        /Linux/i.test(ua) ? 'Linux' : 'Ноутбук';
      const name = os === 'Ноутбук' ? 'Ноутбук' : os + ' ноутбук';
      next.send({ t: 'device-info', name, os });
      status(true);
      report('Телефон қосылды. Мәтін мен суретті қабылдауға дайын.');
    });
  }
  function handleData(c, data) {
    if (c !== channel || !data || typeof data !== 'object') return;
    if (data.t === 'accepted' && role === 'android') {
      authenticated = true;
      // Identify the actual connected phone only after the laptop approves it.
      const ua = navigator.userAgent || '';
      const os = /Android/i.test(ua) ? 'Android' :
        /iPhone|iPad|iPod/i.test(ua) ? 'iOS' : 'Телефон';
      const name = os === 'Android' ? 'Android телефон' :
        os === 'iOS' ? 'iPhone' : 'Телефон';
      c.send({ t: 'device-info', name, os });
      status(true);
      if (pendingConnect) { pendingConnect.resolve(); pendingConnect = null; }
      return;
    }
    if (data.t === 'rejected' && role === 'android') {
      if (pendingConnect) { pendingConnect.reject(new Error('Ноутбук қосылуға рұқсат бермеді.')); pendingConnect = null; }
      return;
    }
    if (!authenticated) return;
    if (data.t === 'device-info') {
      // Only accept peer details through the approved, encrypted connection.
      const fallback = role === 'windows' ? 'Телефон' : 'Ноутбук';
      const name = typeof data.name === 'string' ? data.name.slice(0, 60) : fallback;
      const os = typeof data.os === 'string' ? data.os.slice(0, 30) : fallback;
      hooks.onDevice?.({ name: name || fallback, os: os || fallback });
      return;
    }
    if (data.t === 'begin' && role === 'windows') {
      if (incoming || !Number.isSafeInteger(data.length) || data.length < 1 || data.length > SIZE_LIMIT ||
          !['text', 'image'].includes(data.kind) || typeof data.id !== 'string' || data.id.length > 64) {
        c.send({ t: 'abort', id: data.id, reason: 'Файл көлемі не форматы сәйкес емес.' }); return;
      }
      incoming = { id: data.id, kind: data.kind, name: String(data.name || 'Сурет').slice(0, 120),
        length: data.length, received: 0, parts: [] };
      return;
    }
    if (data.t === 'chunk' && role === 'windows' && incoming && data.id === incoming.id) {
      if (typeof data.payload !== 'string' || data.payload.length > CHUNK ||
          incoming.received + data.payload.length > incoming.length) {
        incoming = null; c.send({ t: 'abort', id: data.id, reason: 'Дерек бүлінді.' }); return;
      }
      incoming.parts.push(data.payload);
      incoming.received += data.payload.length;
      return;
    }
    if (data.t === 'batch' && role === 'windows' && incoming && incoming.id === data.id) {
      c.send({ t: 'ack', id: data.id, received: incoming.received });
      return;
    }
    if (data.t === 'finish' && role === 'windows' && incoming && incoming.id === data.id) {
      const packet = incoming; incoming = null;
      if (packet.received !== packet.length) {
        c.send({ t: 'abort', id: data.id, reason: 'Толық жіберілмеді.' }); return;
      }
      const value = packet.parts.join('');
      if (packet.kind === 'image' && !/^data:image\/(?:png|jpeg);base64,/.test(value)) {
        c.send({ t: 'abort', id: data.id, reason: 'Бұл сурет түрі қолдау таппайды.' }); return;
      }
      hooks.onReceive?.(packet.kind === 'image'
        ? { type: 'image', name: packet.name, preview: value, copied: false }
        : { type: 'text', text: value, copied: false });
      c.send({ t: 'delivered', id: data.id });
      return;
    }
    if (pendingSend && pendingSend.id === data.id) {
      if (data.t === 'ack') { pendingSend.pump(); return; }
      if (data.t === 'delivered') {
        const p = pendingSend; pendingSend = null; clearTimeout(p.timer); p.resolve();
        return;
      }
      if (data.t === 'abort') rejectSend(String(data.reason || 'Жіберілім тоқтатылды.'));
    }
  }

  function init(nextRole, callbacks) {
    role = nextRole; hooks = callbacks || {};
    const identity = role === 'windows' ? randomCode() : null;
    if (identity) hooks.onCode?.(identity);
    if (typeof window.Peer !== 'function') {
      report('QR дайын, бірақ байланыс модулі жүктелмеді. Интернетті тексеріп, бетті жаңарт.', true);
      peerReadyReject(new Error('PeerJS жүктелмеді'));
      return;
    }
    peer = role === 'windows' ? new Peer(identity, { debug: 1 }) : new Peer({ debug: 1 });
    peer.on('open', id => { peerReadyResolve(); if (role === 'windows') { hooks.onCode?.(id); report('Онлайн қосылуға дайын. QR-кодты телефонмен сканерле.'); } });
    peer.on('connection', c => {
      if (role !== 'windows' || channel?.open) { c.on('open', () => c.close()); return; }
      setChannel(c);
    });
    peer.on('error', error => {
      const reason = error?.type === 'unavailable-id' ? 'Код бос емес. Бетті қайта жүкте.' :
        error?.type === 'peer-unavailable' ? 'Бұл кодпен ноутбук табылмады. Кодты тексер.' :
        error?.type === 'network' ? 'Интернет байланысын тексер.' :
        'Онлайн байланыс қатесі: ' + (error?.message || 'Белгісіз қате');
      report(reason, true);
      if (!peer.open) peerReadyReject(new Error(reason));
      if (pendingConnect) { pendingConnect.reject(new Error(reason)); pendingConnect = null; }
    });
    peer.on('disconnected', () => {
      if (!isOpen()) report('Желімен байланыс үзілді. Интернетті тексер.', true);
    });
  }
  async function connect(code) {
    if (role !== 'android') throw new Error('Тек телефоннан қосыл.');
    const normalized = code.toUpperCase().replace(/\s+/g, '');
    if (!/^WP-[A-Z2-9]{16}$/.test(normalized)) throw new Error('Ноутбуктағы WP- кодын толық енгіз.');
    await peerReady;
    if (pendingConnect || isOpen()) throw new Error('Байланыс әлдеқашан басталған.');
    return new Promise((resolve, reject) => {
      const c = peer.connect(normalized, { reliable: true });
      if (!c) { reject(new Error('Желіге қосылу мүмкін болмады.')); return; }
      let timeout = setTimeout(() => {
        if (pendingConnect?.connection === c) { pendingConnect = null; c.close(); reject(new Error('Күту уақыты аяқталды. Басқа желіде қайта көр.')); }
      }, 30000);
      pendingConnect = {
        connection: c,
        resolve() { clearTimeout(timeout); resolve(); },
        reject(e) { clearTimeout(timeout); reject(e); }
      };
      setChannel(c);
    });
  }
  function send(kind, value, name = '') {
    if (!isOpen()) return Promise.reject(new Error('Алдымен телефонды ноутбукпен жұптастыр.'));
    if (pendingSend) return Promise.reject(new Error('Алдыңғы жіберілім аяқталсын.'));
    if (typeof value !== 'string' || !value.length || value.length > SIZE_LIMIT)
      return Promise.reject(new Error('Дерек 20 МБ-тан аспауы тиіс.'));
    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      let position = 0;
      const timer = setTimeout(() => rejectSend('Жіберуге тым ұзақ уақыт кетті.'), 180000);
      const pump = () => {
        if (!pendingSend || !isOpen()) return;
        if (position >= value.length) { channel.send({ t: 'finish', id }); return; }
        const until = Math.min(value.length, position + CHUNK * WINDOW);
        while (position < until) {
          channel.send({ t: 'chunk', id, payload: value.slice(position, position + CHUNK) });
          position += CHUNK;
        }
        hooks.onProgress?.(Math.min(100, Math.round(position / value.length * 100)));
        channel.send({ t: 'batch', id });
      };
      pendingSend = { id, pump, resolve, reject, timer };
      try { channel.send({ t: 'begin', id, kind, name, length: value.length }); pump(); }
      catch (error) { rejectSend(error.message); }
    });
  }
  function disconnect() {
    if (pendingConnect) { pendingConnect.reject(new Error('Қосылу тоқтатылды.')); pendingConnect = null; }
    rejectSend('Жіберілім тоқтатылды.');
    const c = channel;
    channel = null; incoming = null; authenticated = false;
    c?.close(); status(false);
  }
  window.OnlineLink = {
    init, connect, disconnect,
    sendText: text => send('text', text),
    sendImage: (dataUrl, name) => send('image', dataUrl, name),
    isOpen
  };
})();
