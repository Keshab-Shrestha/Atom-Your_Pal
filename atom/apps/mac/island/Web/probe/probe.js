// The probe panel (ADR-211, docs/web-panel-contract.md). It shows what the app sends and sends one intent back.
// All text goes in with textContent; nothing is built as HTML.
(() => {
  'use strict';
  const post = message => window.webkit.messageHandlers.atomPanel.postMessage(message);
  const $ = id => document.getElementById(id);
  const TOKEN_NAME = /^--[a-z-]{1,32}$/;
  const TOKEN_VALUE = /^rgb\(\d{1,3} \d{1,3} \d{1,3}\)$/;
  let revision = -1;

  const reportHeight = () => post({ v: 1, type: 'resize', height: Math.min(4000, Math.ceil(document.body.getBoundingClientRect().height)) });

  const applyTheme = message => {
    const root = document.documentElement;
    const list = $('tokens');
    list.replaceChildren();
    for (const [name, value] of Object.entries(message.tokens || {})) {
      if (!TOKEN_NAME.test(name) || !TOKEN_VALUE.test(value)) continue;
      root.style.setProperty(name, value);
      const item = document.createElement('li');
      const swatch = document.createElement('span');
      swatch.className = 'swatch';
      swatch.style.setProperty('background', value);
      item.append(swatch, document.createTextNode(name));
      list.append(item);
    }
    const scale = Number(message.textScale) || 1;
    root.style.setProperty('--text-scale', String(scale));
    $('summary').textContent = `Scheme ${message.scheme === 'dark' ? 'dark' : 'light'}, text scale ${scale}, motion ${message.reduceMotion ? 'reduced' : 'full'}.`;
  };

  window.atomPanel = {
    receive(message) {
      if (!message || message.v !== 1) return;
      if (message.type === 'init' || message.type === 'theme') {
        applyTheme(message);
      } else if (message.type === 'data') {
        if (!(message.revision > revision)) return;
        revision = message.revision;
        $('revision').textContent = String(revision);
        $('data').textContent = JSON.stringify(message.payload, null, 2);
      } else if (message.type === 'reset') {
        revision = -1;
        $('revision').textContent = 'none';
        $('data').textContent = 'No data yet.';
      }
      reportHeight();
    },
  };

  $('send').addEventListener('click', () => post({ v: 1, type: 'intent', name: 'selectCall', args: { id: 'probe_1' } }));
  post({ v: 1, type: 'ready', panel: 'probe' });
})();
