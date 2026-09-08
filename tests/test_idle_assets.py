import asyncio
import hashlib
import json
import math
import struct
import unittest
from pathlib import Path

from vrm_demo import vrm_server

MODELS = Path(__file__).resolve().parents[1] / 'models'


def read_vrm(path):
    data = path.read_bytes()
    magic, version, length = struct.unpack_from('<III', data)
    assert magic == 0x46546C67 and version == 2 and length == len(data)
    size = struct.unpack_from('<I', data, 12)[0]
    return json.loads(data[20:20 + size]), data[20 + size:]


class IdleAssetsTests(unittest.TestCase):
    def test_character_copy_preserves_original_geometry_and_binds_existing_shapes(self):
        source, source_buffer = read_vrm(MODELS / 'characters/Lumine.vrm')
        adapted, adapted_buffer = read_vrm(MODELS / 'characters/Lumine_companion.vrm')
        self.assertEqual(source_buffer, adapted_buffer)
        groups = adapted['extensions']['VRM']['blendShapeMaster']['blendShapeGroups']
        blink = next(g for g in groups if g['presetName'] == 'blink')
        self.assertEqual(len(blink['binds']), 2)
        for group in groups:
            for bind in group['binds']:
                mesh = source['meshes'][bind['mesh']]
                self.assertLess(bind['index'], len(mesh['primitives'][0]['targets']))

    def test_blender_tracks_are_finite_normalized_and_seamless(self):
        data = json.loads((MODELS / 'animations/Lumine_idle.json').read_text())
        self.assertEqual(data['sourceSha256'], hashlib.sha256((MODELS / 'characters/Lumine.vrm').read_bytes()).hexdigest())
        expected_samples = round(data['duration'] * data['fps']) + 1
        self.assertGreater(len(data['tracks']), 20)
        for track in data['tracks']:
            values = track['values']
            self.assertEqual(len(values), expected_samples * 4)
            for start in range(0, len(values), 4):
                q = values[start:start+4]
                self.assertTrue(all(math.isfinite(v) for v in q))
                self.assertAlmostEqual(sum(v*v for v in q), 1, places=4)
            dot = sum(a*b for a,b in zip(values[:4], values[-4:]))
            self.assertAlmostEqual(abs(dot), 1, places=4)

    def test_default_routes_use_classified_assets(self):
        avatar = asyncio.run(vrm_server.default_avatar())
        idle = asyncio.run(vrm_server.default_idle())
        self.assertEqual(Path(avatar.path).resolve(), (MODELS / 'characters/Lumine_companion.vrm').resolve())
        self.assertEqual(Path(idle.path).resolve(), (MODELS / 'animations/Lumine_idle.json').resolve())
        self.assertTrue(Path(avatar.path).is_file())
        self.assertTrue(Path(idle.path).is_file())
