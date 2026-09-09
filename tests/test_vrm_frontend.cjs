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
    setTimeout, clearTimeout, AbortController,
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

test('sending consecutive messages restarts speech after stopping the previous reply', async () => {
  const f=frontend(); const spoken=[];
  f.sandbox.window.speechSynthesis={cancel(){},speak(u){spoken.push(u.text);u.onstart();u.onend();}};
  f.sandbox.fetch=async()=>({ok:true,json:async()=>({reply:'新的回复',context:{},segments:[{text:'新的回复'}]})});
  f.run('handleAction=()=>{};');
  await f.run("sendMessage('你好')");
  await f.run("sendMessage('再说一次')");
  assert.deepEqual(spoken,['新的回复','新的回复']);
  assert.equal(f.run('playbackStopped || speaking || browserSpeaking'),false);
});

test('cancelled browser speech settles without callbacks and late events cannot stop a new reply', async () => {
  const f=frontend();const utterances=[];
  f.sandbox.window.speechSynthesis={cancel(){},speak(u){utterances.push(u);u.onstart();}};
  const old=f.run("playSegments([{text:'旧句'},{text:'不得播报'}])");
  f.run('stopCurrentSpeech();');
  const fresh=f.run("playSegments([{text:'新句'}])");
  utterances[0].onend();utterances[0].onstart();
  assert.equal(f.run('speaking && browserSpeaking'),true);
  utterances[1].onend();
  assert.equal((await old).played,0);
  assert.equal((await fresh).played,1);
  assert.deepEqual(utterances.map(u=>u.text),['旧句','新句']);
});

test('stale audio decoding cannot play or clear a replacement reply', async () => {
  const f=frontend();let release;const utterances=[];
  f.sandbox.decodePending=new Promise(resolve=>{release=resolve;});
  f.sandbox.window.speechSynthesis={cancel(){},speak(u){utterances.push(u);u.onstart();}};
  f.run("audioContext={state:'running',decodeAudioData(){return decodePending;}}; playAudioWithVisemes=()=>{throw Error('stale audio must not start');};");
  const old=f.run("playSegments([{audio:'AQ==',text:'旧音频'}])");
  await new Promise(resolve=>setImmediate(resolve));
  f.run('stopCurrentSpeech();');
  const fresh=f.run("playSegments([{text:'新回复'}])");
  release({});await old;
  assert.equal(f.run('speaking && browserSpeaking'),true);
  assert.deepEqual(utterances.map(u=>u.text),['新回复']);
  utterances[0].onend();await fresh;
});

test('stopped Web Audio settles and its late end event preserves newer visemes', async () => {
  const f=frontend();const sources=[];
  f.sandbox.makeSource=()=>{const s={connect(){},disconnect(){},start(){},stop(){}};sources.push(s);return s;};
  f.run("audioContext={currentTime:0,destination:{},createBufferSource:makeSource,createAnalyser(){return {connect(){},disconnect(){},frequencyBinCount:128};}};");
  const old=f.run('playAudioWithVisemes({},[])');
  f.run('stopCurrentSpeech();playbackStopped=false;');
  const fresh=f.run('playAudioWithVisemes({},[])');
  const current=f.run('currentVisemes');
  sources[0].onended();
  assert.equal(f.run('currentVisemes'),current);
  assert.equal(await old,false);
  sources[1].onended();assert.equal(await fresh,true);
  assert.equal(f.run('currentVisemes'),null);
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


test('each scene reply triggers a variant and honors reduced motion', () => {
  const f = frontend();
  f.run("currentVrm = {}; calls = []; playActionByName = name => calls.push(name); handleAction('booking'); handleAction('booking'); handleAction('confirm'); handleAction('booking');");
  assert.deepEqual(Array.from(f.run('calls')), ['booking','booking','confirm','booking']);
  f.run("motionReduced = true; handleAction('wink');");
  assert.equal(f.run('calls.length'), 4);
});

test('avatar settings fetch catalog and switch the selected model', async () => {
  const f=frontend();
  // Let the startup catalog fail before supplying the successful retry.
  await Promise.resolve(); await Promise.resolve();
  f.sandbox.fetch=async()=>({ok:true,json:async()=>[
    {id:'Lumine_companion',label:'默认',profile:'lumine'},
    {id:'Klee',label:'Klee',profile:'standard'}]});
  await f.run('loadAvatarCatalog()');
  assert.equal(f.elements.get('avatar-select').children.length,2);
  f.elements.get('avatar-select').value='Klee';
  f.run('loadVrm=(...args)=>switched=args');
  f.elements.get('switch-avatar-btn').handlers.click();
  assert.equal(f.run('switched[0]'),'/api/avatars/Klee');
  assert.equal(f.run('switched[3].profile'),'standard');
});

test('standard characters receive humanoid idle without Lumine raw bone tracks', async () => {
  const f=frontend();
  await Promise.resolve(); await Promise.resolve();
  f.sandbox.idleData=JSON.parse(fs.readFileSync(path.join(__dirname,'../models/animations/Lumine_idle.json')));
  f.run(`THREE.Quaternion=class {clone(){return this}};
    currentVrm={humanoid:{getNormalizedBoneNode(){return {quaternion:new THREE.Quaternion()}}}};
    modelLoadId=4;fetch=async()=>({ok:true,json:async()=>idleData});
    parser={getDependency(){throw Error('Must not bind Lumine raw bones')}};`);
  await f.run('loadDefaultIdle({parser},currentVrm,4,false)');
  assert.equal(f.run('idleAnimation.tracks.length'),16);
  assert.equal(f.run('idleAnimation.tracks.every(t=>!!t.bone)'),true);
});

test('original Lumine gets mouth and blink bindings once without overwriting existing presets', async () => {
  const f=frontend();
  f.run(`THREE.Quaternion=class {};
    VRMExpression=class {constructor(name){this.expressionName=name;this.binds=[]} addBind(b){this.binds.push(b)}};
    VRMExpressionMorphTargetBind=class {constructor(options){Object.assign(this,options)}};
    expressions={};face={morphTargetInfluences:Array(43).fill(0)};
    localVrm={scene:{traverse(){},add(){}},expressionManager:{getExpression(n){return expressions[n]},registerExpression(e){expressions[e.expressionName]=e}}};
    localGltf={parser:{json:{nodes:[{mesh:1}]},async getDependency(){return {traverse(fn){fn(face)}}}}};`);
  await f.run("adaptAvatar(localVrm,localGltf,'lumine')");
  assert.equal(f.run('expressions.aa.binds[0].index'),18);
  assert.equal(f.run('expressions.ee.binds[0].index'),22);
  assert.equal(f.run('expressions.blink.binds.length'),2);
  const first=f.run('expressions.aa');
  await f.run("adaptAvatar(localVrm,localGltf,'lumine')");
  assert.equal(f.run('expressions.aa'),first);
});

test('scene replies do not attach actions to the old avatar during switching', () => {
  const f=frontend();
  f.run("currentVrm={};avatarLoading=true;calls=0;playActionByName=()=>calls++;handleAction('greet');");
  assert.equal(f.run('calls'),0);
  f.run("avatarLoading=false;handleAction('greet');");
  assert.equal(f.run('calls'),1);
});

test('idle finger offsets stay bounded, do not accumulate and freeze to a relaxed pose', () => {
  const f=frontend();
  f.run(`class FingerQ { constructor(v=0){this.v=v} copy(q){this.v=q.v;return this} multiply(q){this.v+=q.v;return this} setFromAxisAngle(a,v){this.v=v;return this} }
    finger={quaternion:new FingerQ()};
    idleHands=[{node:finger,rest:new FingerQ(.2),axis:{},angle:.15,amplitude:.015,phase:.4,speed:.8,offset:new FingerQ()}];
    valuesSeen=[];
    for(let i=0;i<1800;i++){updateIdleHands(1/60);valuesSeen.push(finger.quaternion.v);}`);
  const values=Array.from(f.run('valuesSeen'));
  assert.ok(Math.min(...values)>=.335-1e-9 && Math.max(...values)<=.365+1e-9);
  f.run('motionReduced=true;frozenTime=handIdleTime;updateIdleHands(1);');
  assert.ok(Math.abs(f.run('finger.quaternion.v')-.35)<1e-9);
  assert.equal(f.run('handIdleTime'),f.run('frozenTime'));
  f.run('idleHands=[];updateIdleHands(.016);');
});

test('reference hand loop is bounded and has continuous position and velocity at every key', () => {
  const f=frontend(), sample=t=>f.run(`sampleHandIdle(${t})`);
  const period=f.run('HAND_IDLE_CYCLE'), count=f.run('HAND_IDLE_KEYS.length'), epsilon=1e-5;
  for(let i=0;i<=count;i++) {
    const t=i*period/count, at=sample(t);
    assert.ok(Math.abs(sample(t+period)-at)<1e-10);
    const before=(at-sample(t-epsilon))/epsilon, after=(sample(t+epsilon)-at)/epsilon;
    assert.ok(Math.abs(before-after)<.003, `velocity jump at key ${i}`);
  }
  for(let i=0;i<2000;i++) assert.ok(Math.abs(sample(i*period/2000))<=1+1e-10);
});

test('wrist motion preserves body idle and stays bounded over repeated frames', () => {
  const f=frontend();
  f.run(`class WristQ {constructor(v=0){this.v=v} multiply(q){this.v+=q.v;return this} setFromAxisAngle(a,v){this.v=v;return this}}
    wrist={quaternion:new WristQ()};
    idleHands=[{node:wrist,wrist:true,axis:{},swayAxis:{},angle:.05,amplitude:.03,phase:0,sway:.014,offset:new WristQ(),lateral:new WristQ()}];
    wristValues=[];
    for(let i=0;i<1800;i++){wrist.quaternion.v=.2;updateIdleHands(1/60);wristValues.push(wrist.quaternion.v);}`);
  assert.ok(Array.from(f.run('wristValues')).every(v=>v>=.206-1e-9 && v<=.294+1e-9));
  f.run('motionReduced=true;wrist.quaternion.v=.2;updateIdleHands(1);');
  assert.ok(Math.abs(f.run('wrist.quaternion.v')-.25)<1e-10);
});

test('scene animation samples overwrite idle fingers while its exit blends to relaxed fingers', () => {
  const f=frontend();
  f.run(`class Q {constructor(v=0){this.v=v}copy(q){this.v=q.v;return this} slerp(q,t){this.v+=(q.v-this.v)*t;return this}}
    fingerNode={quaternion:new Q(),position:{copy(){return this},lerp(){return this}}};
    currentVrm={expressionManager:{getValue(){return 0}}};
    mixer={update(){}};activeAction={};
    scenePlayback={elapsed:1,duration:3,name:'greet',expressions:[],secondary:[],
      bindings:[{target:fingerNode,proxy:{quaternion:new Q(.8)},property:'quaternion'}],
      bases:[{name:'leftIndexProximal',node:fingerNode,baseRotation:new Q(),basePosition:{copy(){}}}],
      from:new Map([['leftIndexProximal',{rotation:new Q(.15),position:{}}]])};
    fingerNode.quaternion.v=.15;updateSceneAnimation(.016);`);
  assert.equal(f.run('fingerNode.quaternion.v'),.8);
  f.run('scenePlayback.elapsed=2.85;fingerNode.quaternion.v=.15;updateSceneAnimation(0);');
  assert.ok(Math.abs(f.run('fingerNode.quaternion.v')-.475)<1e-8);
});

test('outdated avatar downloads are disposed and failed selection keeps the previous model', async () => {
  const f=frontend();
  f.run(`renderer={};currentVrm={id:'previous'};currentAvatarId='Klee';downloads=[];disposed=[];
    stopSceneAnimation=()=>{};VRMLoaderPlugin=class {};
    VRMUtils={deepDispose(s){disposed.push(s)}};
    GLTFLoader=class {register(){} load(...args){downloads.push(args)}};
    loadVrm('/api/avatars/Anaxa','Anaxa',()=>{},{profile:'standard',id:'Anaxa'});
    loadVrm('/api/avatars/Ratio','Ratio',()=>{},{profile:'standard',id:'Ratio'});`);
  await f.run("downloads[0][1]({scene:'old-download'})");
  assert.deepEqual(Array.from(f.run('disposed')),['old-download']);
  assert.equal(f.run('currentVrm.id'),'previous');
  f.run("downloads[1][3](Error('missing'))");
  assert.equal(f.run('currentVrm.id'),'previous');
  assert.equal(f.run('avatarLoading'),false);
  assert.equal(f.elements.get('avatar-select').value,'Klee');
});

test('random variants exclude the last played version and support a single asset', () => {
  const f = frontend();
  f.run("variants = [1,2,3].map(n => ({id:'explain_'+n})); Math.random = () => 0;");
  assert.equal(f.run("chooseVariant('explain',variants).id"), 'explain_1');
  f.run("lastVariant.set('explain','explain_1')");
  assert.equal(f.run("chooseVariant('explain',variants).id"), 'explain_2');
  f.run('Math.random = () => .999');
  assert.equal(f.run("chooseVariant('explain',variants).id"), 'explain_3');
  assert.equal(f.run("chooseVariant('explain',[variants[0]]).id"), 'explain_1');
  assert.throws(() => f.run("chooseVariant('explain',[])"));
});

test('repeated explain replies play both variants and stale loads do not change history', async () => {
  const f = frontend();
  f.run(`currentVrm = {}; played = []; Math.random = () => 0;
    catalogPromise = Promise.resolve({explain:[{id:'explain_1',secondary:false},{id:'explain_2',secondary:false}]});
    getSceneAnimation = async (name,id) => ({id});
    playVrmAnimation = animation => { played.push(animation.id); scenePlayback = {}; };`);
  for (let i=0;i<4;i++) await f.run("playActionByName('explain')");
  assert.deepEqual(Array.from(f.run('played')), ['explain_1','explain_2','explain_1','explain_2']);
  f.run('getSceneAnimation = () => new Promise(resolve => finishOld = resolve)');
  const stale = f.run("playActionByName('explain')");
  await Promise.resolve();
  f.run("modelLoadId++; lastVariant.clear(); finishOld({id:'explain_1'});");
  await stale;
  assert.equal(f.run('lastVariant.size'), 0);
  assert.equal(f.run('played.length'), 4);
});

test('catalog requests are shared, reject unknown variant paths and retry failures', async () => {
  const f = frontend();
  f.run("catalogData = Object.fromEntries(Object.keys(ACTION_LABELS).map(n => [n,[{id:n+'_1',secondary:false}]])); requests=0; fetch=async()=>{requests++; return {ok:true,json:async()=>catalogData};};");
  const a = f.run('getAnimationCatalog()'), b = f.run('getAnimationCatalog()');
  assert.equal(a,b);
  await a;
  assert.equal(f.run('requests'), 1);
  f.run("catalogPromise=null; catalogData.explain[0].id='../characters/avatar';");
  await assert.rejects(f.run('getAnimationCatalog()'));
  f.run("catalogData.explain[0].id='explain_2';");
  assert.equal((await f.run('getAnimationCatalog()')).explain[0].id, 'explain_2');
});

test('numbered body resources have independent caches', async () => {
  const f = frontend();
  f.run('loads=[]; createAnimationLoader=()=>({load(...a){loads.push(a);}});');
  const a=f.run("getSceneAnimation('explain','explain_1')");
  const b=f.run("getSceneAnimation('explain','explain_2')");
  assert.equal(f.run('loads[0][0]'), '/api/animations/explain/explain_1');
  assert.equal(f.run('loads[1][0]'), '/api/animations/explain/explain_2');
  f.run('loads.forEach(a=>a[1]({userData:{vrmAnimations:[{}]}}))');
  await Promise.all([a,b]);
  await assert.rejects(f.run("getSceneAnimation('explain','greet_1')"));
});

test('seven-second explain secondary tracks use their own timeline and return to neutral', () => {
  const f = frontend();
  f.sandbox.explainCloth = JSON.parse(fs.readFileSync(path.join(__dirname,'../models/animations/explain_2.secondary.json')));
  assert.equal(f.run('validateGreetSecondary(explainCloth).tracks.length'), 49);
  f.run(`defaultAvatar=true; sampleIndex=-1;
    q={clone(){return this},fromArray(a,i){sampleIndex=i;return this},slerp(){return this},multiply(){return this}};
    state={name:'explain',elapsed:7,secondary:[{values:explainCloth.tracks[0].values,fps:24,target:{quaternion:q},current:q,next:q}]};
    updateGreetSecondary(state);`);
  assert.equal(f.run('sampleIndex'),168*4);
});

test('late scene loads and previous-model loads cannot replace current actions', async () => {
  const f = frontend();
  f.run("currentVrm = {}; played = []; pending = {}; getSceneAnimation = name => new Promise(resolve => pending[name] = resolve); playVrmAnimation = (a,l,n) => played.push(n); THREE.LoopOnce = 1;");
  f.run("catalogPromise = Promise.resolve(Object.fromEntries(Object.keys(ACTION_LABELS).map(n => [n,[{id:n+'_1',secondary:false}]])));");
  const old = f.run("playActionByName('greet')");
  await Promise.resolve();
  const fresh = f.run("playActionByName('wink')");
  await Promise.resolve();
  f.run("pending.wink({}); pending.greet({});");
  await Promise.all([old,fresh]);
  assert.deepEqual(Array.from(f.run('played')), ['wink']);
  const changing = f.run("playActionByName('thanks')");
  await Promise.resolve();
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
  assert.deepEqual(Array.from(f.run("filteredSceneAnimation(sample,'thanks',model).expressionTracks.preset.keys()")),['blinkLeft']);
  assert.deepEqual(Array.from(f.run("filteredSceneAnimation(sample,'thanks',model).humanoidTracks.rotation.keys()")),['head','leftEye']);
  assert.equal(f.run("filteredSceneAnimation(sample,'greet',model).lookAtTrack"),null);
});

test('speech timeline keeps controlling articulation during every facial action', () => {
  for (const action of ['greet','explain','alert','booking','confirm','thanks','wink','preview']) {
    const f = frontend();
    const values = avatar(f);
    f.run(`activeAction={}; scenePlayback={name:'${action}',fullExpression:true,expressions:['blink']};
      updateSceneAnimation=()=>{};
      audioContext={currentTime:.1};
      currentVisemes={startTime:0,timeline:[{start:0,end:.2,viseme:'aa'},{start:.2,end:.4,viseme:'ou'}],lastIndex:-1,smoothOpen:0,
        samples:new Uint8Array(8),analyser:{getByteTimeDomainData(s){s.fill(170);}}};
      updateAvatar(.016);`);
    assert.ok(values.aa > 0, action);
    f.run('audioContext.currentTime=.25; updateAvatar(.016);');
    assert.ok(values.ou > 0, action);
    assert.ok(values.aa > 0, 'brief blend retains previous articulation');
    f.run('audioContext.currentTime=.5; updateAvatar(.016);');
    assert.ok(['aa','ih','ou','ee','oh'].every(v=>values[v]===0));
  }
});

test('browser fallback speaks during full facial actions and resets on error', async () => {
  const f=frontend(); const values=avatar(f); let utterance;
  f.sandbox.window.speechSynthesis={speak(u){utterance=u;u.onstart();}};
  f.run("activeAction={};scenePlayback={name:'explain',fullExpression:true,expressions:[]};updateSceneAnimation=()=>{};");
  const result=f.run("speakWithBrowser('测试')");
  f.run('updateAvatar(.016);');
  assert.ok(Object.values(values).some(v=>v>0));
  utterance.onerror();
  assert.equal(await result,false);
  assert.ok(['aa','ih','ou','ee','oh'].every(v=>values[v]===0));
  assert.ok(Object.values(f.run('mouthWeights')).every(v=>v===0));
});

test('smile mouth overrides are bypassed only during speech and restored on failure', () => {
  const f=frontend(); avatar(f);
  f.run(`smile={overrideMouth:'block'};relaxed={overrideMouth:'blend'};
    currentVrm.expressionManager.expressions=[smile,relaxed];
    observed=[];currentVrm.update=()=>observed.push([smile.overrideMouth,relaxed.overrideMouth]);
    browserSpeaking=true;updateVrmWithSpeechPriority(.016);`);
  assert.deepEqual(Array.from(f.run('observed[0]')),['none','none']);
  assert.equal(f.run('smile.overrideMouth'),'block');
  f.run('browserSpeaking=false;updateVrmWithSpeechPriority(.016);');
  assert.deepEqual(Array.from(f.run('observed[1]')),['block','blend']);
  f.run("browserSpeaking=true;currentVrm.update=()=>{throw Error('test');};");
  assert.throws(()=>f.run('updateVrmWithSpeechPriority(.016)'));
  assert.equal(f.run('relaxed.overrideMouth'),'blend');
});

test('mouth transitions are independent of frame rate and reset at silence', () => {
  const a=frontend(),b=frontend();avatar(a);avatar(b);
  a.run("for(let i=0;i<6;i++)blendSpeechMouth('aa',.7,1/60);");
  b.run("for(let i=0;i<3;i++)blendSpeechMouth('aa',.7,1/30);");
  assert.ok(Math.abs(a.run('mouthWeights.aa')-b.run('mouthWeights.aa'))<1e-8);
  a.run("blendSpeechMouth('ou',.7,1/60);");
  assert.ok(a.run('mouthWeights.ou>0 && mouthWeights.aa>0'));
  a.run('blendSpeechMouth(null,0,.016);');
  assert.ok(Object.values(a.run('mouthWeights')).every(v=>v===0));
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

test('greet keeps reference smile and blink while speech retains mouth ownership', () => {
  const f = frontend();
  f.run(`sample = {humanoidTracks:{rotation:new Map([['head',1],['rightEye',2]]),translation:new Map()},
    expressionTracks:{preset:new Map([['happy',1],['aa',2],['blink',3]]),custom:new Map()}};
    model = {expressionManager:{getExpression(){return true;}}};`);
  assert.equal(f.run("FULL_EXPRESSION_ACTIONS.has('greet')"), false);
  assert.deepEqual(Array.from(f.run("filteredSceneAnimation(sample,'greet',model).expressionTracks.preset.keys()")), ['happy','blink']);
  assert.deepEqual(Array.from(f.run("filteredSceneAnimation(sample,'greet',model).humanoidTracks.rotation.keys()")), ['head']);
});

test('secondary rotations match VRM0 humanoid handedness without mutating source data', () => {
  const f = frontend();
  f.run('sourceTwist=[.2,.3,.4,.5];');
  assert.deepEqual(Array.from(f.run("secondaryValuesForVrm(sourceTwist,{meta:{metaVersion:'0'}})")),[-.2,.3,-.4,.5]);
  assert.deepEqual(Array.from(f.run("secondaryValuesForVrm(sourceTwist,{meta:{metaVersion:'1'}})")),[.2,.3,.4,.5]);
  assert.deepEqual(Array.from(f.run('sourceTwist')),[.2,.3,.4,.5]);
  assert.equal(f.run("secondaryValuesForVrm(sourceTwist,{meta:{metaVersion:'1'}}) === sourceTwist"),false);
});

test('greet cloth assets reject malformed data and non-clothing targets', () => {
  const f = frontend();
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, '../models/animations/greet_1.secondary.json')));
  f.sandbox.clothData = data;
  assert.equal(f.run('validateGreetSecondary(clothData).tracks.length'), 38);
  assert.equal(data.tracks.filter(t => /Twist/.test(t.nodeName)).length, 16);
  for (const mutate of [d => d.fps=30, d => d.tracks[0].values[0]=.5,
    d => d.tracks[0].nodeName='15.joint_Head', d => d.tracks[0].nodeName='25.joint_RightHandTwistInjected', d => d.tracks.push(d.tracks[0]),
    d => d.tracks[0].values[40]=NaN]) {
    const bad = structuredClone(data); mutate(bad); f.sandbox.clothData = bad;
    assert.throws(() => f.run('validateGreetSecondary(clothData)'));
  }
});

test('cloth offsets do not accumulate and clear on cancel, other avatars, and reduced motion', () => {
  const f = frontend();
  f.run(`class Q {
    constructor(v=0){this.v=v;} clone(){return new Q(this.v);} copy(q){this.v=q.v;return this;}
    fromArray(a,i){this.v=a[i];return this;} slerp(q,t){this.v+=(q.v-this.v)*t;return this;}
    multiply(q){this.v+=q.v;return this;}
  }
  clothTarget={quaternion:new Q(.1)};
  values=Array.from({length:292},(_,i)=>i%4===0?.02:0);
  state={name:'greet',elapsed:1,secondary:[{target:clothTarget,values,current:new Q(),next:new Q()}]};
  defaultAvatar=true;
  for(let i=0;i<120;i++){clearGreetSecondary();updateGreetSecondary(state);}`);
  assert.ok(Math.abs(f.run('clothTarget.quaternion.v')-.12)<1e-9);
  f.run('stopSceneAnimation()');
  assert.equal(f.run('clothTarget.quaternion.v'), .1);
  for (const setup of ["defaultAvatar=false", "defaultAvatar=true;motionReduced=true", "motionReduced=false;state.secondary=[]"]) {
    f.run(`${setup};updateGreetSecondary(state)`);
    assert.equal(f.run('clothTarget.quaternion.v'), .1);
  }
});

test('optional cloth failures and stale avatar loads fall back to the body animation', async () => {
  const f = frontend();
  f.sandbox.AbortController = AbortController;
  f.sandbox.fetch = async () => { throw new Error('offline'); };
  assert.deepEqual(Array.from(await f.run('loadGreetSecondary({}, {}, 1)')), []);
  f.sandbox.fetch = async () => ({ok:true,json:async()=>({version:1,fps:24,duration:3,tracks:[]})});
  assert.deepEqual(Array.from(await f.run('loadGreetSecondary({}, {}, -1)')), []);
});

test('reference blink does not block live speech and automatic blinking resumes', () => {
  const f = frontend();
  f.run(`currentVrm={update(){}}; activeAction={}; browserSpeaking=true;
    autoBlinks=0; mouthValues={}; updateBlink=()=>autoBlinks++;
    updateIdle=()=>true; updateSceneAnimation=()=>{};
    setExpression=(name,value)=>mouthValues[name]=value;
    scenePlayback={name:'greet',fullExpression:false,expressions:['happy','blink']};
    updateAvatar(1/24);`);
  assert.equal(f.run('autoBlinks'),0);
  assert.ok(Object.values(f.run('mouthValues')).some(v=>v>0));
  f.run('scenePlayback=null;updateAvatar(1/24);');
  assert.equal(f.run('autoBlinks'),1);
});

test('rejected greet clips release the temporary smile expression', () => {
  const f = frontend();
  f.run(`cleanup=[]; currentVrm={expressionManager:{unregisterExpression(){cleanup.push('unregister');}}};
    createGreetSmile=()=>({binds:[{clearAppliedWeight(){cleanup.push('clear');}}],removeFromParent(){cleanup.push('remove');}});
    filteredSceneAnimation=()=>({});
    createVRMAnimationClip=()=>{throw new Error('Invalid clip');};`);
  assert.throws(()=>f.run("playVrmAnimation({},1,'greet')"),/Invalid clip/);
  assert.deepEqual(Array.from(f.run('cleanup')),['clear','unregister','remove']);
  assert.equal(f.run('scenePlayback'),null);
});
