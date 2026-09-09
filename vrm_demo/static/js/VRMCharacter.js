import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';
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
let gazeTarget = null;
const gazePointer = { x: 0, y: 0, smoothX: 0, smoothY: 0 };
const ACTION_LABELS = { greet:'问候', explain:'讲解', alert:'预警提醒', booking:'预约引导', confirm:'确认', thanks:'致谢', wink:'轻松互动' };
// Actions listed here keep their full facial animation (blink / mouth / eyes).
// While one plays, auto-blink, lip-sync and gaze are paused, then restored.
// Add an action name here to give it the same treatment.
const FULL_EXPRESSION_ACTIONS = new Set(['greet', 'explain', 'alert', 'booking', 'confirm', 'thanks', 'wink']);
const actionCache = new Map();
let actionRequestId = 0;
let lastSceneAction = null;
let scenePlayback = null;
let animationRig = null;
let modelPose = [];
let mixer = null;
let activeAction = null;
let waveState = null;
let conversationContext = {};

let audioContext = null;
let speaking = false;
let browserSpeaking = false;
const VOWELS = ['aa', 'ih', 'ou', 'ee', 'oh'];
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
    trigger.addEventListener('click', () => panel.showModal());
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
    if (hasFinalResult && transcript.trim()) sendMessage(transcript.trim());
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
    else recognition.start();
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
      body: JSON.stringify({ text, context: startNewService ? {} : conversationContext }),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data = await response.json();
    conversationContext = data.context || {};
    const note = data.tts_available ? '' : '当前使用浏览器语音播报';
    addMessage(data.reply, false, note);
    renderQuickReplies(data.quick_replies || []);
    handleAction(data.action);

    setInteractionStatus('正在为您朗读，请稍候……');
    const playback = await playSegments(data.segments?.length ? data.segments : [{ text: data.reply }]);
    setInteractionStatus(
      playback.failed ? '部分语音暂时无法播放，请查看下方文字回复。'
        : data.context?.flow ? '请按下方提示，选择下一步。' : '已为您回复，还需要什么帮助？',
      playback.failed ? 'warning' : '',
    );
  } catch (error) {
    console.error('请求失败：', error);
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
  if (!currentVrm) return;
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

function loadVrm(url, name, release = () => {}) {
  if (!renderer) {
    release();
    setModelStatus('无法加载 3D 模型', '当前设备未启用 WebGL，其他功能仍可使用');
    return;
  }
  const loadId = ++modelLoadId;
  actionRequestId += 1;
  lastSceneAction = null;
  stopSceneAnimation();
  setModelStatus('正在加载 3D 模型…', name);
  const loader = new GLTFLoader();
  loader.register((parser) => new VRMLoaderPlugin(parser));
  loader.load(
    url,
    (gltf) => {
      release();
      if (loadId !== modelLoadId) { VRMUtils.deepDispose(gltf.scene); return; }
      const vrm = gltf.userData.vrm;
      if (!vrm) {
        VRMUtils.deepDispose(gltf.scene);
        setModelStatus('模型加载失败', '请选择有效的 .vrm 模型');
        return;
      }
      VRMUtils.removeUnnecessaryJoints(gltf.scene);
      VRMUtils.rotateVRM0(vrm);
      if (url.startsWith('/api/avatar')) tuneCompanionFace(vrm);
      if (currentVrm) { scene.remove(currentVrm.scene); VRMUtils.deepDispose(currentVrm.scene); }
      currentVrm = vrm;
      idleAnimation = null;
      mixer = null;
      activeAction = null;
      scene.add(vrm.scene);
      waveState = null;
      const leftArm = getBone('leftUpperArm');
      const rightArm = getBone('rightUpperArm');
      if (leftArm) leftArm.rotation.z = 1.15;
      if (rightArm) rightArm.rotation.z = -1.15;
      modelPose = Object.keys(vrm.humanoid.normalizedHumanBones).map((name) => {
        const node = vrm.humanoid.getNormalizedBoneNode(name);
        return { name, node, rotation:node.quaternion.clone(), position:node.position.clone() };
      });
      vrm.update(0);
      vrm.scene.updateMatrixWorld(true);
      vrm.scene.traverse((object) => { if (object.isSkinnedMesh) object.skeleton.update(); });
      avatarBounds = new THREE.Box3().setFromObject(vrm.scene, true);
      fitAvatar();
      if (vrm.lookAt) vrm.lookAt.target = gazeTarget;
      nextBlinkAt = performance.now() + 2200;
      blinking = false;
      if (url.startsWith('/api/avatar')) loadDefaultIdle(gltf, vrm, loadId);
      Object.keys(ACTION_LABELS).forEach(name => getSceneAnimation(name).catch(() => {}));
      elements.avatarPlaceholder.hidden = true;
      setModelStatus('3D 模型已加载', '可以测试挥手和对话');
      document.getElementById('reset-view-btn').hidden = false;
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

async function loadDefaultIdle(gltf, vrm, loadId) {
  try {
    const response = await fetch('/api/animations/idle');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    if (data.version !== 1 || !Number.isFinite(data.duration) || data.duration <= 0 || !Number.isFinite(data.fps) || data.fps <= 0) throw new Error('Invalid idle format');
    const tracks = await Promise.all(data.tracks.map(async (track) => {
      const node = track.bone ? vrm.humanoid.getNormalizedBoneNode(track.bone) : await gltf.parser.getDependency('node', track.node);
      if (!node || track.values.length !== (Math.round(data.duration * data.fps) + 1) * 4 || !track.values.every(Number.isFinite)) throw new Error('Invalid idle track');
      return { ...track, target:node, rest:node.quaternion.clone(), current:new THREE.Quaternion(), next:new THREE.Quaternion() };
    }));
    if (loadId !== modelLoadId || vrm !== currentVrm) return;
    idleAnimation = { ...data, tracks, time:0 };
    setModelStatus('自然待机已就绪', '头发与衣服轻摆，自动眨眼；眼睛跟随鼠标或触摸位置');
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

function getSceneAnimation(name) {
  if (!Object.hasOwn(ACTION_LABELS, name)) return Promise.reject(new Error('Unknown action'));
  if (!actionCache.has(name)) {
    const pending = new Promise((resolve, reject) => {
      createAnimationLoader().load(`/api/animations/${name}`, gltf => {
        const animation = gltf.userData.vrmAnimations?.[0];
        if (animation) resolve(animation);
        else reject(new Error('Empty animation'));
      }, undefined, reject);
    });
    actionCache.set(name, pending);
    pending.catch(() => { if (actionCache.get(name) === pending) actionCache.delete(name); });
  }
  return actionCache.get(name);
}

async function playActionByName(name) {
  const id = ++actionRequestId;
  const vrm = currentVrm;
  const modelId = modelLoadId;
  try {
    const animation = await getSceneAnimation(name);
    if (id !== actionRequestId || modelId !== modelLoadId || currentVrm !== vrm || motionReduced) return;
    playVrmAnimation(animation, THREE.LoopOnce, name);
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
        rotation:new Map(animation.humanoidTracks.rotation),
        translation:new Map(animation.humanoidTracks.translation),
      },
      expressionTracks: {
        preset:new Map([...animation.expressionTracks.preset].filter(([key]) => vrm.expressionManager?.getExpression(key))),
        custom:new Map([...animation.expressionTracks.custom].filter(([key]) => vrm.expressionManager?.getExpression(key))),
      },
    };
  }
  const isBlink = key => ['blink', 'blinkLeft', 'blinkRight'].includes(key);
  return { ...animation, lookAtTrack:null,
    humanoidTracks: {
      rotation:new Map([...animation.humanoidTracks.rotation].filter(([bone]) => !['leftEye','rightEye','jaw'].includes(bone))),
      translation:new Map(animation.humanoidTracks.translation),
    },
    expressionTracks: {
      preset:new Map([...animation.expressionTracks.preset].filter(([key]) =>
        !VOWELS.includes(key) && (!isBlink(key) || name === 'wink') && vrm.expressionManager?.getExpression(key))),
      custom:new Map([...animation.expressionTracks.custom].filter(([key]) => vrm.expressionManager?.getExpression(key))),
    },
  };
}

function restoreModelPose() {
  for (const pose of modelPose) {
    pose.node.quaternion.copy(pose.rotation);
    pose.node.position.copy(pose.position);
  }
}

function stopSceneAnimation() {
  if (mixer) { mixer.stopAllAction(); mixer.uncacheRoot(animationRig); }
  if (scenePlayback) scenePlayback.expressions.forEach(name => setExpression(name, 0));
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
  scenePlayback = { name, fullExpression:(name === 'preview' || FULL_EXPRESSION_ACTIONS.has(name)), elapsed:0, duration:clip.duration, from, bindings,
    expressions:[...filtered.expressionTracks.preset.keys(), ...filtered.expressionTracks.custom.keys()],
    bases:modelPose.map(p => ({...p, baseRotation:p.rotation.clone(), basePosition:p.position.clone()})),
  };
  if (scenePlayback.fullExpression && currentVrm?.lookAt) currentVrm.lookAt.target = null;
  if (name === 'wink') { blinking = false; setExpression('blink', 0); }
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
  if (state.elapsed >= state.duration) {
    stopSceneAnimation();
    updateIdle(0);
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
  const result = { played: 0, failed: 0 };
  for (const segment of segments) {
    let played = false;
    if (segment.audio) {
      try {
        await initAudioContext();
        if (!audioContext) throw new Error('Web Audio unavailable');
        const buffer = await audioContext.decodeAudioData(base64ToArrayBuffer(segment.audio));
        speaking = true;
        await playAudioWithVisemes(buffer, segment.visemeTimeline || []);
        played = true;
      } catch (error) {
        console.error('音频播放失败，尝试浏览器播报：', error);
      } finally {
        speaking = false;
        currentVisemes = null;
        VOWELS.forEach((v) => setExpression(v, 0));
      }
    }
    // Fall back per sentence: preserve order and never skip missing audio.
    if (!played && segment.text) played = await speakWithBrowser(segment.text);
    if (played) result.played += 1;
    else result.failed += 1;
  }
  return result;
}

function playAudioWithVisemes(buffer, timeline) {
  return new Promise((resolve, reject) => {
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
    source.onended = () => {
      source.disconnect();
      analyser.disconnect();
      currentVisemes = null;
      VOWELS.forEach((v) => setExpression(v, 0));
      resolve();
    };
    try {
      source.start();
    } catch (error) {
      source.disconnect();
      analyser.disconnect();
      currentVisemes = null;
      reject(error);
    }
  });
}

function speakWithBrowser(text) {
  return new Promise((resolve) => {
    if (!('speechSynthesis' in window)) { resolve(false); return; }
    const finish = (success) => {
      speaking = false;
      browserSpeaking = false;
      VOWELS.forEach((v) => setExpression(v, 0));
      resolve(success);
    };
    try {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'zh-CN';
      utterance.rate = 0.9;
      utterance.onstart = () => { speaking = true; browserSpeaking = true; };
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

function updateAvatar(delta) {
  if (!currentVrm) return;
  const now = performance.now();
  restoreModelPose();
  const hasIdle = updateIdle(delta);
  updateSceneAnimation(delta);
  updateGaze(delta);

  if (!scenePlayback?.fullExpression) updateBlink(now);
  if (!scenePlayback?.fullExpression && currentVisemes && audioContext) {
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
    currentVisemes.smoothOpen += (open - currentVisemes.smoothOpen) * 0.15;
    const value = currentVisemes.smoothOpen;
    if (target !== currentVisemes.lastTarget || Math.abs(value - currentVisemes.lastOpen) > 0.02) {
      currentVisemes.lastTarget = target;
      currentVisemes.lastOpen = value;
      if (target) {
        VOWELS.forEach((v) => setExpression(v, v === target ? value : 0));
      } else {
        VOWELS.forEach((v) => setExpression(v, 0));
      }
    }
  } else if (!scenePlayback?.fullExpression && browserSpeaking) {
    // Browser speech exposes no PCM: approximate articulation while it speaks.
    const target = VOWELS[Math.floor(now / 130) % VOWELS.length];
    const open = 0.12 + Math.abs(Math.sin(now * 0.012)) * 0.28;
    VOWELS.forEach((v) => setExpression(v, v === target ? open : 0));
  }
  if (!activeAction) {
    const head = getBone('head');
    if (head && !hasIdle) {
      head.rotation.y = motionReduced ? 0 : Math.sin(now * 0.0006) * 0.06;
      head.rotation.x = speaking && !motionReduced ? Math.sin(now * 0.01) * 0.03 : 0;
    }
    updateWave(now);
  }

  currentVrm.update(delta);
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
