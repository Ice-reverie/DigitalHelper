const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../vrm_demo/static/js/hospital-scenes.js'), 'utf8');
const context = vm.createContext({});
vm.runInContext(source.replace(/^export /gm, ''), context);
const SceneSelection = vm.runInContext('SceneSelection', context);
const pose = vm.runInContext('scenePose', context);

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function harness(overrides = {}) {
  const commits = [], writes = [], notices = [];
  const selection = new SceneSelection({
    load: async url => url,
    commit: id => commits.push(id),
    read: () => null,
    write: id => writes.push(id),
    notify: (state, id) => notices.push([state, id]),
    ...overrides,
  });
  return { selection, commits, writes, notices };
}

test('restores a saved scene without writing the preference again', async () => {
  const h = harness({ read: () => 'waiting' });
  await h.selection.restore();
  assert.deepEqual(h.commits, ['waiting']);
  assert.deepEqual(h.writes, []);
});

test('unknown saved values and blocked storage safely use the default scene', async () => {
  for (const read of [() => 'https://unknown.example/scene', () => '__proto__', () => { throw Error('blocked'); }]) {
    const h = harness({ read });
    await h.selection.restore();
    assert.deepEqual(h.commits, ['outpatient']);
    assert.equal(await h.selection.select('unknown'), false);
  }
});

test('a failed image retains the old scene and can be retried', async () => {
  let fail = false;
  const h = harness({ load: async url => { if (fail) throw Error('offline'); return url; } });
  await h.selection.select('outpatient');
  fail = true;
  assert.equal(await h.selection.select('waiting'), false);
  assert.equal(h.selection.current, 'outpatient');
  assert.deepEqual(h.writes, ['outpatient']);
  assert.deepEqual(h.notices.at(-1), ['error', 'waiting']);
  fail = false;
  assert.equal(await h.selection.select('waiting'), true);
  assert.deepEqual(h.writes, ['outpatient', 'waiting']);
});

test('rapid selections commit only the latest result, even when loads finish out of order', async () => {
  const first = deferred(), second = deferred();
  const h = harness({ load: url => url.includes('waiting') ? first.promise : second.promise });
  const a = h.selection.select('waiting');
  const b = h.selection.select('guidance');
  second.resolve('guidance image');
  assert.equal(await b, true);
  first.resolve('waiting image');
  assert.equal(await a, false);
  assert.deepEqual(h.commits, ['guidance']);
  assert.deepEqual(h.writes, ['guidance']);
});

test('returning to the visible scene cancels an outstanding switch', async () => {
  const pending = deferred();
  const h = harness({ load: url => url.includes('waiting') ? pending.promise : Promise.resolve(url) });
  await h.selection.select('outpatient');
  const a = h.selection.select('waiting');
  await h.selection.select('outpatient');
  pending.resolve('waiting image');
  assert.equal(await a, false);
  assert.deepEqual(h.commits, ['outpatient']);
  assert.deepEqual(h.notices.at(-1), ['ready', 'outpatient']);
});

test('a failed restored scene falls back without replacing its saved preference', async () => {
  const h = harness({ read: () => 'waiting', load: async url => {
    if (url.includes('waiting')) throw Error('offline');
    return url;
  } });
  await h.selection.restore();
  assert.deepEqual(h.commits, ['outpatient']);
  assert.deepEqual(h.writes, []);
});

test('a stale failed restoration cannot override a newer explicit scene selection', async () => {
  const pending = deferred();
  const h = harness({ read: () => 'waiting', load: url => url.includes('waiting') ? pending.promise : Promise.resolve(url) });
  const restored = h.selection.restore();
  await h.selection.select('guidance');
  pending.reject(Error('offline'));
  await restored;
  assert.deepEqual(h.commits, ['guidance']);
  assert.deepEqual(h.notices.at(-1), ['ready', 'guidance']);
});

test('saving failures leave the new scene usable and clearly report the unsaved preference', async () => {
  const h = harness({ write: () => { throw Error('quota'); } });
  assert.equal(await h.selection.select('guidance'), true);
  assert.equal(h.selection.current, 'guidance');
  assert.deepEqual(h.notices.at(-1), ['unsaved', 'guidance']);
});

test('reduced motion is stationary regardless of time or pointer movement', () => {
  const neutral = JSON.stringify(pose(0, { x: 0, y: 0 }, true));
  for (const time of [1, 20, 60, 600]) {
    assert.equal(JSON.stringify(pose(time, { x: 1, y: -1 }, true)), neutral);
  }
});

test('ambient movement stays bounded and reacts to both elapsed time and pointer position', () => {
  assert.notDeepEqual(pose(0), pose(10));
  assert.notDeepEqual(pose(10), pose(10, { x: .5, y: -.5 }));
  for (let t = 0; t < 600; t += 3) {
    const p = pose(t, { x: 10, y: -10 });
    assert.ok(Math.abs(p.x) <= 21 && Math.abs(p.y) <= 11);
    assert.ok(Math.abs(p.tilt) <= .35 && p.scale >= 1.035 && p.scale <= 1.045);
    assert.ok(p.light >= .978 && p.light <= 1.022);
  }
});
