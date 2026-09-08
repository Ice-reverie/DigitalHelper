const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function frontend() {
  const element = () => ({
    classList: { toggle() {} }, setAttribute() {}, addEventListener() {},
    appendChild() {}, replaceChildren() {}, focus() {}, disabled: false,
  });
  const elements = new Map();
  const sandbox = {
    document: {
      getElementById(id) { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); },
      createElement: element,
    },
    window: {}, console: { warn() {}, error() {} },
    THREE: { WebGLRenderer: class { constructor() { throw new Error('No WebGL'); } } },
    fetch: async () => ({ ok: true, json: async () => ({ tts_available: false }) }),
    performance: { now: () => 500 },
    SpeechSynthesisUtterance: class { constructor(text) { this.text = text; } },
    atob: (value) => Buffer.from(value, 'base64').toString('binary'),
    setTimeout, clearTimeout,
  };
  const context = vm.createContext(sandbox);
  const source = fs.readFileSync(path.join(__dirname, '../vrm_demo/static/js/VRMCharacter.js'), 'utf8');
  // Browser imports are the only substitution; the real startup and handlers run.
  vm.runInContext(source.replace(/^import .*;\r?\n/gm, ''), context);
  return { context, sandbox, run: (code) => vm.runInContext(code, context) };
}

test('missing and undecodable sentences fall back in order without repeating successful audio', async () => {
  const f = frontend();
  const events = [];
  f.sandbox.window.speechSynthesis = {
    speak(utterance) {
      events.push(`speech:${utterance.text}`);
      utterance.onstart();
      setTimeout(() => { events.push(`end:${utterance.text}`); utterance.onend(); }, 5);
    },
  };
  f.sandbox.record = (value) => events.push(value);
  f.run(`audioContext = {
    state: 'running',
    async decodeAudioData(bytes) { if (new Uint8Array(bytes)[0] === 0) throw Error('bad MP3'); return {}; },
  };
  playAudioWithVisemes = async () => { record('audio'); };`);
  const result = await f.run(`playSegments([
    { text: 'first', audio: 'AQ==' },
    { text: 'second', audio: '' },
    { text: 'third', audio: 'AA==' },
    { text: 'fourth', audio: 'AQ==' },
  ])`);
  assert.deepEqual(events, ['audio', 'speech:second', 'end:second', 'speech:third', 'end:third', 'audio']);
  assert.equal(result.played, 4);
  assert.equal(result.failed, 0);
  assert.equal(f.run('speaking || browserSpeaking'), false);
});

test('all audio failures use browser speech and absence of both reports failure', async () => {
  const f = frontend();
  f.run(`audioContext = { state: 'running', async decodeAudioData() { throw Error('decode'); } };`);
  let spoken = 0;
  f.sandbox.window.speechSynthesis = { speak(u) { spoken++; u.onstart(); u.onend(); } };
  assert.equal((await f.run(`playSegments([{text:'fallback', audio:'AA=='}])`)).played, 1);
  assert.equal(spoken, 1);
  delete f.sandbox.window.speechSynthesis;
  assert.equal((await f.run(`playSegments([{text:'unavailable', audio:'AA=='}])`)).failed, 1);
});

test('browser speech errors resolve and clear the speaking state', async () => {
  const f = frontend();
  f.sandbox.window.speechSynthesis = { speak(u) { u.onstart(); u.onerror(); } };
  assert.equal(await f.run(`speakWithBrowser('failed')`), false);
  assert.equal(f.run('speaking || browserSpeaking'), false);
});

function avatar(f) {
  const values = {};
  f.sandbox.values = values;
  f.run(`currentVrm = {
    expressionManager: { setValue(name, value) { values[name] = value; } },
    humanoid: { getNormalizedBoneNode() { return null; } }, update() {},
  };`);
  return values;
}

test('no timeline uses energy; silence closes the mouth; expired cues do not linger', () => {
  const f = frontend();
  const values = avatar(f);
  f.run(`audioContext = { currentTime: 0.2 }; currentVisemes = {
    timeline: [], startTime: 0, lastIndex: -1, lastTarget: null, lastOpen: 0, smoothOpen: 0,
    analyser: { getByteTimeDomainData(samples) { samples.fill(180); } }, samples: new Uint8Array(16),
  }; updateAvatar(0.016);`);
  assert.ok(['aa', 'ih', 'ou', 'ee', 'oh'].some((v) => values[v] > 0));
  f.run(`currentVisemes.analyser.getByteTimeDomainData = (s) => s.fill(128);
    for (let i = 0; i < 80; i++) updateAvatar(0.016);`);
  assert.ok(['aa', 'ih', 'ou', 'ee', 'oh'].every((v) => (values[v] || 0) < 0.03));
  f.run(`currentVisemes.timeline = [{start:0, end:0.1, viseme:'aa'}]; updateAvatar(0.016);`);
  assert.ok(['aa', 'ih', 'ou', 'ee', 'oh'].every((v) => values[v] === 0));
});

test('browser speech animates the mouth and resets it on completion', async () => {
  const f = frontend();
  const values = avatar(f);
  let utterance;
  f.sandbox.window.speechSynthesis = { speak(u) { utterance = u; u.onstart(); } };
  const playback = f.run(`speakWithBrowser('hello')`);
  f.run('updateAvatar(0.016)');
  assert.ok(['aa', 'ih', 'ou', 'ee', 'oh'].some((v) => values[v] > 0));
  utterance.onend();
  assert.equal(await playback, true);
  assert.ok(['aa', 'ih', 'ou', 'ee', 'oh'].every((v) => values[v] === 0));
});
