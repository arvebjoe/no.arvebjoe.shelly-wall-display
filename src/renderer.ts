/**
 * Renders a GuiLayout to a single, self-contained HTML document.
 *
 * The same renderer is used for the file served to the physical display
 * and for the live preview inside the editor. In preview mode the
 * WebSocket runtime is disabled so the editor's browser never registers
 * itself as a display device.
 */

import {
  GuiLayout, LayoutNode, ContainerNode, ButtonNode, SliderNode, LabelNode, sliderLevels,
} from './layout-types';

export interface RenderOptions {
  /** When true, no WebSocket connection is made and no messages are sent. */
  preview?: boolean;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Only allow safe CSS color values (named colors, hex, rgb()/hsl()). */
function safeColor(value: string | undefined, fallback: string): string {
  if (typeof value === 'string' && /^[#a-zA-Z0-9(),.%\s-]{1,40}$/.test(value.trim()) && value.trim().length > 0) {
    return value.trim();
  }
  return fallback;
}

/** Only allow relative paths or http(s) URLs for images. */
function safeImageUrl(value: string | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 500) return null;
  if (/^(javascript|data|vbscript):/i.test(trimmed)) return null;
  return trimmed;
}

function num(value: number | undefined, fallback: number, min: number, max: number): number {
  if (Number.isFinite(value)) {
    return Math.min(max, Math.max(min, value as number));
  }
  return fallback;
}

function renderNode(node: LayoutNode): string {
  const weight = num(node.weight, 1, 0.01, 100);
  const flex = `flex:${weight} 1 0;`;

  switch (node.type) {
    case 'container': {
      const c = node as ContainerNode;
      const gap = num(c.gap, 12, 0, 200);
      const padding = num(c.padding, 0, 0, 200);
      const bg = c.background ? `background:${safeColor(c.background, 'transparent')};border-radius:var(--radius);` : '';
      const children = (c.children || []).map(renderNode).join('\n');
      return `<div class="gui-container" style="${flex}flex-direction:${c.direction === 'row' ? 'row' : 'column'};gap:${gap}px;padding:${padding}px;${bg}">\n${children}\n</div>`;
    }

    case 'button': {
      const b = node as ButtonNode;
      const color = safeColor(b.color, '#ffffff');
      const fontSize = num(b.fontSize, 0, 8, 200);
      const fontStyle = fontSize ? `font-size:${fontSize}px;` : '';
      const image = safeImageUrl(b.image);
      const imageActive = safeImageUrl(b.imageActive);
      const alt = escapeHtml(b.label || b.scene);
      const imageHtml = (image ? `<img src="${escapeHtml(image)}" alt="${alt}" draggable="false" />` : '')
        + (imageActive ? `<img class="gui-button-image-active" src="${escapeHtml(imageActive)}" alt="${alt}" draggable="false" />` : '');
      const template = b.label && /\$\w+/.test(b.label) ? ` data-template="${escapeHtml(b.label)}"` : '';
      const labelHtml = b.label ? `<span class="gui-button-label"${template} style="${fontStyle}">${escapeHtml(b.label)}</span>` : '';
      const classes = `gui-button${image || imageActive ? ' has-image' : ''}${imageActive ? ' has-active-image' : ''}${b.glow === false ? ' no-glow' : ''}`;
      return `<button class="${classes}" data-scene="${escapeHtml(b.scene)}" style="${flex}--accent:${color};">${imageHtml}${labelHtml}</button>`;
    }

    case 'slider': {
      const s = node as SliderNode;
      const color = safeColor(s.color, '#f1c40f');
      const name = (typeof s.name === 'string' && s.name.length > 0) ? s.name : 'light';
      const levels = sliderLevels(s).map((level) => ({
        name: typeof level.name === 'string' ? level.name : '',
        value: num(level.value, 0, 0, 1),
      }));
      // Shown top-to-bottom with the first level (off) at the top,
      // matching the original hand-made GUI in public/index.html.
      const labelHtml = levels
        .map((l) => `<span>${escapeHtml(l.name)}</span>`).join('');
      const values = levels.map((l) => l.value).join(',');
      return `<div class="gui-slider" data-slider data-name="${escapeHtml(name)}" data-values="${values}" style="${flex}--fill:${color};">
  <div class="gui-slider-fill"></div>
  <div class="gui-slider-handle"></div>
  <div class="gui-slider-labels">${labelHtml}</div>
</div>`;
    }

    case 'label': {
      const l = node as LabelNode;
      const color = safeColor(l.color, '#ffffff');
      const fontSize = num(l.fontSize, 24, 8, 300);
      const align = l.align === 'left' || l.align === 'right' ? l.align : 'center';
      const justifyMap = { left: 'flex-start', center: 'center', right: 'flex-end' };
      // Text with $tokens (e.g. "$time") keeps its template in a data
      // attribute so the runtime can re-resolve the values every second.
      const template = /\$\w+/.test(l.text) ? ` data-template="${escapeHtml(l.text)}"` : '';
      return `<div class="gui-label"${template} style="${flex}color:${color};font-size:${fontSize}px;`
        + `text-align:${align};justify-content:${justifyMap[align]};">${escapeHtml(l.text)}</div>`;
    }

    default:
      return '';
  }
}

const STYLES = `
    :root {
      --bg-primary: #0a0a0a;
      --bg-button: #2a2a2a;
      --bg-button-active: #4a4a4a;
      --text-primary: #ffffff;
      --radius: 16px;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body {
      height: 100vh;
      font-family: system-ui, -apple-system, "Segoe UI", Roboto, Ubuntu, Cantarell, Arial, sans-serif;
      background: var(--bg-primary);
      color: var(--text-primary);
      overflow: hidden;
    }
    .gui-root { height: 100vh; display: flex; }
    .gui-container { display: flex; min-width: 0; min-height: 0; }
    .gui-label {
      display: flex; align-items: center;
      min-width: 0; min-height: 0; overflow: hidden;
      font-weight: 600; user-select: none;
    }
    .gui-button {
      background: var(--bg-button);
      border: none; border-radius: var(--radius);
      color: var(--text-primary); cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      font-size: clamp(20px, 4vw, 44px); font-weight: 600;
      user-select: none; -webkit-tap-highlight-color: transparent;
      position: relative; overflow: hidden;
      min-width: 0; min-height: 0;
      transition: all 0.2s ease;
    }
    .gui-button:active { background: var(--bg-button-active); }
    .gui-button img {
      position: absolute; inset: 0; width: 100%; height: 100%;
      object-fit: cover;
      filter: grayscale(100%) brightness(0.7);
      transition: filter 0.3s ease, opacity 0.3s ease;
    }
    .gui-button .gui-button-label { position: relative; z-index: 1; text-shadow: 0 2px 8px rgba(0,0,0,0.7); }
    .gui-button.active { box-shadow: 0 0 20px var(--accent, rgba(255,255,255,0.4)); }
    .gui-button.no-glow.active { box-shadow: none; }
    .gui-button.active img { filter: grayscale(0%) brightness(1); }
    /* With an active image the button crossfades between the two images
       instead of graying out. */
    .gui-button.has-active-image img { filter: none; }
    .gui-button .gui-button-image-active { opacity: 0; }
    .gui-button.active .gui-button-image-active { opacity: 1; }
    .gui-button.pressed { transform: scale(0.95); }

    .gui-slider {
      position: relative;
      background: #1a1a1a url('/light_off.png') no-repeat center / cover;
      border: 2px solid #333; border-radius: var(--radius);
      overflow: hidden; cursor: grab;
      min-width: 0; min-height: 0; touch-action: none;
    }
    .gui-slider:active { cursor: grabbing; }
    .gui-slider-fill {
      position: absolute; inset: 0;
      background: url('/light_on.png') no-repeat center / cover;
      clip-path: inset(0 0 100% 0);
      transition: clip-path 0.25s ease; pointer-events: none;
    }
    .gui-slider-handle {
      position: absolute; left: 50%; top: 0%;
      width: 56px; height: 8px;
      background: #fff; border: 2px solid #333; border-radius: 4px;
      transform: translate(-50%, -50%); transition: top 0.25s ease;
      box-shadow: 0 2px 8px rgba(0,0,0,0.3); pointer-events: none;
    }
    .gui-slider:active .gui-slider-handle { background: var(--fill, #f1c40f); }
    .gui-slider-labels {
      position: absolute; right: 8px; top: 0; height: 100%;
      display: flex; flex-direction: column; justify-content: space-between;
      padding: 10px 0; font-size: clamp(11px, 2vw, 16px); font-weight: 600;
      color: #ccc; pointer-events: none; text-shadow: 0 1px 4px rgba(0,0,0,0.8);
    }

    .reconnection-overlay {
      position: fixed; inset: 0; background: rgba(0,0,0,0.8);
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      z-index: 1000; backdrop-filter: blur(4px);
    }
    .reconnection-overlay.hidden { display: none; }
    .reconnection-message { font-size: clamp(24px, 4vw, 48px); font-weight: 600; margin-bottom: 24px; }
    .reconnection-status { color: #ccc; font-size: clamp(16px, 3vw, 24px); }
`;

const RUNTIME_SCRIPT = `
    var PREVIEW = window.__GUI_PREVIEW__ === true;
    var ws = null;
    var reconnectAttempts = 0;
    var reconnectTimer = null;

    var overlay = document.getElementById('reconnection-overlay');
    var overlayStatus = document.getElementById('reconnection-status');

    function showOverlay() { if (!PREVIEW) overlay.classList.remove('hidden'); }
    function hideOverlay() { overlay.classList.add('hidden'); }

    function connectWebSocket() {
      if (PREVIEW) return;
      var protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      try {
        ws = new WebSocket(protocol + '//' + window.location.host);
        ws.onopen = function () {
          reconnectAttempts = 0;
          hideOverlay();
          if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
        };
        ws.onmessage = function (event) {
          try { handleMessage(JSON.parse(event.data)); } catch (e) { console.error(e); }
        };
        ws.onclose = function () {
          showOverlay();
          reconnectAttempts++;
          overlayStatus.textContent = 'Reconnecting... (attempt ' + reconnectAttempts + ')';
          reconnectTimer = setTimeout(connectWebSocket, Math.min(2000 + reconnectAttempts * 1000, 30000));
        };
        ws.onerror = function () { showOverlay(); };
      } catch (e) { showOverlay(); }
    }

    function send(type, data) {
      if (PREVIEW) return;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: type, data: data }));
      } else {
        showOverlay();
        if (!reconnectTimer) connectWebSocket();
      }
    }

    function handleMessage(message) {
      switch (message.type) {
        case 'scene-complete':
          if (message.data.name === 'status-pending') { window.location.href = '/pending.html'; return; }
          setActiveScene(message.data.name, message.data.active);
          break;
        case 'light-complete': {
          var value = message.data.value;
          if (value === undefined) {
            // Older server versions only send the discrete level (0-3)
            value = [0, 0.05, 0.5, 1][message.data.strength] || 0;
          }
          // Only move the named slider; no name means all sliders
          updateSliders(value, message.data.name);
          break;
        }
        case 'variable':
          VARS[message.data.name] = message.data.value;
          updateDynamicLabels();
          break;
        case 'reload':
          window.location.reload();
          break;
      }
    }

    function setActiveScene(name, active) {
      document.querySelectorAll('.gui-button').forEach(function (btn) {
        btn.classList.remove('pressed');
        if (btn.dataset.scene === name) {
          btn.classList.toggle('active', !!active);
        }
      });
    }

    function sliderValues(slider) {
      if (!slider._values) {
        var parsed = (slider.dataset.values || '').split(',').map(function (v) { return parseFloat(v); });
        slider._values = parsed.length >= 2 && parsed.every(isFinite) ? parsed : [0, 0.05, 0.5, 1];
      }
      return slider._values;
    }

    function nearestIndex(values, value) {
      var best = 0;
      for (var i = 1; i < values.length; i++) {
        if (Math.abs(values[i] - value) < Math.abs(values[best] - value)) best = i;
      }
      return best;
    }

    // Snaps one slider to its nearest configured level for a 0-1 value
    function setSlider(slider, value) {
      var values = sliderValues(slider);
      var idx = nearestIndex(values, value);
      slider._current = values[idx];
      var pct = (idx / (values.length - 1)) * 100;
      // Reveal the top pct% of the light_on image over the light_off background
      slider.querySelector('.gui-slider-fill').style.clipPath = 'inset(0 0 ' + (100 - pct) + '% 0)';
      slider.querySelector('.gui-slider-handle').style.top = pct + '%';
    }

    function updateSliders(value, name) {
      document.querySelectorAll('[data-slider]').forEach(function (slider) {
        if (name && slider.dataset.name !== name) return;
        setSlider(slider, value);
      });
    }

    // Scene buttons
    document.querySelectorAll('.gui-button').forEach(function (button) {
      button.addEventListener('click', function () {
        var scene = button.dataset.scene;
        var newActive = !button.classList.contains('active');
        document.querySelectorAll('.gui-button').forEach(function (b) { b.classList.remove('pressed'); });
        button.classList.add('pressed');
        if (PREVIEW) { setActiveScene(scene, newActive); return; }
        send('scene', { name: scene, active: newActive });
      });
    });

    // Sliders (top = first level/off, bottom = last level/full, like the original GUI)
    document.querySelectorAll('[data-slider]').forEach(function (slider) {
      var dragging = false;
      function apply(clientY) {
        var values = sliderValues(slider);
        var rect = slider.getBoundingClientRect();
        var rel = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
        var value = values[Math.round(rel * (values.length - 1))];
        if (value !== slider._current) {
          setSlider(slider, value);
          if (PREVIEW) return;
          send('light', { name: slider.dataset.name, value: value });
        }
      }
      slider.addEventListener('mousedown', function (e) { dragging = true; apply(e.clientY); });
      document.addEventListener('mousemove', function (e) { if (dragging) apply(e.clientY); });
      document.addEventListener('mouseup', function () { dragging = false; });
      slider.addEventListener('touchstart', function (e) { e.preventDefault(); dragging = true; apply(e.touches[0].clientY); }, { passive: false });
      document.addEventListener('touchmove', function (e) { if (dragging) { e.preventDefault(); apply(e.touches[0].clientY); } }, { passive: false });
      document.addEventListener('touchend', function () { dragging = false; });
    });

    // Live values for $tokens in label and button text. Built-ins are
    // resolved every second; anything else is a display variable pushed
    // by the "set-variable" Flow card (unset variables show nothing).
    // Add new built-ins by extending this map.
    var LABEL_VALUES = {
      time: function (now) {
        return ('0' + now.getHours()).slice(-2) + ':' + ('0' + now.getMinutes()).slice(-2);
      },
      date: function (now) {
        return now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
      }
    };
    var VARS = {};

    var dynamicLabels = document.querySelectorAll('[data-template]');
    function updateDynamicLabels() {
      var now = new Date();
      dynamicLabels.forEach(function (el) {
        el.textContent = el.getAttribute('data-template').replace(/\\$(\\w+)/g, function (match, name) {
          if (LABEL_VALUES[name]) return LABEL_VALUES[name](now);
          if (VARS[name] !== undefined) return VARS[name];
          // In the editor preview keep the token visible so it can be placed
          return PREVIEW ? match : '';
        });
      });
    }
    if (dynamicLabels.length) {
      updateDynamicLabels();
      setInterval(updateDynamicLabels, 1000);
    }

    updateSliders(0);
    connectWebSocket();

    document.addEventListener('selectstart', function (e) { e.preventDefault(); });
    document.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible' && !PREVIEW && (!ws || ws.readyState === WebSocket.CLOSED)) {
        reconnectAttempts = 0;
        connectWebSocket();
      }
    });
`;

export function renderLayoutHtml(layout: GuiLayout, options: RenderOptions = {}): string {
  const rootHtml = renderNode(layout.root);
  const preview = options.preview === true;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Homey Display</title>
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no" />
  <meta name="color-scheme" content="dark" />
  <style>${STYLES}</style>
</head>
<body>
  <div class="gui-root">
${rootHtml}
  </div>
  <div class="reconnection-overlay hidden" id="reconnection-overlay">
    <div class="reconnection-message">Connection Lost</div>
    <div class="reconnection-status" id="reconnection-status">Attempting to reconnect...</div>
  </div>
  <script>
    window.__GUI_PREVIEW__ = ${preview ? 'true' : 'false'};
${RUNTIME_SCRIPT}
  </script>
</body>
</html>
`;
}
