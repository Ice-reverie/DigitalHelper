import asyncio
import json
from pathlib import Path
import struct
import tempfile
from urllib.parse import quote
import unittest
from unittest.mock import patch

import httpx
from vrm_demo import vrm_server as server


class AvatarSwitchingTests(unittest.IsolatedAsyncioTestCase):
    async def test_catalog_and_all_models_are_served_without_directory_access(self):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=server.app), base_url='http://test') as client:
            catalog = (await client.get('/api/avatars')).json()
            self.assertEqual(catalog[0]['id'], 'AstraYao')
            self.assertEqual(catalog[0]['profile'], 'standard')
            default = await client.get('/api/avatar')
            self.assertEqual(default.content, server.avatar_files()['AstraYao'].read_bytes())
            self.assertEqual({a['id'] for a in catalog}, set(server.avatar_files()))
            for avatar in catalog:
                response = await client.get('/api/avatars/' + avatar['id'])
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.content[:4], b'glTF')
            for name in ['missing', 'Lumine.vrm', '%2e%2e%2f.env']:
                self.assertEqual((await client.get('/api/avatars/' + name)).status_code, 404)
        with tempfile.TemporaryDirectory() as folder, patch.object(server, 'CHARACTERS_DIR', Path(folder)):
            self.assertEqual(await server.avatar_catalog(), [])
            with self.assertRaises(server.HTTPException):
                await server.named_avatar('Klee')

    def test_all_current_models_have_humanoid_eyes_and_valid_expression_targets(self):
        files = server.avatar_files()
        self.assertTrue(files, 'Expected repository avatar assets')
        for name, path in files.items():
            data = path.read_bytes()
            gltf = json.loads(data[20:20+struct.unpack_from('<I',data,12)[0]])
            vrm = gltf['extensions']['VRM']
            bones = {b['bone'] for b in vrm['humanoid']['humanBones']}
            self.assertTrue({'hips','head','leftEye','rightEye','leftFoot','rightFoot','leftUpperArm','rightUpperArm'} <= bones, name)
            groups = vrm['blendShapeMaster']['blendShapeGroups']
            if name == 'Lumine':
                # Runtime adapter binds these existing morphs; the source stays unchanged.
                self.assertGreaterEqual(len(gltf['meshes'][1]['primitives'][0]['targets']),43)
                continue
            self.assertTrue({'a','i','u','e','o','blink','blink_l','blink_r'} <= {g['presetName'] for g in groups}, name)
            for group in groups:
                for bind in group['binds']:
                    self.assertTrue(any(bind['index'] < len(p.get('targets',[])) for p in gltf['meshes'][bind['mesh']]['primitives']), name)

    async def test_live_discovery_add_remove_names_and_directory_boundary(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(server, 'CHARACTERS_DIR', Path(folder)/'characters'):
            root = server.CHARACTERS_DIR
            self.assertEqual(await server.avatar_catalog(), [])
            root.mkdir()
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=server.app), base_url='http://test') as client:
                self.assertEqual((await client.get('/api/avatars')).json(), [])
                for filename in ['新人物 #1.VRM', 'Lumine_custom.vrm', 'AstraYao.vrm']:
                    (root/filename).write_bytes(b'glTF-test')
                (root/'notes.txt').write_text('private')
                (root/'nested.vrm').mkdir()
                (root/'nested.vrm'/'hidden.vrm').write_bytes(b'glTF')
                catalog = (await client.get('/api/avatars')).json()
                self.assertEqual(catalog[0]['id'], 'AstraYao')
                self.assertEqual({a['id'] for a in catalog}, {'新人物 #1','Lumine_custom','AstraYao'})
                self.assertEqual(next(a['profile'] for a in catalog if a['id']=='Lumine_custom'), 'standard')
                response = await client.get('/api/avatars/'+quote('新人物 #1', safe=''))
                self.assertEqual(response.content, b'glTF-test')
                (root/'新人物 #1.VRM').unlink()
                self.assertEqual((await client.get('/api/avatars/'+quote('新人物 #1', safe=''))).status_code,404)
                self.assertEqual(len((await client.get('/api/avatars')).json()),2)
                for name in ['notes','nested.vrm','..%5C.env','nested.vrm%2Fhidden']:
                    self.assertEqual((await client.get('/api/avatars/'+name)).status_code,404)
