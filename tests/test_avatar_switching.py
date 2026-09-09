import asyncio
import json
from pathlib import Path
import struct
import unittest
from unittest.mock import patch

import httpx
from vrm_demo import vrm_server as server


class AvatarSwitchingTests(unittest.IsolatedAsyncioTestCase):
    async def test_catalog_and_all_models_are_served_without_directory_access(self):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=server.app), base_url='http://test') as client:
            catalog = (await client.get('/api/avatars')).json()
            self.assertEqual({a['id'] for a in catalog}, set(server.AVATAR_NAMES))
            for avatar in catalog:
                response = await client.get('/api/avatars/' + avatar['id'])
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.content[:4], b'glTF')
            for name in ['missing', 'Lumine.vrm', '%2e%2e%2f.env']:
                self.assertEqual((await client.get('/api/avatars/' + name)).status_code, 404)
        with patch.object(server.os.path, 'isfile', return_value=False):
            self.assertEqual(await server.avatar_catalog(), [])
            with self.assertRaises(server.HTTPException):
                await server.named_avatar('Klee')

    def test_all_current_models_have_humanoid_eyes_and_valid_expression_targets(self):
        root = Path(server.BASE_DIR).parent/'models'/'characters'
        for name in server.AVATAR_NAMES:
            data = (root/(name+'.vrm')).read_bytes()
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
