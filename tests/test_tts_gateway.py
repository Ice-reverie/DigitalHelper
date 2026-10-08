import asyncio
import io
import json
import os
import unittest
import wave
from unittest.mock import AsyncMock, patch

import httpx
from vrm_demo import tts_gateway as gateway, vrm_server as server

CONFIG = {"DIGITALHELPER_TTS_PROTOCOL": "openai-compatible", "DIGITALHELPER_TTS_API_KEY": "test-secret",
          "DIGITALHELPER_TTS_BASE_URL": "https://speech.invalid/v1", "DIGITALHELPER_TTS_MODEL": "test-tts",
          "DIGITALHELPER_TTS_VOICE_MALE": "male-id", "DIGITALHELPER_TTS_VOICE_FEMALE": "female-id"}


def audio_fixture():
    data = io.BytesIO()
    with wave.open(data, "wb") as writer:
        writer.setnchannels(1)
        writer.setsampwidth(2)
        writer.setframerate(16000)
        writer.writeframes(b"\0\0" * 1600)
    return data.getvalue()


class SpeechTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        env = patch.dict(os.environ, {}, clear=True)
        env.start()
        self.addCleanup(env.stop)

    async def test_api_gender_validation_catalog_and_shared_chat(self):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=server.app), base_url="http://test") as client:
            with patch.object(server, "tts_to_mp3", new=AsyncMock(return_value=b"")) as synth:
                for avatar, override, expected in [("Harumasa", "auto", "male"), ("doctorBoy", "auto", "male"),
                                                   ("schoolBoy", "auto", "male"), ("schoolGirl", "auto", "female"),
                                                   ("studentGirl", "auto", "female"), ("AstraYao", "auto", "female"),
                                                   ("unknown", "auto", "female"), ("AstraYao", "male", "male")]:
                    response = await client.post('/api/tts', json={"text":"您好", "avatar_id":avatar, "voice_gender":override})
                    self.assertEqual(response.status_code, 200)
                    self.assertEqual(response.json()['voice_gender'], expected)
                    synth.assert_awaited_with("您好", expected)
                response = await client.post('/api/chat', json={"text":"谢谢", "avatar_id":"Harumasa"})
                self.assertEqual(response.json()['voice_gender'], 'male')
                self.assertEqual(response.json()['action'], 'thanks')
                for body in [{"text":""}, {"text":"x"*501}, {"text":"hello", "voice_gender":"invalid"}]:
                    self.assertEqual((await client.post('/api/tts', json=body)).status_code,422)
                catalog = (await client.get('/api/avatars')).json()
                self.assertEqual({v['id'] for v in catalog}, set(server.avatar_files()))
                for item in catalog:
                    self.assertEqual(item['voice_gender'], gateway.voice_gender(item['id']))
                for name in ('doctorBoy', 'schoolBoy'):
                    self.assertEqual(next(v for v in catalog if v['id']==name)['voice_gender'], 'male')

    async def test_external_wire_and_actual_audio_validation(self):
        real_client = httpx.AsyncClient
        with patch.dict(os.environ, CONFIG):
            for gender in ['male','female']:
                def handle(request):
                    self.assertEqual(request.url.path, '/v1/audio/speech')
                    self.assertEqual(request.headers['authorization'], 'Bearer test-secret')
                    payload = json.loads(request.content)
                    self.assertEqual(payload['voice'], gender+'-id')
                    self.assertEqual(payload['response_format'], 'mp3')
                    return httpx.Response(200, content=audio_fixture())
                with patch.object(gateway.httpx,'AsyncClient',return_value=real_client(transport=httpx.MockTransport(handle))):
                    self.assertEqual(await gateway.external_speech(gateway.configuration(),'您好',gender),audio_fixture())
        self.assertFalse(gateway.valid_audio(b'{"error":"bad"}'))

    async def test_invalid_external_audio_falls_back_without_leaking_errors(self):
        real_client = httpx.AsyncClient
        with patch.dict(os.environ,CONFIG), patch.object(gateway,'edge_speech',new=AsyncMock(return_value=b'edge')) as edge:
            client = real_client(transport=httpx.MockTransport(lambda r: httpx.Response(200,content=b'not audio')))
            with patch.object(gateway.httpx,'AsyncClient',return_value=client), self.assertLogs(gateway.logger) as logs:
                self.assertEqual(await gateway.synthesize('hello','male'),b'edge')
            edge.assert_awaited_once_with('hello','male')
            self.assertNotIn('test-secret',str(logs.output))

    async def test_timeouts_and_provider_failure_preserve_browser_fallback(self):
        async def stalled(*args):
            await asyncio.Event().wait()
        with patch.dict(os.environ,CONFIG), patch.object(gateway,'external_speech',side_effect=stalled), \
             patch.object(gateway,'edge_speech',new=AsyncMock(return_value=b'edge')):
            self.assertEqual(await gateway.synthesize('hello','female',.01),b'edge')
        with patch.object(gateway,'external_speech',new=AsyncMock()) as external, \
             patch.object(gateway,'edge_speech',side_effect=RuntimeError('test-secret')):
            self.assertEqual(await gateway.synthesize('hello','female'),b'')
            external.assert_not_awaited()

    async def test_edge_voice_selection_and_safe_health(self):
        class Stream:
            async def stream(self):
                yield {'type':'audio','data':b'edge'}
        with patch.object(gateway.edge_tts,'Communicate',return_value=Stream()) as communicate:
            await gateway.edge_speech('hello','male')
            self.assertEqual(communicate.call_args.args[1],'zh-CN-YunxiNeural')
            await gateway.edge_speech('hello','female')
            self.assertEqual(communicate.call_args.args[1],'zh-CN-XiaoxiaoNeural')
        with patch.dict(os.environ,CONFIG):
            health = await server.health()
            self.assertTrue(health['tts_configured'])
            self.assertNotIn('test-secret',json.dumps(health))
