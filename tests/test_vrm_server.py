import unittest

from vrm_demo.vrm_server import build_reply, split_sentence


class DemoConversationTests(unittest.TestCase):
    def test_health_query_has_safety_boundary(self):
        result = build_reply("我最近总是头晕")
        self.assertEqual(result["action"], "explain")
        self.assertIn("不能替代医生诊断", result["reply"])
        self.assertIn("查看健康预警", result["quick_replies"])

    def test_alert_can_be_confirmed(self):
        alert = build_reply("查看健康预警")
        self.assertEqual(alert["context"].get("flow"), "alert")
        confirmed = build_reply("我已确认", alert["context"])
        self.assertEqual(confirmed["action"], "confirm")
        self.assertEqual(confirmed["context"], {})
        self.assertIn("已确认", confirmed["reply"])

    def test_appointment_flow_requires_final_confirmation(self):
        start = build_reply("帮我预约门诊")
        department = build_reply("康复科", start["context"])
        appointment_time = build_reply("明天上午", department["context"])
        self.assertEqual(appointment_time["context"].get("step"), "final_confirm")
        self.assertIn("不会向医院真实提交预约", appointment_time["reply"])

        confirmed = build_reply("确认预约", appointment_time["context"])
        self.assertEqual(confirmed["context"], {})
        self.assertIn("模拟预约", confirmed["reply"])
        self.assertIn("康复科", confirmed["reply"])

    def test_reselect_appointment_returns_to_department(self):
        context = {
            "flow": "appointment",
            "step": "final_confirm",
            "department": "内科",
            "time": "明天上午",
        }
        result = build_reply("重新选择", context)
        self.assertEqual(result["context"].get("step"), "department")
        self.assertIn("体检中心", result["quick_replies"])

    def test_sentence_split_keeps_punctuation(self):
        self.assertEqual(split_sentence("您好！请坐下休息。"), ["您好！请坐下休息。"])


if __name__ == "__main__":
    unittest.main()
