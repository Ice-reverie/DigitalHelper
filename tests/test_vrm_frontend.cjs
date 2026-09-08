const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function frontend() {
  const element = () => ({
    handlers: {}, attributes: {},
    classList: { toggle() {} },
    setAttribute(name, value) { this.attributes[name] = value; },
    addEventListener(name, handler) { this.handlers[name] = handler; },
    querySelectorAll() { return []; }, scrollIntoView() {},
    children: [], appendChild(child) { this.children.push(child); child.parent = this; }, remove() { this.parent.children = this.parent.children.filter(child => child !== this); }, replaceChildren() { this.children = []; }, focus() {}, disabled: false,
  });
  const elements = new Map();
  const service = { ...element(), dataset: { service: '预约门诊' } };
  const classes = new Set();
  const sandbox = {
    document: {
      querySelectorAll() { return [service]; },
      documentElement: { classList: { toggle(name, force) {
        if (force !== undefined) { if (force) classes.add(name); else classes.delete(name); return force; }
        if (classes.has(name)) { classes.delete(name); return false; }
        classes.add(name); return true;
      } } },
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
  return { context, sandbox, elements, service, classes, run: (code) => vm.runInContext(code, context) };
}

test('large text toggles reversibly with an accessible pressed state', () => {
  const f = frontend();
  const button = f.elements.get('font-size-btn');
  button.handlers.click();
  assert.ok(f.classes.has('large-text'));
  assert.equal(button.attributes['aria-pressed'], 'true');
  button.handlers.click();
  assert.equal(f.classes.has('large-text'), false);
  assert.equal(button.attributes['aria-pressed'], 'false');
});

test('full-body framing fits both portrait and landscape without excessive empty space', () => {
  for (const aspect of [0.4, 1, 2]) {
    const f = frontend();
    f.run(`THREE.Vector3 = class {};
      THREE.MathUtils = {degToRad: (degrees) => degrees * Math.PI / 180};
      avatarBounds = {
        getSize() { return {x:0.7, y:1.7, z:0.3}; },
        getCenter() { return {x:0, y:0.85, z:0}; },
      };
      camera = { fov:30, aspect:${aspect}, position:{set(x,y,z){this.x=x;this.y=y;this.z=z;}}, updateProjectionMatrix(){} };
      controls = { target:{copy(value){Object.assign(this,value);}}, update(){} };
      fitAvatar();`);
    const camera = f.run('camera');
    const nearestDepth = camera.position.z - 0.15;
    const visibleHeight = 2 * nearestDepth * Math.tan(Math.PI / 12);
    const occupancy = Math.max(1.7 / visibleHeight, 0.7 / (visibleHeight * aspect));
    assert.ok(occupancy <= 1 && occupancy > 0.85);
    assert.equal(camera.position.y, 0.85);
    assert.ok(f.run('controls.minDistance') < camera.position.z * 0.5);
    const fullBodyDistance = camera.position.z;
    f.run('camera.position.z = controls.minDistance; fitAvatar();');
    assert.equal(camera.position.z, fullBodyDistance);
  }
});

test('service entry sends the intended request without requiring typing', () => {
  const f = frontend();
  let request;
  f.sandbox.captureRequest = (value, newService) => { request = { value, newService }; };
  f.run('sendMessage = captureRequest;');
  f.service.handlers.click();
  assert.deepEqual(request, { value: '预约门诊', newService: true });
});

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


test('recent bubbles stay limited while history retains every message', () => {
  const f = frontend();
  f.run("addMessage('first', true); addMessage('reply', false); addMessage('second', true);");
  assert.equal(f.elements.get('messages').children.length, 2);
  assert.equal(f.elements.get('history-messages').children.length, 4);
  assert.equal(f.elements.get('messages').children[1].children[1].textContent, 'second');
});

test('motion control pauses ambient and avatar motion reversibly', () => {
  const f = frontend();
  const button = f.elements.get('motion-btn');
  button.handlers.click();
  assert.equal(f.run('motionReduced'), true);
  assert.ok(f.classes.has('motion-reduced'));
  assert.equal(button.attributes['aria-pressed'], 'true');
  button.handlers.click();
  assert.equal(f.run('motionReduced'), false);
  assert.equal(f.classes.has('motion-reduced'), false);
});

test('gaze input is bounded and centered for pointer tracking', () => {
  const f = frontend();
  f.run('setGazePointer(500, 250, 1000, 500)');
  assert.equal(f.run('gazePointer.x'), 0);
  assert.equal(f.run('gazePointer.y'), 0);
  f.run('setGazePointer(2000, -20, 1000, 500)');
  assert.equal(f.run('gazePointer.x'), 1);
  assert.equal(f.run('gazePointer.y'), -1);
});

test('idle sampling wraps at the loop boundary and reduced motion freezes its clock', () => {
  const f = frontend();
  assert.equal(f.run('idleSample(8, 8, 30).index'), 0);
  assert.equal(f.run('idleSample(7.99, 8, 30).index'), 239);
  f.run('idleAnimation = { duration:8, fps:30, time:2, tracks:[] }; motionReduced = true; updateIdle(.05)');
  assert.equal(f.run('idleAnimation.time'), 2);
  f.run('motionReduced = false; updateIdle(.05)');
  assert.equal(f.run('idleAnimation.time'), 2.05);
});

test('blinking closes then reopens both eyes and schedules the next blink', () => {
  const f = frontend();
  const values = avatar(f);
  f.run('nextBlinkAt = 100; updateBlink(100); updateBlink(220)');
  assert.equal(values.blink, 1);
  f.run('updateBlink(341)');
  assert.equal(values.blink, 0);
  assert.ok(f.run('nextBlinkAt') >= 2541);
});


test('scene actions deduplicate consecutive scenes and honor reduced motion', () => {
  const f = frontend();
  f.run("currentVrm = {}; calls = []; playActionByName = name => calls.push(name); handleAction('booking'); handleAction('booking'); handleAction('confirm'); handleAction('booking');");
  assert.deepEqual(Array.from(f.run('calls')), ['booking','confirm','booking']);
  f.run("motionReduced = true; handleAction('wink');");
  assert.equal(f.run('calls.length'), 3);
});

test('late scene loads and previous-model loads cannot replace current actions', async () => {
  const f = frontend();
  f.run("currentVrm = {}; played = []; pending = {}; getSceneAnimation = name => new Promise(resolve => pending[name] = resolve); playVrmAnimation = (a,l,n) => played.push(n); THREE.LoopOnce = 1;");
  const old = f.run("playActionByName('greet')");
  const fresh = f.run("playActionByName('wink')");
  f.run("pending.wink({}); pending.greet({});");
  await Promise.all([old,fresh]);
  assert.deepEqual(Array.from(f.run('played')), ['wink']);
  const changing = f.run("playActionByName('thanks')");
  f.run('modelLoadId += 1; pending.thanks({});');
  await changing;
  assert.equal(f.run('played.length'), 1);
});

test('animation cache shares loads and retries failed resources', async () => {
  const f = frontend();
  f.run('loads = []; createAnimationLoader = () => ({ load(...args) { loads.push(args); } });');
  const a = f.run("getSceneAnimation('greet')");
  const b = f.run("getSceneAnimation('greet')");
  assert.equal(a, b);
  f.run("loads[0][1]({ userData:{vrmAnimations:[{duration:3}]} });");
  await a;
  assert.equal(f.run('loads.length'), 1);
  const bad = f.run("getSceneAnimation('thanks')");
  f.run("loads[1][3](new Error('missing'));");
  await assert.rejects(bad);
  const retry = f.run("getSceneAnimation('thanks')");
  assert.equal(f.run('loads.length'), 3);
  f.run("loads[2][1]({userData:{vrmAnimations:[{}]}});");
  await retry;
});

test('full-expression actions keep face tracks; others defer to speech and blink', () => {
  const f = frontend();
  f.run(`sample = { humanoidTracks:{rotation:new Map([['head',{}],['leftEye',{}],['jaw',{}]]),translation:new Map()},
    expressionTracks:{preset:new Map([['aa',{}],['blinkLeft',{}],['happy',{}]]),custom:new Map([['unsupported',{}]])},lookAtTrack:{} };
    model = {expressionManager:{getExpression:n => ['aa','blinkLeft'].includes(n)}};`);
  assert.deepEqual(Array.from(f.run("filteredSceneAnimation(sample,'greet',model).expressionTracks.preset.keys()")),[]);
  assert.deepEqual(Array.from(f.run("filteredSceneAnimation(sample,'greet',model).humanoidTracks.rotation.keys()")),['head']);
  assert.deepEqual(Array.from(f.run("filteredSceneAnimation(sample,'thanks',model).expressionTracks.preset.keys()")),['aa','blinkLeft']);
  assert.deepEqual(Array.from(f.run("filteredSceneAnimation(sample,'thanks',model).humanoidTracks.rotation.keys()")),['head','leftEye','jaw']);
  assert.equal(f.run("filteredSceneAnimation(sample,'greet',model).lookAtTrack"),null);
});

test('finished actions release mixer, clear expressions and restore base pose', () => {
  const f = frontend();
  f.run(`currentVrm = {scene:{},expressionManager:{setValue(n,v){cleared[n]=v;},getValue(){return 1;}}};
    cleared = {}; stopped = false; restored = 0;
    modelPose = [{node:{quaternion:{copy(){restored++;}},position:{copy(){restored++;}}}, rotation:{},position:{}}];
    scenePlayback = {elapsed:0, duration:.3, bases:[], bindings:[], expressions:['blinkLeft']}; activeAction = {};
    mixer = {update(){},stopAllAction(){stopped=true;},uncacheRoot(){}};
    updateSceneAnimation(.3);`);
  assert.equal(f.run('activeAction'),null);
  assert.equal(f.run('scenePlayback'),null);
  assert.equal(f.run('stopped'),true);
  assert.equal(f.run('cleared.blinkLeft'),0);
  assert.equal(f.run('restored'),2);
});


test('held action samples survive idle writes when the mixer skips unchanged values', () => {
  const f = frontend();
  f.run(`target = {weight:0}; proxy = {weight:0}; cached = false;
    scenePlayback = {elapsed:0, duration:3, bases:[], expressions:[],
      bindings:[{target,proxy,property:'weight'}]};
    mixer = {update(){ if(!cached){ proxy.weight=1; cached=true; } }};
    held=[];
    for(let frame=0;frame<30;frame++){
      target.weight=0;
      updateSceneAnimation(1/60);
      held.push(target.weight);
    }`);
  assert.ok(Array.from(f.run('held')).every(value => value === 1));
});
