"""Runtime assets must be the reviewed exports, with shared stance and free lip sync."""
import math
import unittest

import test_greet_assets as assets


class HealthIdleTests(unittest.TestCase):
    ASSET = 'Idle_Doctor.vrma'
    FRAME_COUNT = 241
    DURATION = 8
    REVIEW_ASSET = 'Idle_Doctor.vrma'
    setUpClass = classmethod(assets.GreetAssetTests.setUpClass.__func__)

    def test_runtime_is_reviewed_export_with_closed_timing(self):
        self.assertEqual((assets.ROOT/self.ASSET).read_bytes(),
                         (assets.ROOT/'review_health'/self.REVIEW_ASSET).read_bytes())
        self.assertTrue(all(len(t) == self.FRAME_COUNT and t[0][0] == 0
                            and t[-1][0] == self.DURATION for t in self.times))
        for values in self.channels.values():
            self.assertTrue(all(math.isfinite(v) for row in values for v in row))
            self.assertLess(max(abs(a-b) for a, b in zip(values[0], values[-1])), 1e-6)

    def test_grounded_stance_and_expression_ownership(self):
        for name in ('hips', 'leftFoot', 'rightFoot', 'leftToes', 'rightToes'):
            self.assertLess(max(math.dist(f[name][0], self.world[0][name][0])
                                for f in self.world), .0001)
        presets = self.ext['expressions']['preset']
        self.assertTrue({'blink', 'happy'} <= presets.keys())
        self.assertFalse({'aa', 'ih', 'ou', 'ee', 'oh'} & presets.keys())


class HealthExplainTests(HealthIdleTests):
    ASSET = 'explain_1.vrma'
    FRAME_COUNT = 301
    DURATION = 10
    REVIEW_ASSET = 'Explain_Gentle.vrma'

    def test_common_stance_and_right_hand_gesture(self):
        HealthIdleTests.setUpClass()
        for name in self.human:
            self.assertLess(math.dist(self.world[0][name][0],
                                      HealthIdleTests.world[0][name][0]), .00001)
            dot = sum(a*b for a, b in zip(self.world[0][name][1],
                                         HealthIdleTests.world[0][name][1]))
            self.assertAlmostEqual(abs(dot), 1, places=4)
        self.assertGreater(max(math.dist(f['rightHand'][0], self.world[0]['rightHand'][0])
                               for f in self.world), .15)
