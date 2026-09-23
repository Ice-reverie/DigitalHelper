const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const {chromium} = require('playwright-core');

const root = path.resolve(__dirname, '../vrm_demo/static');
const avatar = path.resolve(__dirname, '../models/characters/AstraYao.vrm');
const models = [
  {id:'doctorBoy', label:'医生（男）', voice_gender:'male'},
  {id:'schoolBoy', label:'校服男生', voice_gender:'male'},
  {id:'schoolGirl', label:'校服女生', voice_gender:'female'},
  {id:'studentGirl', label:'学生女生', voice_gender:'female'},
];
const modelFiles = new Map(models.map(model => [model.id,
  path.resolve(__dirname, `../models/characters/${model.id}.vrm`)]));
const idle = path.resolve(__dirname, '../models/animations/Lumine_idle.json');
const greet = path.resolve(__dirname, '../models/animations/greet_1.vrma');
const edge = process.env.BROWSER_EXECUTABLE ||
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

test('real browser loads new avatars, plays greeting, and survives a missing 3D bundle',
  {skip: !fs.existsSync(edge) && 'Set BROWSER_EXECUTABLE to a Chromium browser'}, async () => {
    let unavailable3D = false;
    const server = http.createServer(async (request, response) => {
      const pathname = new URL(request.url, 'http://localhost').pathname;
      const json = (value, status = 200) => {
        response.writeHead(status, {'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store'});
        response.end(JSON.stringify(value));
      };
      if (pathname === '/api/health') return json({status:'ok'});
      if (pathname === '/api/avatars') return json(models.map(model => ({...model, profile:'standard'})));
      if (pathname.startsWith('/api/avatars/')) {
        const file = modelFiles.get(decodeURIComponent(pathname.slice('/api/avatars/'.length)));
        if (!file) return json({detail:'Unknown avatar'}, 404);
        response.writeHead(200, {'Content-Type':'model/gltf-binary'});
        return fs.createReadStream(file).pipe(response);
      }
      if (pathname === '/api/avatar') {
        if (unavailable3D) return json({detail:'Unavailable in smoke test'}, 404);
        response.writeHead(200, {'Content-Type':'model/gltf-binary', 'Cache-Control':'no-store'});
        return fs.createReadStream(avatar).pipe(response);
      }
      if (pathname === '/api/animations/idle') {
        response.writeHead(200, {'Content-Type':'application/json'});
        return fs.createReadStream(idle).pipe(response);
      }
      if (pathname === '/api/animations') return json({greet:[{id:'greet_1', secondary:false}],
        explain:[], alert:[], booking:[], confirm:[], thanks:[], wink:[]});
      if (pathname === '/api/animations/greet/greet_1') {
        response.writeHead(200, {'Content-Type':'model/gltf-binary'});
        return fs.createReadStream(greet).pipe(response);
      }
      if (pathname === '/api/chat') {
        let body = '';
        for await (const chunk of request) body += chunk;
        const incoming = JSON.parse(body);
        return json({reply:`收到：${incoming.text}`, action:incoming.text === '你好' ? 'greet' : null, context:{},
          quick_replies:[], segments:[{text:`收到：${incoming.text}`}]});
      }
      if (pathname === '/api/tts') return json({voice_gender:'female', segments:[{text:'播报'}]});
      if (pathname === '/static/js/vrm-dependencies.js' && unavailable3D) {
        response.writeHead(503, {'Content-Type':'text/javascript', 'Cache-Control':'no-store'});
        return response.end('');
      }
      const relative = pathname.startsWith('/static/') ? pathname.slice('/static/'.length) : '';
      const file = path.resolve(root, relative);
      if (!relative || !file.startsWith(root + path.sep) || !fs.existsSync(file)) {
        response.writeHead(404);
        return response.end();
      }
      const type = file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' :
        file.endsWith('.html') ? 'text/html' : 'application/octet-stream';
      response.writeHead(200, {'Content-Type':type, 'Cache-Control':'no-store'});
      fs.createReadStream(file).pipe(response);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const browser = await chromium.launch({executablePath:edge, headless:true});
    try {
      for (const broken of [false, true]) {
        unavailable3D = broken;
        const context = await browser.newContext();
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        const bundleResponse = page.waitForResponse(response =>
          response.url().endsWith('/static/js/vrm-dependencies.js'));
        await page.goto(`http://127.0.0.1:${server.address().port}/static/VRMCharacter.html`);
        assert.equal((await bundleResponse).status(), broken ? 503 : 200);
        if (!broken) {
          try {
            await page.waitForFunction(() => document.getElementById('avatar-placeholder')
              ?.hidden === true, null, {timeout:20000});
          } catch (error) {
            const status = await page.locator('#model-status-title').textContent();
            throw Error(`${error.message}; model status: ${status}; page errors: ${errors.join(' | ')}`);
          }
          assert.equal(await page.locator('#stage canvas').count(), 1);
        }
        await page.locator('#text-input').fill('测试对话');
        await page.locator('#send-btn').click();
        await page.locator('#messages').getByText('收到：测试对话', {exact:true}).waitFor();
        if (!broken) {
          await page.locator('#help-btn').click();
          await page.locator('#help-dialog details').evaluate(element => {element.open = true;});
          for (const model of models) {
            await page.locator('#avatar-select').selectOption(model.id);
            await page.locator('#switch-avatar-btn').click();
            await page.waitForFunction(label => document.getElementById('model-status-title')
              ?.textContent.includes(`${label} 已就绪`), model.label, {timeout:15000});
            assert.match(await page.locator('#avatar-voice-status').textContent(),
              model.voice_gender === 'male' ? /男声/ : /女声/);
            await page.locator('#help-dialog').evaluate(element => element.close());
            await page.locator('#text-input').fill('你好');
            await page.locator('#send-btn').click();
            try {
              await page.waitForFunction(() => document.getElementById('model-status-title')
                ?.textContent.includes('正在问候'), null, {timeout:3000});
            } catch (error) {
              throw Error(`${model.id}: ${error.message}; status: ${await page.locator('#model-status-title').textContent()}; errors: ${errors.join(' | ')}`);
            }
            await page.locator('#help-btn').click();
            await page.locator('#help-dialog details').evaluate(element => {element.open = true;});
          }
          await page.locator('#help-dialog').evaluate(element => element.close());
        }
        assert.deepEqual(errors, []);
        await context.close();
      }
    } finally {
      await browser.close();
      await new Promise(resolve => server.close(resolve));
    }
  });
