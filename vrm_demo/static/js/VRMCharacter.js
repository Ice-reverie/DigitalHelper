import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { VRMLoaderPlugin, VRMUtils, VRMExpression, VRMExpressionMorphTargetBind } from '@pixiv/three-vrm';
import { createVRMAnimationClip, VRMAnimationLoaderPlugin } from '@pixiv/three-vrm-animation';


const elements = {
  stage: document.getElementById('stage'),
  avatarPlaceholder: document.getElementById('avatar-placeholder'),
  modelTitle: document.getElementById('model-status-title'),
  modelDetail: document.getElementById('model-status-detail'),
  systemState: document.getElementById('system-state-text'),
  fileInput: document.getElementById('vrm-file'),
  loadButton: document.getElementById('load-btn'),
  waveButton: document.getElementById('wave-btn'),
  animationButton: document.getElementById('anim-btn'),
  animationInput: document.getElementById('vrm-anim-file'),
  messages: document.getElementById('messages'),
  quickReplies: document.getElementById('quick-replies'),
  interactionStatus: document.getElementById('interaction-status'),
  textInput: document.getElementById('text-input'),
  sendButton: document.getElementById('send-btn'),
  voiceButton: document.getElementById('voice-btn'),
  voiceHint: document.getElementById('voice-hint'),
  fontSizeButton: document.getElementById('font-size-btn'),
};
const serviceButtons = [...document.querySelectorAll('[data-service]')];
const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)');

let motionReduced = false;
const recentMessages = new Map();
let renderer;
let scene;
let camera;
let clock;
let controls;
let currentVrm = null;
let avatarBounds = null;
let modelLoadId = 0;
let idleAnimation = null;
let defaultAvatar = false;
let avatarLoading = false;
let currentAvatarName = 'Lumine（默认适配版）';
let currentAvatarId = 'Lumine_companion';
let availableAvatars = [];
let avatarCatalogRequest = 0;
let avatarGltf = null;
const secondaryCache = new Map();
let greetApplied = [];
let gazeTarget = null;
const gazePointer = { x: 0, y: 0, smoothX: 0, smoothY: 0 };
const ACTION_LABELS = { greet:'问候', explain:'讲解', alert:'预警提醒', booking:'预约引导', confirm:'确认', thanks:'致谢', wink:'轻松互动' };
// These actions own blink/eye expressions, but speech always owns vowel shapes.
// Auto-blink and gaze pause during these actions; lip-sync keeps running.
// Greet owns its reference smile/blink; live speech still owns the mouth.
const FULL_EXPRESSION_ACTIONS = new Set(['explain', 'alert', 'booking', 'confirm', 'thanks', 'wink']);
const actionCache = new Map();
let catalogPromise = null;
const lastVariant = new Map();
let actionRequestId = 0;
let lastSceneAction = null;
let scenePlayback = null;
let animationRig = null;
let modelPose = [];
let idleHands = [];
let handIdleTime = 0;
let mixer = null;
let activeAction = null;
let waveState = null;
let conversationContext = {};
let conversationHistory = [];
const MAX_HISTORY = 10;

let audioContext = null;
let speaking = false;
let browserSpeaking = false;
let speechSourceRef = null;
let playbackStopped = false;
let speechGeneration = 0;
let cancelSpeechPlayback = null;
const VOWELS = ['aa', 'ih', 'ou', 'ee', 'oh'];
const mouthWeights = Object.fromEntries(VOWELS.map(name => [name, 0]));
const WAVE_DURATION = 2600;

let recognition = null;
let listening = false;
let currentVisemes = null;



initThree();
bindUI();
initSpeechRecognition();
checkService();
addMessage('您好，我是小安。点一下「开始说话」，告诉我哪里不舒服，或需要什么帮助。我会陪您一步步完成。', false);
renderQuickReplies();
if (renderer) loadVrm('/api/avatar', '小安的默认形象');
loadAvatarCatalog();

function initThree() {
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  } catch (error) {
    console.warn('WebGL 初始化失败，继续使用无模型交互模式。', error);
    setModelStatus('无模型交互模式', '当前设备无法启用 3D 渲染，语音和服务流程仍可使用');
    return;
  }

  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x000000, 0);
  elements.stage.appendChild(renderer.domElement);

  scene = new THREE.Scene();
  gazeTarget = new THREE.Object3D();
  scene.add(gazeTarget);
  window.addEventListener('pointermove', (event) => {
    setGazePointer(event.clientX, event.clientY, window.innerWidth, window.innerHeight);
  });
  const resetGaze = () => { gazePointer.x = 0; gazePointer.y = 0; };
  document.documentElement.addEventListener('pointerleave', resetGaze);
  window.addEventListener('blur', resetGaze);
  window.addEventListener('pointerup', (event) => { if (event.pointerType === 'touch') resetGaze(); });

  camera = new THREE.PerspectiveCamera(30, 1, 0.1, 20);
  camera.position.set(0, 1.35, 1.7);
  camera.lookAt(0, 1.2, 0);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 1.2, 0);
  controls.enableDamping = true;
  // OrbitControls maps Shift + left drag to pan and plain left drag to rotate.
  controls.enablePan = true;
  controls.screenSpacePanning = true;
  controls.enableZoom = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 0.5;
  controls.maxDistance = 5;
  controls.update();

  // Bright, neutral fill keeps the face readable while the offset key adds shape.
  scene.add(new THREE.AmbientLight(0xffffff, 1.0));
  const keyLight = new THREE.DirectionalLight(0xfffaf5, 1.4);
  keyLight.position.set(-1.8, 2.3, 2.4);
  keyLight.target.position.set(0, 1.05, 0);
  scene.add(keyLight.target);
  scene.add(keyLight);
  const fillLight = new THREE.DirectionalLight(0xf4f7ff, 0.5);
  fillLight.position.set(2, 1.4, 1.6);
  scene.add(fillLight);
  const rimLight = new THREE.DirectionalLight(0xc5d8ff, 0.3);
  rimLight.position.set(0.8, 1.8, -2);
  scene.add(rimLight);

  clock = new THREE.Clock();
  const resizeObserver = new ResizeObserver(resizeStage);
  resizeObserver.observe(elements.stage);
  resizeStage();

  renderer.setAnimationLoop(() => {
    const delta = Math.min(clock.getDelta(), 0.05);
    controls.update();
    updateAvatar(delta);
    renderer.render(scene, camera);
  });
}

function resizeStage() {
  if (!renderer || !camera) return;
  const width = Math.max(elements.stage.clientWidth, 1);
  const height = Math.max(elements.stage.clientHeight, 1);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height, false);
  fitAvatar();
}

function fitAvatar() {
  if (!avatarBounds || !camera || !controls) return;
  const size = avatarBounds.getSize(new THREE.Vector3());
  const center = avatarBounds.getCenter(new THREE.Vector3());
  const verticalFov = THREE.MathUtils.degToRad(camera.fov);
  const verticalDistance = size.y / (2 * Math.tan(verticalFov / 2));
  const horizontalDistance = size.x / (2 * Math.tan(verticalFov / 2) * camera.aspect);
  const distance = Math.max(verticalDistance, horizontalDistance) * 1.035 + size.z / 2;
  controls.target.copy(center);
  camera.position.set(center.x, center.y, center.z + distance);
  camera.near = Math.max(0.01, distance / 100);
  camera.far = Math.max(20, distance * 10);
  camera.updateProjectionMatrix();
  // Full-body framing is the reset view, not the closest allowed zoom.
  controls.minDistance = Math.max(size.z / 2 + 0.1, size.y * 0.6);
  controls.maxDistance = distance * 1.7;
  controls.update();
}

function bindUI() {
  document.getElementById('switch-avatar-btn').addEventListener('click', () => {
    const selected = availableAvatars.find(avatar => avatar.id === document.getElementById('avatar-select').value);
    if (selected) loadVrm(`/api/avatars/${encodeURIComponent(selected.id)}`, selected.label, () => {}, selected);
    else loadAvatarCatalog();
  });
  const motionButton = document.getElementById('motion-btn');
  const applyMotion = () => {
    document.documentElement.classList.toggle('motion-reduced', motionReduced);
    if (motionReduced) { actionRequestId += 1; stopSceneAnimation(); }
    motionButton.setAttribute('aria-pressed', String(motionReduced));
    motionButton.textContent = motionReduced ? '动态已减少' : '减少动态';
  };
  motionButton.addEventListener('click', () => { motionReduced = !motionReduced; applyMotion(); });
  reducedMotion?.addEventListener('change', (event) => { motionReduced = event.matches; applyMotion(); });
  applyMotion();
  for (const name of ['history', 'help']) {
    const panel = document.getElementById(name + '-dialog');
    const trigger = document.getElementById(name + '-btn');
    trigger.addEventListener('click', () => {
      panel.showModal();
      if (name === 'help') loadAvatarCatalog();
    });
    document.getElementById('close-' + name + '-btn').addEventListener('click', () => panel.close());
    panel.addEventListener('close', () => trigger.focus());
  }
  if (typeof ResizeObserver !== 'undefined') {
    const dock = document.querySelector('.interaction-dock');
    new ResizeObserver(() => {
      document.documentElement.style.setProperty('--dock-height', dock.getBoundingClientRect().height + 'px');
    }).observe(dock);
  }
  elements.loadButton.addEventListener('click', () => elements.fileInput.click());
  elements.fileInput.addEventListener('change', (event) => {
    const [file] = event.target.files;
    if (file) loadVrmFromFile(file);
  });

  elements.waveButton.addEventListener('click', () => {
    if (!currentVrm) {
      setModelStatus('动作“挥手”已识别', '载入 3D 模型后即可看到动作效果');
      return;
    }
    startWave();
  });

  elements.animationButton.addEventListener('click', () => elements.animationInput.click());
  elements.animationInput.addEventListener('change', (event) => {
    const [file] = event.target.files;
    if (file) loadVrmAnimation(file);
  });

  elements.sendButton.addEventListener('click', () => sendMessage());
  elements.textInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.isComposing) sendMessage();
  });
  elements.voiceButton.addEventListener('click', toggleListening);
  serviceButtons.forEach((button) => {
    button.addEventListener('click', () => {
      sendMessage(button.dataset.service, true);
      elements.voiceButton.scrollIntoView({ block: 'nearest', behavior: 'auto' });
    });
  });
  elements.fontSizeButton.addEventListener('click', () => {
    const large = document.documentElement.classList.toggle('large-text');
    elements.fontSizeButton.setAttribute('aria-pressed', String(large));
    elements.fontSizeButton.textContent = large ? '恢复字号' : '放大文字';
  });
  document.getElementById('reset-view-btn').addEventListener('click', fitAvatar);

}

async function checkService() {
  try {
    const response = await fetch('/api/health');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    elements.systemState.textContent = '已连接，可以对话';
  } catch (error) {
    elements.systemState.textContent = '服务连接异常';
  }
}

function initSpeechRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    elements.voiceButton.disabled = true;
    elements.voiceButton.textContent = '请使用下方文字输入';
    elements.voiceHint.textContent = '当前浏览器不支持语音，也可以点选常用服务。';
    setInteractionStatus('您仍可在下方输入文字继续使用。', 'warning');
    return;
  }

  recognition = new SpeechRecognition();
  recognition.lang = 'zh-CN';
  recognition.interimResults = true;
  recognition.continuous = false;

  recognition.onstart = () => setListening(true);
  recognition.onresult = (event) => {
    let transcript = '';
    let hasFinalResult = false;
    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      transcript += event.results[index][0].transcript;
      hasFinalResult = hasFinalResult || event.results[index].isFinal;
    }
    elements.textInput.value = transcript.trim();
    setInteractionStatus(hasFinalResult ? '已经听清，正在处理。' : `正在聆听：${transcript}`, 'listening');
    if (hasFinalResult && transcript.trim()) {
      stopCurrentSpeech();
      sendMessage(transcript.trim());
    }
  };
  recognition.onerror = (event) => {
    const messages = {
      'not-allowed': '麦克风权限未开启，请允许访问或使用文字输入。',
      'no-speech': '没有听到声音，请靠近麦克风再试一次。',
      network: '语音识别服务暂时不可用，请使用文字输入。',
    };
    setInteractionStatus(messages[event.error] || '没有识别成功，请再试一次或使用文字输入。', 'warning');
  };
  recognition.onend = () => setListening(false);
}

function toggleListening() {
  if (!recognition) return;
  try {
    if (listening) recognition.stop();
    else {
      stopCurrentSpeech();
      recognition.start();
    }
  } catch (error) {
    setInteractionStatus('语音功能正在准备，请稍后再试。', 'warning');
  }
}

function setListening(value) {
  listening = value;
  elements.voiceButton.classList.toggle('listening', value);
  elements.voiceButton.setAttribute('aria-pressed', String(value));
  elements.voiceButton.textContent = value ? '说完了，发送' : '开始说话';
  elements.voiceHint.textContent = value ? '正在听，正常说话就好。说完可再点一下。' : '点一下就能说，不用一直按住。';
  if (value) setInteractionStatus('正在聆听，请说出您的需要……', 'listening');
  else if (!elements.sendButton.disabled && elements.interactionStatus.className === 'listening') {
    setInteractionStatus('没有听清，您可以再说一次，也可以打字。');
  }
}

function setInteractionStatus(text, className = '') {
  elements.interactionStatus.textContent = text;
  elements.interactionStatus.className = className;
}

function addMessage(text, isUser, note = '') {
  const createMessage = () => {
    const message = document.createElement('div');
    message.className = `msg ${isUser ? 'user' : 'ai'}`;
    message.tabIndex = 0;
    const label = document.createElement('span');
    label.className = 'speaker-label';
    label.textContent = isUser ? '您' : '小安';
    const content = document.createElement('div');
    content.textContent = text;
    message.appendChild(label);
    message.appendChild(content);
    if (note) {
      const detail = document.createElement('span');
      detail.className = 'msg-note';
      detail.textContent = note;
      message.appendChild(detail);
    }
    return message;
  };
  document.getElementById('history-messages').appendChild(createMessage());
  const previous = recentMessages.get(isUser);
  if (previous) previous.remove();
  const message = createMessage();
  recentMessages.set(isUser, message);
  elements.messages.appendChild(message);
}

function renderQuickReplies(replies = []) {
  elements.quickReplies.replaceChildren();
  replies.forEach((reply) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'quick-btn';
    button.disabled = elements.sendButton.disabled;
    button.textContent = reply;
    button.addEventListener('click', () => sendMessage(reply));
    elements.quickReplies.appendChild(button);
  });
}

async function sendMessage(providedText = '', startNewService = false) {
  const text = (providedText || elements.textInput.value).trim();
  if (!text || elements.sendButton.disabled) return;

  stopCurrentSpeech();

  conversationHistory.push({ role: 'user', content: text });
  if (conversationHistory.length > MAX_HISTORY) conversationHistory.shift();

  addMessage(text, true);
  elements.textInput.value = '';
  elements.sendButton.disabled = true;
  elements.voiceButton.disabled = true;
  serviceButtons.forEach((button) => { button.disabled = true; });
  renderQuickReplies();
  setInteractionStatus('正在为您处理，请稍候……');
  initAudioContext().catch((error) => console.warn('音频初始化失败，将尝试浏览器播报。', error));

  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, context: startNewService ? {} : conversationContext, history: conversationHistory }),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data = await response.json();
    conversationContext = data.context || {};
    const replyText = data.reply || '';
    conversationHistory.push({ role: 'assistant', content: replyText });
    if (conversationHistory.length > MAX_HISTORY) conversationHistory.shift();
    const note = data.tts_available ? '' : '当前使用浏览器语音播报';
    addMessage(replyText, false, note);
    renderQuickReplies(data.quick_replies || []);
    handleAction(data.action);

    setInteractionStatus('正在为您朗读，请稍候……');
    const playback = await playSegments(data.segments?.length ? data.segments : [{ text: replyText }]);
    setInteractionStatus(
      playback.failed ? '部分语音暂时无法播放，请查看下方文字回复。'
        : data.context?.flow ? '请按下方提示，选择下一步。' : '已为您回复，还需要什么帮助？',
      playback.failed ? 'warning' : '',
    );
  } catch (error) {
    console.error('请求失败：', error);
    if (conversationHistory.length && conversationHistory[conversationHistory.length - 1].role === 'user') conversationHistory.pop();
    addMessage('抱歉，服务暂时没有响应。请确认后端已经启动，再试一次。', false);
    renderQuickReplies(['重新尝试']);
    setInteractionStatus('服务连接失败，文字内容未提交。', 'warning');
  } finally {
    elements.sendButton.disabled = false;
    elements.voiceButton.disabled = !recognition;
    serviceButtons.forEach((button) => { button.disabled = false; });
    elements.quickReplies.querySelectorAll('button').forEach((button) => { button.disabled = false; });
  }
}

function handleAction(actionName) {
  const name = Object.hasOwn(ACTION_LABELS, actionName) ? actionName : null;

  lastSceneAction = name;
  actionRequestId += 1;
  if (!name || motionReduced) return;
  if (!currentVrm || avatarLoading) return;
  playActionByName(name);
}

function setModelStatus(title, detail) {
  elements.modelTitle.textContent = title;
  elements.modelDetail.textContent = detail;
}

function loadVrmFromFile(file) {
  const url = URL.createObjectURL(file);
  loadVrm(url, file.name, () => URL.revokeObjectURL(url));
}

async function loadAvatarCatalog() {
  const request = ++avatarCatalogRequest;
  const select = document.getElementById('avatar-select');
  const button = document.getElementById('switch-avatar-btn');
  const status = document.getElementById('avatar-catalog-status');
  try {
    const response = await fetch('/api/avatars', {cache:'no-store'});
    if (!response.ok) throw new Error('Avatar catalog unavailable');
    const data = await response.json();
    if (request !== avatarCatalogRequest) return;
    if (!Array.isArray(data) || data.some(v => !v || typeof v.id !== 'string' || !v.id || /[/\\\u0000-\u001f]/.test(v.id) || ['.','..'].includes(v.id) || typeof v.label !== 'string' || !['lumine','standard'].includes(v.profile))) throw new Error('Invalid avatar catalog');
    const selectedId = select.value;
    availableAvatars = data;
    select.replaceChildren();
    for (const avatar of data) {
      const option = document.createElement('option');
      option.value = avatar.id;
      option.textContent = avatar.label;
      select.appendChild(option);
    }
    select.value = data.some(v => v.id === selectedId) ? selectedId : data.some(v => v.id === currentAvatarId) ? currentAvatarId : data[0]?.id || '';
    select.disabled = !data.length;
    button.disabled = !data.length;
    button.textContent = '切换形象';
    status.textContent = data.length ? `可选择 ${data.length} 个形象，切换后自动恢复全身视角。` : '暂未找到人物模型，当前形象仍可使用。';
  } catch {
    if (request !== avatarCatalogRequest) return;
    button.disabled = false;
    button.textContent = '重试人物列表';
    status.textContent = '人物列表暂不可用，当前形象仍可使用，也可以载入本地文件。';
  }
}

async function adaptAvatar(vrm, gltf, profile) {
  if (profile !== 'lumine') return;
  tuneCompanionFace(vrm);
  // Original Lumine has morphs but no VRM expression bindings. Bind its face
  // primitives using their actual source mesh, without altering the VRM file.
  const faces = [];
  for (const [index, node] of gltf.parser.json.nodes.entries()) {
    if (node.mesh !== 1) continue;
    const object = await gltf.parser.getDependency('node', index);
    object.traverse(mesh => { if (mesh.morphTargetInfluences?.length >= 43) faces.push(mesh); });
  }
  const bindings = {blink:[[0,1],[1,1]],blinkLeft:[[0,1]],blinkRight:[[1,1]],
    aa:[[18,1]],ih:[[19,1]],ou:[[20,1]],ee:[[22,1]],oh:[[21,1]],happy:[[32,.5],[37,.2]]};
  for (const [name, shapes] of Object.entries(bindings)) {
    if (vrm.expressionManager.getExpression(name)?.binds.length || !faces.length) continue;
    const previous = vrm.expressionManager.getExpression(name);
    if (previous) { vrm.expressionManager.unregisterExpression(previous); previous.removeFromParent(); }
    const expression = new VRMExpression(name);
    for (const [index, weight] of shapes) expression.addBind(new VRMExpressionMorphTargetBind({primitives:faces,index,weight}));
    vrm.expressionManager.registerExpression(expression);
    vrm.scene.add(expression);
  }
}

function loadVrm(url, name, release = () => {}, avatar = null) {
  if (!renderer) {
    release();
    setModelStatus('无法加载 3D 模型', '当前设备未启用 WebGL，其他功能仍可使用');
    return;
  }
  const loadId = ++modelLoadId;
  avatarLoading = true;
  const profile = avatar?.profile || (url === '/api/avatar' ? 'lumine' : 'standard');
  secondaryCache.clear();
  lastVariant.clear();
  actionRequestId += 1;
  lastSceneAction = null;
  stopSceneAnimation();
  setModelStatus('正在加载 3D 模型…', name);
  const loader = new GLTFLoader();
  loader.register((parser) => new VRMLoaderPlugin(parser));
  loader.load(
    url,
    async (gltf) => {
      release();
      if (loadId !== modelLoadId) { VRMUtils.deepDispose(gltf.scene); return; }
      const vrm = gltf.userData.vrm;
      if (!vrm) {
        avatarLoading = false;
        VRMUtils.deepDispose(gltf.scene);
        setModelStatus('模型加载失败', '请选择有效的 .vrm 模型');
        return;
      }
      try {
      VRMUtils.removeUnnecessaryJoints(gltf.scene);
      VRMUtils.rotateVRM0(vrm);
      await adaptAvatar(vrm, gltf, profile);
      if (loadId !== modelLoadId) { VRMUtils.deepDispose(gltf.scene); return; }
      const leftArm = vrm.humanoid.getNormalizedBoneNode('leftUpperArm');
      const rightArm = vrm.humanoid.getNormalizedBoneNode('rightUpperArm');
      if (leftArm) leftArm.rotation.z = 1.15;
      if (rightArm) rightArm.rotation.z = -1.15;
      const preparedPose = Object.keys(vrm.humanoid.normalizedHumanBones).map((name) => {
        const node = vrm.humanoid.getNormalizedBoneNode(name);
        return { name, node, rotation:node.quaternion.clone(), position:node.position.clone() };
      });
      vrm.update(0);
      vrm.scene.updateMatrixWorld(true);
      vrm.scene.traverse((object) => { if (object.isSkinnedMesh) object.skeleton.update(); });
      const preparedBounds = new THREE.Box3().setFromObject(vrm.scene, true);
      const preparedHands = prepareIdleHands(vrm);
      stopSceneAnimation();
      if (currentVrm) { scene.remove(currentVrm.scene); VRMUtils.deepDispose(currentVrm.scene); }
      currentVrm = vrm;
      currentAvatarName = name;
      currentAvatarId = avatar?.id || (url === '/api/avatar' ? 'Lumine_companion' : '');
      document.getElementById('avatar-select').value = currentAvatarId;
      avatarLoading = false;
      resetSpeechMouth();
      defaultAvatar = profile === 'lumine';
      avatarGltf = gltf;
      idleAnimation = null;
      mixer = null;
      activeAction = null;
      scene.add(vrm.scene);
      waveState = null;
      modelPose = preparedPose;
      idleHands = preparedHands;
      handIdleTime = 0;
      avatarBounds = preparedBounds;
      fitAvatar();
      if (vrm.lookAt) vrm.lookAt.target = gazeTarget;
      nextBlinkAt = performance.now() + 2200;
      blinking = false;
      loadDefaultIdle(gltf, vrm, loadId, defaultAvatar);
      getAnimationCatalog().then(catalog => {
        for (const [name, variants] of Object.entries(catalog)) {
          for (const variant of variants) getSceneAnimation(name, variant.id).catch(() => {});
        }
      }).catch(() => {});
      elements.avatarPlaceholder.hidden = true;
      setModelStatus(`${name} 已加载`, '全身视角、语音口型和标准骨骼动作已就绪');
      document.getElementById('reset-view-btn').hidden = false;
      } catch (error) {
        if (currentVrm !== vrm) VRMUtils.deepDispose(gltf.scene);
        if (loadId !== modelLoadId) return;
        avatarLoading = false;
        document.getElementById('avatar-select').value = currentAvatarId;
        setModelStatus('形象适配失败', '请重新选择形象或载入有效的 VRM 文件');
        console.error('形象适配失败', error);
      }
    },
    (progress) => {
      if (loadId !== modelLoadId) return;
      if (progress.lengthComputable) {
        setModelStatus(`正在加载 3D 模型 ${Math.round((progress.loaded / progress.total) * 100)}%`, name);
      }
    },
    (error) => {
      release();
      if (loadId !== modelLoadId) return;
      avatarLoading = false;
      document.getElementById('avatar-select').value = currentAvatarId;
      console.error('VRM 加载失败：', error);
      setModelStatus('模型加载失败', '请确认所选文件是有效的 .vrm 模型');
    },
  );
}

function tuneCompanionFace(vrm) {
  const seen = new Set();
  vrm.scene.traverse((object) => {
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      if (!material || seen.has(material)) continue;
      seen.add(material);
      // Only the default character's skin material; preserve eyes, mouth interior and clothing.
      if (material.name === '2._ko' && material.shadeColorFactor) {
        material.shadeColorFactor.setRGB(0.98, 0.94, 0.92);
        material.shadingToonyFactor = 0.55;
        material.shadingShiftFactor = 0;
      }
    }
  });
}

function setGazePointer(x, y, width, height) {
  gazePointer.x = Math.max(-1, Math.min(1, 2 * x / Math.max(width, 1) - 1));
  gazePointer.y = Math.max(-1, Math.min(1, 2 * y / Math.max(height, 1) - 1));
}

function updateGaze(delta) {
  if (!gazeTarget || !camera) return;
  const alpha = 1 - Math.exp(-8 * delta);
  gazePointer.smoothX += ((motionReduced ? 0 : gazePointer.x) - gazePointer.smoothX) * alpha;
  gazePointer.smoothY += ((motionReduced ? 0 : gazePointer.y) - gazePointer.smoothY) * alpha;
  gazeTarget.position.set(gazePointer.smoothX * 1.6, -gazePointer.smoothY * 1.0, 0);
  gazeTarget.position.applyQuaternion(camera.quaternion).add(camera.position);
}

function idleSample(time, duration, fps) {
  const frame = ((time % duration) + duration) % duration * fps;
  return { index: Math.floor(frame), fraction: frame - Math.floor(frame) };
}

async function loadDefaultIdle(gltf, vrm, loadId, includeSecondary = defaultAvatar) {
  try {
    const response = await fetch('/api/animations/idle');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    if (data.version !== 1 || !Number.isFinite(data.duration) || data.duration <= 0 || !Number.isFinite(data.fps) || data.fps <= 0) throw new Error('Invalid idle format');
    const tracks = await Promise.all(data.tracks.filter(track => track.bone || includeSecondary).map(async (track) => {
      const node = track.bone ? vrm.humanoid.getNormalizedBoneNode(track.bone) : await gltf.parser.getDependency('node', track.node);
      if (!node || track.values.length !== (Math.round(data.duration * data.fps) + 1) * 4 || !track.values.every(Number.isFinite)) throw new Error('Invalid idle track');
      return { ...track, target:node, rest:node.quaternion.clone(), current:new THREE.Quaternion(), next:new THREE.Quaternion() };
    }));
    if (loadId !== modelLoadId || vrm !== currentVrm) return;
    idleAnimation = { ...data, tracks, time:0 };
    setModelStatus(`${currentAvatarName} 已就绪`, includeSecondary ? '自然待机、头发衣服轻摆、口型、眨眼和视线跟随已适配' : '自然待机、口型、眨眼和视线跟随已适配；保留人物自带物理摆动');
  } catch (error) {
    if (loadId !== modelLoadId) return;
    console.warn('默认待机加载失败', error);
    setModelStatus('模型已加载', '待机动作暂不可用，仍可正常对话');
  }
}

function updateIdle(delta) {
  if (!idleAnimation) return false;
  if (!motionReduced) idleAnimation.time += delta;
  const { index, fraction } = idleSample(idleAnimation.time, idleAnimation.duration, idleAnimation.fps);
  for (const track of idleAnimation.tracks) {
    track.current.fromArray(track.values, index * 4);
    track.next.fromArray(track.values, (index + 1) * 4);
    track.current.slerp(track.next, fraction);
    if (track.bone) track.target.quaternion.copy(track.current);
    else track.target.quaternion.copy(track.rest).multiply(track.current);
  }
  return true;
}

// Hand-authored from 52 paired hand crops (30 fps, every fifth frame).
// One ~2.9 s cycle: soften/extend, settle, then return. These are visual
// estimates, not reconstructed 3D joint measurements. Periodic cubic sampling
// preserves velocity across keys and the loop seam.
const HAND_IDLE_CYCLE = 2.9;
const HAND_IDLE_KEYS = [1,.94,.78,.53,.24,-.09,-.43,-.72,-.93,-1,-.93,-.75,-.49,-.16,.2,.54,.81,.94];
function sampleHandIdle(time) {
  const position = ((time % HAND_IDLE_CYCLE + HAND_IDLE_CYCLE) % HAND_IDLE_CYCLE) / HAND_IDLE_CYCLE * HAND_IDLE_KEYS.length;
  const i = Math.floor(position), t = position-i;
  const key = n => HAND_IDLE_KEYS[(n+HAND_IDLE_KEYS.length)%HAND_IDLE_KEYS.length];
  const a=key(i-1), b=key(i), c=key(i+1), d=key(i+2);
  return .5*((2*b)+(-a+c)*t+(2*a-5*b+4*c-d)*t*t+(-a+3*b-3*c+d)*t*t*t);
}

function prepareIdleHands(vrm) {
  const tracks = [];
  const bone = name => vrm.humanoid.getNormalizedBoneNode(name);
  const world = node => node.getWorldPosition(new THREE.Vector3());
  for (const [side, sign, phase] of [['left',1,0],['right',-1,.12]]) {
    const wrist = bone(side+'Hand');
    const index = bone(side+'IndexProximal');
    const little = bone(side+'LittleProximal');
    if (!wrist || !index || !little) continue;
    // Derive the palm-facing direction from this character's own hand geometry,
    // rather than assuming a local rotation axis shared by all exported rigs.
    const origin = world(wrist);
    // Index × little points toward the back of the left palm; reverse that
    // normal (and mirror for the right hand) to curl toward the palm.
    const normal = world(index).sub(origin).cross(world(little).sub(origin)).multiplyScalar(-sign);
    if (normal.lengthSq() < 1e-12) continue;
    normal.normalize();
    const inverseWrist = wrist.getWorldQuaternion(new THREE.Quaternion()).invert();
    const wristAxis = world(index).add(world(little)).multiplyScalar(.5).sub(origin).cross(normal).normalize().applyQuaternion(inverseWrist);
    tracks.push({node:wrist, wrist:true, axis:wristAxis,
      swayAxis:normal.clone().applyQuaternion(inverseWrist),
      angle:3*Math.PI/180, amplitude:1.8*Math.PI/180, phase,
      sway:sign*.8*Math.PI/180, offset:new THREE.Quaternion(), lateral:new THREE.Quaternion()});
    for (const [finger, angles, fingerPhase] of [
      ['Index',[13,25,14],0], ['Middle',[16,30,17],.025],
      ['Ring',[19,34,19],.05], ['Little',[22,37,21],.075],
      ['Thumb',[7,10],.1],
    ]) {
      const joints = finger === 'Thumb' ? ['Proximal','Distal'] : ['Proximal','Intermediate','Distal'];
      for (let i=0;i<joints.length;i++) {
        const node = bone(side+finger+joints[i]);
        if (!node) continue;
        const next = i+1<joints.length ? bone(side+finger+joints[i+1]) : null;
        const previous = i>0 ? bone(side+finger+joints[i-1]) : wrist;
        if (!next && !previous) continue;
        const direction = next ? world(next).sub(world(node)) : world(node).sub(world(previous));
        const axis = direction.cross(normal);
        if (axis.lengthSq()<1e-12) continue;
        axis.normalize().applyQuaternion(node.getWorldQuaternion(new THREE.Quaternion()).invert());
        tracks.push({node, rest:node.quaternion.clone(), axis,
          angle:angles[i]*Math.PI/180, amplitude:(finger==='Thumb'?.3:.65)*Math.PI/180,
          phase:phase+fingerPhase, offset:new THREE.Quaternion()});
      }
    }
  }
  return tracks;
}

function updateIdleHands(delta) {
  if (!motionReduced) handIdleTime += Math.max(0,delta);
  for (const track of idleHands) {
    const movement = motionReduced ? 0 : track.amplitude*sampleHandIdle(handIdleTime+track.phase);
    track.offset.setFromAxisAngle(track.axis,track.angle+movement);
    if (track.wrist) {
      // Body idle was freshly sampled this frame. Preserve its wrist rotation;
      // the scenario mixer runs afterwards and owns the final action pose.
      track.lateral.setFromAxisAngle(track.swayAxis,motionReduced ? 0 : track.sway*sampleHandIdle(handIdleTime+track.phase-.22));
      track.node.quaternion.multiply(track.offset).multiply(track.lateral);
      continue;
    }
    // Absolute rest + offset each frame: never accumulate finger rotations.
    track.node.quaternion.copy(track.rest).multiply(track.offset);
  }
}

function loadVrmAnimation(file) {
  if (!currentVrm) return;
  const vrm = currentVrm;
  const id = ++actionRequestId;
  const modelId = modelLoadId;
  const url = URL.createObjectURL(file);
  createAnimationLoader().load(url, (gltf) => {
    URL.revokeObjectURL(url);
    if (id !== actionRequestId || modelId !== modelLoadId || vrm !== currentVrm) return;
    try {
      if (!gltf.userData.vrmAnimations?.length) throw new Error('Empty animation');
      playVrmAnimation(gltf.userData.vrmAnimations[0], THREE.LoopOnce, 'preview');
    } catch (error) { setModelStatus('动作无法播放', '请检查动作文件'); }
  }, undefined, () => { URL.revokeObjectURL(url); });
}

function getAnimationCatalog() {
  if (!catalogPromise) {
    const pending = (async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      try {
        const response = await fetch('/api/animations', {signal:controller.signal});
        if (!response.ok) throw new Error('Animation catalog unavailable');
        const data = await response.json();
        const catalog = {};
        for (const name of Object.keys(ACTION_LABELS)) {
          if (!Array.isArray(data[name])) throw new Error('Invalid animation catalog');
          const ids = new Set();
          catalog[name] = data[name].map(variant => {
            if (!new RegExp(`^${name}_[1-9][0-9]*$`).test(variant?.id) || ids.has(variant.id) || typeof variant.secondary !== 'boolean') throw new Error('Invalid variant');
            ids.add(variant.id);
            return {id:variant.id, secondary:variant.secondary};
          });
        }
        return catalog;
      } finally { clearTimeout(timer); }
    })();
    catalogPromise = pending;
    pending.catch(() => { if (catalogPromise === pending) catalogPromise = null; });
  }
  return catalogPromise;
}

function chooseVariant(name, variants) {
  if (!variants.length) throw new Error('No available animation');
  const candidates = variants.length > 1 ? variants.filter(v => v.id !== lastVariant.get(name)) : variants;
  return candidates[Math.floor(Math.random() * candidates.length)];
}

function getSceneAnimation(name, variant = `${name}_1`) {
  if (!Object.hasOwn(ACTION_LABELS, name) || !new RegExp(`^${name}_[1-9][0-9]*$`).test(variant)) return Promise.reject(new Error('Unknown action'));
  if (!actionCache.has(variant)) {
    const pending = new Promise((resolve, reject) => {
      createAnimationLoader().load(`/api/animations/${name}/${variant}`, gltf => {
        const animation = gltf.userData.vrmAnimations?.[0];
        if (animation) resolve(animation);
        else reject(new Error('Empty animation'));
      }, undefined, reject);
    });
    actionCache.set(variant, pending);
    pending.catch(() => { if (actionCache.get(variant) === pending) actionCache.delete(variant); });
  }
  return actionCache.get(variant);
}

async function playActionByName(name) {
  const id = ++actionRequestId;
  const vrm = currentVrm;
  const modelId = modelLoadId;
  try {
    const catalog = await getAnimationCatalog();
    if (id !== actionRequestId || modelId !== modelLoadId || currentVrm !== vrm || motionReduced) return;
    const variant = chooseVariant(name, catalog[name] || []);
    const [animation, secondary] = await Promise.all([
      getSceneAnimation(name, variant.id), getVariantSecondary(name, variant, vrm, modelId),
    ]);
    if (id !== actionRequestId || modelId !== modelLoadId || currentVrm !== vrm || motionReduced) return;
    playVrmAnimation(animation, THREE.LoopOnce, name);
    if (scenePlayback) {
      scenePlayback.secondary = secondary;
      scenePlayback.variant = variant.id;
      lastVariant.set(name, variant.id);
    }
    setModelStatus(`正在${ACTION_LABELS[name]}`, '动作结束后自动恢复自然待机');
  } catch (error) {
    if (id !== actionRequestId || modelId !== modelLoadId) return;
    stopSceneAnimation();
    setModelStatus('已恢复自然待机', '动作暂不可用，不影响对话');
  }
}

function createAnimationLoader() {
  const loader = new GLTFLoader();
  loader.register((parser) => new VRMAnimationLoaderPlugin(parser));
  return loader;
}

function filteredSceneAnimation(animation, name, vrm) {
  if (name === 'preview' || FULL_EXPRESSION_ACTIONS.has(name)) {
    return { ...animation, lookAtTrack:null,
      humanoidTracks: {
        rotation:new Map([...animation.humanoidTracks.rotation].filter(([bone]) => bone !== 'jaw')),
        translation:new Map([...animation.humanoidTracks.translation].filter(([bone]) => bone !== 'jaw')),
      },
      expressionTracks: {
        preset:new Map([...animation.expressionTracks.preset].filter(([key]) => !VOWELS.includes(key) && vrm.expressionManager?.getExpression(key))),
        custom:new Map([...animation.expressionTracks.custom].filter(([key]) => !VOWELS.includes(key) && vrm.expressionManager?.getExpression(key))),
      },
    };
  }
  const isBlink = key => ['blink', 'blinkLeft', 'blinkRight'].includes(key);
  return { ...animation, lookAtTrack:null,
    humanoidTracks: {
      rotation:new Map([...animation.humanoidTracks.rotation].filter(([bone]) => !['leftEye','rightEye','jaw'].includes(bone))),
      translation:new Map([...animation.humanoidTracks.translation].filter(([bone]) => bone !== 'jaw')),
    },
    expressionTracks: {
      preset:new Map([...animation.expressionTracks.preset].filter(([key]) =>
        !VOWELS.includes(key) && (!isBlink(key) || name === 'wink' || (name === 'greet' && key === 'blink')) && vrm.expressionManager?.getExpression(key))),
      custom:new Map([...animation.expressionTracks.custom].filter(([key]) => !VOWELS.includes(key) && vrm.expressionManager?.getExpression(key))),
    },
  };
}

function restoreModelPose() {
  for (const pose of modelPose) {
    pose.node.quaternion.copy(pose.rotation);
    pose.node.position.copy(pose.position);
  }
}

function validateGreetSecondary(data) {
  if (data?.version !== 1 || data.fps !== 24 || !Number.isFinite(data.duration) || data.duration <= 0 || data.duration > 30 || !Number.isInteger(data.duration * data.fps) || !Array.isArray(data.tracks) || data.tracks.length > 64) throw new Error('Invalid secondary animation');
  const samples = data.duration * data.fps + 1;
  const names = new Set();
  for (const t of data.tracks) {
    if (typeof t.nodeName !== 'string' || !/^\d+\.joint_(?:\+AmiceB |\+HairS |___0_|(?:Left|Right)(?:Hand|Arm)Twist[123]?$)/.test(t.nodeName) || names.has(t.nodeName) || !Array.isArray(t.values) || t.values.length !== samples*4 || !t.values.every(Number.isFinite)) throw new Error('Invalid cloth track');
    names.add(t.nodeName);
    for (let i=0; i<t.values.length; i+=4) {
      if (Math.abs(Math.hypot(...t.values.slice(i,i+4))-1) > .001) throw new Error('Invalid cloth rotation');
    }
    for (const i of [0,(samples-1)*4]) {
      if (Math.hypot(...t.values.slice(i,i+3)) > .00001 || Math.abs(t.values[i+3]-1) > .00001) throw new Error('Open cloth endpoints');
    }
  }
  return data;
}

function getVariantSecondary(name, variant, vrm, loadId) {
  if (!variant.secondary || !defaultAvatar || !avatarGltf) return Promise.resolve([]);
  if (!secondaryCache.has(variant.id)) {
    secondaryCache.set(variant.id, loadGreetSecondary(avatarGltf, vrm, loadId, `/api/animations/${name}/${variant.id}/secondary`));
  }
  return secondaryCache.get(variant.id);
}

async function loadGreetSecondary(gltf, vrm, loadId, url = '/api/animations/greet/greet_1/secondary') {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2000);
  try {
    const response = await fetch(url, {signal:controller.signal});
    if (!response.ok) return [];
    const data = validateGreetSecondary(await response.json());
    const tracks = await Promise.all(data.tracks.map(async t => {
      const matches = gltf.parser.json.nodes.map((n,i) => n.name === t.nodeName ? i : -1).filter(i => i >= 0);
      if (matches.length !== 1) throw new Error('Missing or ambiguous cloth bone');
      const target = await gltf.parser.getDependency('node', matches[0]);
      return {...t, values:secondaryValuesForVrm(t.values, vrm), fps:data.fps, duration:data.duration, target, current:new THREE.Quaternion(), next:new THREE.Quaternion()};
    }));
    return loadId === modelLoadId && currentVrm === vrm ? tracks : [];
  } catch { return []; }
  finally { clearTimeout(timer); }
}

function secondaryValuesForVrm(values, vrm) {
  // Match three-vrm-animation's VRM 1 -> VRM 0 humanoid conversion.
  // Otherwise the palm and its weighted forearm helpers roll oppositely.
  return vrm.meta?.metaVersion === '0'
    ? values.map((value, index) => index % 2 === 0 ? -value : value)
    : values.slice();
}

function clearGreetSecondary() {
  for (const p of greetApplied) p.target.quaternion.copy(p.base);
  greetApplied = [];
}

function updateGreetSecondary(state) {
  if (motionReduced || !defaultAvatar) return;
  for (const t of state.secondary || []) {
    const end = t.values.length/4 - 1;
    const frame = Math.max(0, Math.min(end, state.elapsed * (t.fps || 24)));
    const index = Math.min(end-1, Math.floor(frame));
    const base = t.target.quaternion.clone();
    t.current.fromArray(t.values, index*4);
    t.next.fromArray(t.values, (index+1)*4);
    t.current.slerp(t.next, frame-index);
    t.target.quaternion.multiply(t.current);
    greetApplied.push({target:t.target, base});
  }
}

function createGreetSmile(vrm) {
  if (!defaultAvatar || vrm.expressionManager?.getExpression('happy')) return null;
  const expression = new VRMExpression('happy');
  vrm.scene.traverse(mesh => {
    for (const [name,weight] of [['34.口角上げ',.5],['39.にこり',.2]]) {
      const index = mesh.morphTargetDictionary?.[name];
      if (index !== undefined) expression.addBind(new VRMExpressionMorphTargetBind({primitives:[mesh], index, weight}));
    }
  });
  if (!expression.binds.length) return null;
  vrm.expressionManager.registerExpression(expression);
  vrm.scene.add(expression);
  return expression;
}

function stopSceneAnimation() {
  clearGreetSecondary();
  if (mixer) { mixer.stopAllAction(); mixer.uncacheRoot(animationRig); }
  if (scenePlayback) scenePlayback.expressions.forEach(name => setExpression(name, 0));
  if (scenePlayback?.greetSmile) {
    scenePlayback.greetSmile.binds.forEach(bind => bind.clearAppliedWeight());
    currentVrm.expressionManager.unregisterExpression(scenePlayback.greetSmile);
    scenePlayback.greetSmile.removeFromParent();
  }
  mixer = null;
  animationRig = null;
  activeAction = null;
  scenePlayback = null;
  if (currentVrm?.lookAt) currentVrm.lookAt.target = gazeTarget;
  restoreModelPose();
}

function playVrmAnimation(animation, loopMode, name = 'preview') {
  const from = new Map(modelPose.map(p => [p.name, { rotation:p.node.quaternion.clone(), position:p.node.position.clone() }]));
  stopSceneAnimation();
  waveState = null;
  const greetSmile = name === 'greet' ? createGreetSmile(currentVrm) : null;
  try {
  const filtered = filteredSceneAnimation(animation, name, currentVrm);
  const clip = createVRMAnimationClip(filtered, currentVrm);
  if (!clip.tracks.length || !Number.isFinite(clip.duration) || clip.duration <= 0) throw new Error('Empty clip');
  // Sample on an isolated rig: PropertyMixer skips unchanged values, so it must
  // never share its targets with the idle writer or our transition blending.
  animationRig = new THREE.Group();
  const proxies = new Map();
  const bindings = clip.tracks.map(track => {
    const path = THREE.PropertyBinding.parseTrackName(track.name);
    const target = THREE.PropertyBinding.findNode(currentVrm.scene, path.nodeName);
    const property = path.propertyName;
    if (!target || !['quaternion','position','weight'].includes(property)) throw new Error(`Unsupported action track: ${track.name}`);
    let proxy = proxies.get(target);
    if (!proxy) {
      proxy = new THREE.Object3D();
      proxy.name = target.name;
      proxy.uuid = target.uuid;
      proxies.set(target, proxy);
      animationRig.add(proxy);
    }
    if (property === 'weight') proxy.weight = 0;
    else proxy[property].copy(target[property]);
    return { target, proxy, property };
  });
  mixer = new THREE.AnimationMixer(animationRig);
  activeAction = mixer.clipAction(clip);
  activeAction.setLoop(THREE.LoopOnce, 1);
  activeAction.clampWhenFinished = true;
  activeAction.play();
  scenePlayback = { name, greetSmile, fullExpression:(name === 'preview' || FULL_EXPRESSION_ACTIONS.has(name)), elapsed:0, duration:clip.duration, from, bindings,
    expressions:[...filtered.expressionTracks.preset.keys(), ...filtered.expressionTracks.custom.keys()],
    bases:modelPose.map(p => ({...p, baseRotation:p.rotation.clone(), basePosition:p.position.clone()})),
  };
  if (scenePlayback.fullExpression && currentVrm?.lookAt) currentVrm.lookAt.target = null;
  if (name === 'wink' || name === 'greet') { blinking = false; setExpression('blink', 0); }
  } catch (error) {
    // Registration precedes clip construction so its expression track can bind.
    // A rejected clip must not leave that temporary expression on the model.
    if (greetSmile && !scenePlayback) {
      greetSmile.binds.forEach(bind => bind.clearAppliedWeight());
      currentVrm.expressionManager.unregisterExpression(greetSmile);
      greetSmile.removeFromParent();
    }
    stopSceneAnimation();
    throw error;
  }
}

function updateSceneAnimation(delta) {
  if (!scenePlayback || !mixer) return;
  const state = scenePlayback;
  state.elapsed += delta;
  for (const p of state.bases) {
    p.baseRotation.copy(p.node.quaternion);
    p.basePosition.copy(p.node.position);
  }
  mixer.update(delta);
  // Always publish the sampled pose, including constant/held keyframes.
  for (const { target, proxy, property } of state.bindings) {
    if (property === 'weight') target.weight = proxy.weight;
    else target[property].copy(proxy[property]);
  }
  const enter = Math.min(1, state.elapsed / .3);
  const leave = Math.max(0, Math.min(1, (state.duration - state.elapsed) / .3));
  for (const p of state.bases) {
    const from = state.from.get(p.name);
    if (enter < 1) {
      p.node.quaternion.slerp(from.rotation, 1 - enter);
      p.node.position.lerp(from.position, 1 - enter);
    }
    if (leave < 1) {
      p.node.quaternion.slerp(p.baseRotation, 1 - leave);
      p.node.position.lerp(p.basePosition, 1 - leave);
    }
  }
  for (const name of state.expressions) {
    const value = currentVrm.expressionManager.getValue(name) || 0;
    setExpression(name, value * Math.min(enter, leave));
  }
  updateGreetSecondary(state);
  if (state.elapsed >= state.duration) {
    stopSceneAnimation();
    updateIdle(0);
    updateIdleHands(0);
    nextBlinkAt = performance.now() + 2200;
    setModelStatus('自然待机', '可以继续和我说话');
  }
}

function startWave() {
  if (!waveState) waveState = { start: performance.now() };
}

async function initAudioContext() {
  if (!audioContext) {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (AudioContext) audioContext = new AudioContext();
  }
  if (audioContext?.state === 'suspended') await audioContext.resume();
}

function stopCurrentSpeech() {
  playbackStopped = true;
  speechGeneration += 1;
  const source = speechSourceRef;
  const cancel = cancelSpeechPlayback;
  speechSourceRef = null;
  cancelSpeechPlayback = null;
  cancel?.();
  if (source) { try { source.stop(); } catch {} }
  window.speechSynthesis?.cancel?.();
  speaking = false;
  browserSpeaking = false;
  currentVisemes = null;
  resetSpeechMouth();
}

function base64ToArrayBuffer(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes.buffer;
}

function base64ToBlob(base64, type) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type });
}

async function playSegments(segments) {
  stopCurrentSpeech();
  playbackStopped = false;
  const generation = speechGeneration;
  const cancelled = () => playbackStopped || generation !== speechGeneration;
  const result = { played: 0, failed: 0 };
  for (const segment of segments) {
    if (cancelled()) break;

    let played = false;
    if (segment.audio) {
      try {
        await initAudioContext();
        if (cancelled()) break;
        if (!audioContext) throw new Error('Web Audio unavailable');
        const buffer = await audioContext.decodeAudioData(base64ToArrayBuffer(segment.audio));
        if (cancelled()) break;
        speaking = true;
        played = (await playAudioWithVisemes(buffer, segment.visemeTimeline || [], generation)) !== false;
      } catch (error) {
        console.error('音频播放失败，尝试浏览器播报：', error);
      } finally {
        if (!cancelled()) {
          speaking = false;
          currentVisemes = null;
          resetSpeechMouth();
        }
      }
    }
    if (cancelled()) break;

    if (!played && segment.text) played = await speakWithBrowser(segment.text, generation);
    if (cancelled()) break;

    if (played) result.played += 1;
    else result.failed += 1;
  }
  return result;
}

function playAudioWithVisemes(buffer, timeline, generation = speechGeneration) {
  return new Promise((resolve, reject) => {
    if (playbackStopped || generation !== speechGeneration) { resolve(false); return; }
    const source = audioContext.createBufferSource();
    source.buffer = buffer;
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    analyser.connect(audioContext.destination);
    currentVisemes = {
      timeline,
      startTime: audioContext.currentTime,
      lastIndex: -1,
      lastTarget: null,
      lastOpen: 0,
      smoothOpen: 0,
      analyser,
      samples: new Uint8Array(analyser.frequencyBinCount),
    };
    speechSourceRef = source;
    let settled = false;
    const finish = (success, error) => {
      if (settled) return;
      settled = true;
      source.disconnect();
      analyser.disconnect();
      if (speechSourceRef === source) speechSourceRef = null;
      if (cancelSpeechPlayback === cancel) cancelSpeechPlayback = null;
      if (generation === speechGeneration) {
        currentVisemes = null;
        speaking = false;
        resetSpeechMouth();
      }
      if (error) reject(error); else resolve(success);
    };
    const cancel = () => finish(false);
    cancelSpeechPlayback = cancel;
    source.onended = () => finish(true);
    try {
      source.start();
    } catch (error) {
      finish(false, error);
    }
  });
}

function speakWithBrowser(text, generation = speechGeneration) {
  return new Promise((resolve) => {
    if (playbackStopped || generation !== speechGeneration) { resolve(false); return; }
    if (!('speechSynthesis' in window)) { resolve(false); return; }
    let settled = false;
    const finish = (success) => {
      if (settled) return;
      settled = true;
      if (cancelSpeechPlayback === cancel) cancelSpeechPlayback = null;
      if (generation === speechGeneration) {
        speaking = false;
        browserSpeaking = false;
        resetSpeechMouth();
      }
      resolve(success);
    };
    const cancel = () => finish(false);
    cancelSpeechPlayback = cancel;
    try {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'zh-CN';
      utterance.rate = 0.9;
      utterance.onstart = () => {
        if (!settled && !playbackStopped && generation === speechGeneration) { speaking = true; browserSpeaking = true; }
      };
      utterance.onend = () => finish(true);
      utterance.onerror = () => finish(false);
      window.speechSynthesis.speak(utterance);
    } catch (error) {
      finish(false);
    }
  });
}

function getBone(name) {
  if (!currentVrm) return null;
  try {
    return currentVrm.humanoid.getNormalizedBoneNode(name);
  } catch (error) {
    return null;
  }
}

function setExpression(name, value) {
  if (!currentVrm) return;
  try {
    currentVrm.expressionManager.setValue(name, value);
  } catch (error) {
    // Expressions differ between VRM models; unsupported shapes are ignored.
  }
}

function resetSpeechMouth() {
  for (const name of VOWELS) {
    mouthWeights[name] = 0;
    setExpression(name, 0);
  }
}

function blendSpeechMouth(target, open, delta) {
  // Close immediately on explicit silence/end; blend articulation over ~60 ms.
  if (!VOWELS.includes(target) || open < .005) { resetSpeechMouth(); return; }
  const alpha = 1 - Math.exp(-Math.max(0, delta) / .06);
  for (const name of VOWELS) {
    mouthWeights[name] += ((name === target ? open : 0) - mouthWeights[name]) * alpha;
    setExpression(name, mouthWeights[name]);
  }
}

function updateVrmWithSpeechPriority(delta) {
  const overrides = [];
  if (currentVisemes || browserSpeaking) {
    for (const expression of currentVrm.expressionManager?.expressions || []) {
      if (expression.overrideMouth !== 'none' && expression.overrideMouth != null) {
        overrides.push([expression, expression.overrideMouth]);
        expression.overrideMouth = 'none';
      }
    }
  }
  try { currentVrm.update(delta); }
  finally {
    for (const [expression, value] of overrides) expression.overrideMouth = value;
  }
}

function updateAvatar(delta) {
  if (!currentVrm) return;
  const now = performance.now();
  restoreModelPose();
  clearGreetSecondary();
  const hasIdle = updateIdle(delta);
  updateIdleHands(delta);
  updateSceneAnimation(delta);
  updateGaze(delta);

  if (!scenePlayback?.fullExpression && !(scenePlayback?.name === 'greet' && scenePlayback.expressions.includes('blink'))) updateBlink(now);
  if (currentVisemes && audioContext) {
    const elapsed = audioContext.currentTime - currentVisemes.startTime;
    const timeline = currentVisemes.timeline;
    let index = currentVisemes.lastIndex;
    while (index + 1 < timeline.length && timeline[index + 1].start <= elapsed) index += 1;
    if (index < 0 && timeline.length && timeline[0].start <= elapsed) index = 0;
    currentVisemes.lastIndex = index;
    const target = timeline.length
      ? (index >= 0 && elapsed < timeline[index].end ? timeline[index].viseme : null)
      : VOWELS[Math.floor(elapsed / 0.13) % VOWELS.length];
    currentVisemes.analyser.getByteTimeDomainData(currentVisemes.samples);
    let sum = 0;
    for (let i = 0; i < currentVisemes.samples.length; i += 1) {
      const v = (currentVisemes.samples[i] - 128) / 128;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / currentVisemes.samples.length);
    const open = Math.min(1, rms * 3.5);
    currentVisemes.smoothOpen += (open - currentVisemes.smoothOpen) * (1 - Math.exp(-Math.max(0, delta) / .035));
    const value = currentVisemes.smoothOpen;
    blendSpeechMouth(target, value, delta);
  } else if (browserSpeaking) {
    // Browser speech exposes no PCM: approximate articulation while it speaks.
    const target = VOWELS[Math.floor(now / 130) % VOWELS.length];
    const open = 0.12 + Math.abs(Math.sin(now * 0.012)) * 0.28;
    blendSpeechMouth(target, open, delta);
  } else { resetSpeechMouth(); }
  if (!activeAction) {
    const head = getBone('head');
    if (head && !hasIdle) {
      head.rotation.y = motionReduced ? 0 : Math.sin(now * 0.0006) * 0.06;
      head.rotation.x = speaking && !motionReduced ? Math.sin(now * 0.01) * 0.03 : 0;
    }
    updateWave(now);
  }

  updateVrmWithSpeechPriority(delta);
}

let nextBlinkAt = 2000;
let blinking = false;
let blinkStart = 0;

function updateBlink(now) {
  if (blinking) {
    const progress = (now - blinkStart) / 240;
    if (progress >= 1) {
      blinking = false;
      nextBlinkAt = now + 2200 + Math.random() * 2600;
      setExpression('blink', 0);
    } else {
      setExpression('blink', progress < 0.5 ? progress * 2 : (1 - progress) * 2);
    }
  } else if (now >= nextBlinkAt) {
    blinking = true;
    blinkStart = now;
  }
}

function updateWave(now) {
  const upperArm = getBone('rightUpperArm');
  const lowerArm = getBone('rightLowerArm');
  const hand = getBone('rightHand');
  if (!waveState) return;

  const progress = (now - waveState.start) / WAVE_DURATION;
  if (progress >= 1) {
    waveState = null;
    if (upperArm) upperArm.rotation.z = -1.15;
    if (lowerArm) lowerArm.rotation.x = 0;
    if (hand) hand.rotation.x = 0;
    return;
  }

  const raise = Math.min(1, progress / 0.3);
  const ease = raise * raise * (3 - 2 * raise);
  if (upperArm) upperArm.rotation.z = -1.15 + 1.7 * ease;
  if (lowerArm) lowerArm.rotation.x = 0.55 * ease;
  if (hand && progress > 0.3) hand.rotation.x = Math.sin(now * 0.02) * 0.4;
}
