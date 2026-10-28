// The Run panel (ADR-211, docs/web-panel-contract.md): the tool calls and questions of one chat turn.
// It only shows data. All text goes in with textContent; nothing is built as HTML.
(() => {
  'use strict';
  const post = message => window.webkit.messageHandlers.atomPanel.postMessage(message);
  const $ = id => document.getElementById(id);
  const TOKEN_NAME = /^--[a-z-]{1,32}$/;
  const TOKEN_VALUE = /^rgb\(\d{1,3} \d{1,3} \d{1,3}\)$/;
  const RUN_STATES = { working: 'Working', completed: 'Completed', failed: 'Failed', stopped: 'Stopped', interrupted: 'Interrupted' };
  const CALL_STATES = { started: ['running', '● Running'], ok: ['ok', '✓ Done'], error: ['error', '✕ Failed'], unknown: ['', '? Unknown'] };
  const QUESTION_STATES = { pending: 'Waiting for you', answered: 'Answered', skipped: 'Skipped', expired: 'Expired' };
  const SECTIONS = { pipeline: 'Pipeline', lanes: 'Lanes', evidence: 'Evidence' };
  let revision = -1;
  let run = null; // { state, elapsedMs, receivedAt }
  let timer = null;

  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  const formatMs = ms => {
    if (!Number.isFinite(ms)) return '';
    if (ms < 1000) return `${Math.round(ms)} ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)} s`;
    return `${Math.floor(ms / 60000)} min ${Math.round((ms % 60000) / 1000)} s`;
  };

  const showStatus = () => {
    if (!run) { $('status').textContent = ''; return; }
    const live = run.state === 'working' ? performance.now() - run.receivedAt : 0;
    const label = RUN_STATES[run.state] || 'Unknown';
    $('status').textContent = `${label} · ${formatMs(run.elapsedMs + live)}`;
  };

  const applyTheme = message => {
    const root = document.documentElement;
    for (const [name, value] of Object.entries(message.tokens || {})) {
      if (TOKEN_NAME.test(name) && TOKEN_VALUE.test(value)) root.style.setProperty(name, value);
    }
    root.style.setProperty('--text-scale', String(Number(message.textScale) || 1));
  };

  const render = payload => {
    run = { state: String(payload.state), elapsedMs: Number(payload.elapsedMs) || 0, receivedAt: performance.now() };
    $('empty').hidden = true;
    const calls = Array.isArray(payload.calls) ? payload.calls : [];
    const list = $('calls');
    list.replaceChildren();
    for (const call of calls) {
      const [kind, label] = CALL_STATES[call.state] || ['', '? Unknown'];
      const item = el('li');
      item.append(el('span', 'tool', String(call.tool)), el('span', `chip ${kind}`, label), el('span', 'time', typeof call.ms === 'number' ? formatMs(call.ms) : ''));
      list.append(item);
    }
    const omitted = Number(payload.omitted) || 0;
    $('calls-section').hidden = calls.length === 0 && omitted === 0;
    $('omitted').hidden = omitted === 0;
    $('omitted').textContent = `${omitted} more tool call${omitted === 1 ? '' : 's'} not shown.`;

    const questions = Array.isArray(payload.questions) ? payload.questions : [];
    const qlist = $('questions');
    qlist.replaceChildren();
    for (const question of questions) {
      const item = el('li');
      item.append(el('span', 'prompt', String(question.prompt)), el('span', 'chip', QUESTION_STATES[question.state] || 'Unknown'));
      qlist.append(item);
    }
    $('questions-section').hidden = questions.length === 0;

    const missing = Array.isArray(payload.unavailable) ? payload.unavailable.filter(name => SECTIONS[name]) : [];
    const ulist = $('unavailable');
    ulist.replaceChildren();
    for (const name of missing) {
      const item = el('li');
      item.append(el('span', '', SECTIONS[name]), el('span', 'chip', 'Not available'));
      ulist.append(item);
    }
    $('unavailable-section').hidden = missing.length === 0;

    showStatus();
    clearInterval(timer);
    timer = run.state === 'working' ? setInterval(showStatus, 1000) : null;
  };

  const clear = () => {
    run = null;
    clearInterval(timer);
    timer = null;
    $('empty').hidden = false;
    for (const id of ['calls-section', 'questions-section', 'unavailable-section']) $(id).hidden = true;
    showStatus();
  };

  window.atomPanel = {
    receive(message) {
      if (!message || message.v !== 1) return;
      if (message.type === 'init' || message.type === 'theme') {
        applyTheme(message);
      } else if (message.type === 'data') {
        if (!(message.revision > revision) || !message.payload) return;
        revision = message.revision;
        render(message.payload);
      } else if (message.type === 'reset') {
        revision = -1;
        clear();
      }
    },
  };

  post({ v: 1, type: 'ready', panel: 'run' });
})();
