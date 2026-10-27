(() => {
  'use strict';
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const canvas = document.getElementById('transferCanvas');
  const stage = document.querySelector('.transfer-stage');
  const caption = document.getElementById('transferCaption');
  const detail = document.getElementById('transferDetail');
  let active = false;

  function reset() {
    if (active) return;
    stage.classList.remove('is-delivered');
    caption.textContent = 'Қашықтық — бір қимыл.';
    detail.textContent = 'Кішкентай әрекет. Әдемі ауысу.';
  }

  function receive(element) {
    if (reduced.matches || !element.animate) return;
    element.animate([
      { opacity: .35, transform: 'translateY(8px) scale(.985)' },
      { opacity: 1, transform: 'translateY(0) scale(1)' }
    ], { duration: 420, easing: 'cubic-bezier(.2,.8,.2,1)' });
  }

  // Uses actual image tiles; no uploads, external effects library, or image copies.
  async function send({ type }) {
    if (active) return;
    active = true;
    stage.classList.remove('is-delivered');
    stage.classList.add('is-sending');
    caption.textContent = type === 'image' ? 'Мың бөлшек. Бір бағыт.' : 'Ойың жолға шықты.';
    detail.textContent = 'Келесі экранға қарай…';
    const source = type === 'image' ? document.getElementById('imagePreview') : document.querySelector('.editor');
    if (type === 'image' && source && !source.hidden && !source.complete) {
      try { await source.decode(); } catch {}
    }
    const hasImage = type === 'image' && source && !source.hidden && source.complete && source.naturalWidth;
    try {
      if (reduced.matches || document.hidden) return;
      const context = canvas.getContext('2d');
      if (!context) return;
      const dpr = Math.min(devicePixelRatio || 1, 2);
      canvas.width = Math.round(innerWidth * dpr);
      canvas.height = Math.round(innerHeight * dpr);
      context.scale(dpr, dpr);
      const box = source.getBoundingClientRect();
      let x = box.left, y = box.top, width = box.width, height = box.height;
      if (hasImage) {
        const fit = Math.min(width / source.naturalWidth, height / source.naturalHeight);
        const fittedWidth = source.naturalWidth * fit, fittedHeight = source.naturalHeight * fit;
        x += (width - fittedWidth) / 2; y += (height - fittedHeight) / 2;
        width = fittedWidth; height = fittedHeight;
      }
      const core = document.getElementById('transferCore').getBoundingClientRect();
      const coreVisible = core.top >= 30 && core.bottom < innerHeight - 70;
      const target = coreVisible ? { x: core.left + core.width / 2, y: core.top + core.height / 2 }
        : { x: Math.min(innerWidth - 35, x + width * .9), y: Math.max(65, y - 45) };
      const count = hasImage ? (innerWidth < 600 ? 170 : 290) : 48;
      const columns = Math.max(7, Math.min(30, Math.round(Math.sqrt(count * width / Math.max(height, 1)))));
      const rows = Math.max(5, Math.ceil(count / columns));
      let seed = 1289;
      const random = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
      const pieces = [];
      for (let row = 0; row < rows; row++) {
        for (let column = 0; column < columns; column++) {
          const w = width / columns, h = height / rows;
          const px = x + column * w + w / 2, py = y + row * h + h / 2;
          pieces.push({
            x: px, y: py, w, h, column, row,
            c1x: px + (random() - .4) * 210, c1y: py - 55 - random() * 130,
            c2x: target.x + (random() - .5) * 130, c2y: target.y + (random() - .5) * 100,
            delay: column / columns * .18 + random() * .09,
            rotation: (random() - .5) * 2.3, tint: random() > .76 ? '#d5f5a6' : '#c6a8ff'
          });
        }
      }
      canvas.dataset.active = 'true';
      canvas.dataset.particles = String(pieces.length);
      if (hasImage) source.classList.add('image-sending');
      const duration = hasImage ? 1380 : 580;
      await new Promise(resolve => {
        let animationFrame, timeout, finished = false;
        const started = performance.now();
        function finish() {
          if (finished) return;
          finished = true;
          cancelAnimationFrame(animationFrame);
          clearTimeout(timeout);
          document.removeEventListener('visibilitychange', onVisibility);
          resolve();
        }
        function onVisibility() { if (document.hidden) finish(); }
        function frame(now) {
          const progress = Math.min((now - started) / duration, 1);
          context.clearRect(0, 0, innerWidth, innerHeight);
          const glow = context.createRadialGradient(target.x, target.y, 0, target.x, target.y, 70);
          glow.addColorStop(0, `rgba(201,169,255,${Math.sin(progress * Math.PI) * .18})`);
          glow.addColorStop(1, 'rgba(201,169,255,0)');
          context.fillStyle = glow; context.fillRect(target.x - 70, target.y - 70, 140, 140);
          for (const piece of pieces) {
            const t = Math.max(0, Math.min(1, (progress - piece.delay) / (1 - piece.delay)));
            const q = t * t * (3 - 2 * t), u = 1 - q;
            const px = u ** 3 * piece.x + 3 * u * u * q * piece.c1x + 3 * u * q * q * piece.c2x + q ** 3 * target.x;
            const py = u ** 3 * piece.y + 3 * u * u * q * piece.c1y + 3 * u * q * q * piece.c2y + q ** 3 * target.y;
            context.save(); context.translate(px, py); context.rotate(piece.rotation * q);
            context.globalAlpha = Math.max(0, 1 - Math.pow(t, 2.5));
            const scale = 1 - q * .93;
            if (hasImage) {
              const sw = source.naturalWidth / columns, sh = source.naturalHeight / rows;
              context.drawImage(source, piece.column * sw, piece.row * sh, sw, sh,
                -piece.w * scale / 2, -piece.h * scale / 2, piece.w * scale + .4, piece.h * scale + .4);
            } else {
              context.fillStyle = piece.tint;
              const size = (2 + (piece.column % 3)) * (1 - t * .8);
              context.fillRect(-size / 2, -size / 2, size, size);
            }
            context.restore();
          }
          if (progress < 1) animationFrame = requestAnimationFrame(frame);
          else finish();
        }
        document.addEventListener('visibilitychange', onVisibility);
        timeout = setTimeout(finish, duration + 600);
        frame(started);
      });
    } finally {
      canvas.dataset.active = 'false';
      const context = canvas.getContext('2d');
      if (context) context.clearRect(0, 0, canvas.width, canvas.height);
      source?.classList.remove('image-sending');
      stage.classList.remove('is-sending'); stage.classList.add('is-delivered');
      caption.textContent = 'Вуаля. Келесі экранда.';
      detail.textContent = 'Кішкентай әрекет. Жаңа сезім.';
      active = false;
    }
  }
  window.BailanysEffects = { send, receive, reset };
})();
