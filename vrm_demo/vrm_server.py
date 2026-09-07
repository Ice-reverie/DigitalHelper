import base64
import io
import json
import mimetypes
import os
import re
import subprocess
import tempfile
import wave
from typing import Dict, List

import uvicorn
from fastapi import FastAPI
from fastapi.responses import RedirectResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

try:
    import edge_tts
except ImportError:  # Browser speech synthesis remains available as a fallback.
    edge_tts = None

try:
    from pypinyin import lazy_pinyin
except ImportError:
    lazy_pinyin = None

try:
    import av
except ImportError:
    av = None


app = FastAPI(title="安心健康助手")

mimetypes.add_type("text/javascript", ".js")
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
app.mount("/static", StaticFiles(directory=os.path.join(BASE_DIR, "static")), name="static")

TTS_VOICE = "zh-CN-XiaoxiaoNeural"
DEPARTMENTS = ["内科", "外科", "康复科", "体检中心"]
APPOINTMENT_TIMES = ["明天上午", "明天下午", "后天上午"]

ACTION_RULES = [
    (["预警", "异常", "提醒"], "alert"),
    (["确认", "知道了", "联系家人"], "confirm"),
    (["你好", "您好", "嗨", "在吗", "hello"], "greet"),
    (["预约", "挂号", "门诊"], "booking"),
    (["谢谢", "感谢", "辛苦"], "thanks"),
    (["健康", "不舒服", "症状", "头晕", "头疼", "血压", "血糖", "失眠"], "explain"),
]

VOWEL_TO_VISEME = {
    'a': 'aa', 'ai': 'aa', 'ao': 'aa', 'an': 'aa', 'ang': 'aa',
    'ia': 'aa', 'iao': 'aa', 'ian': 'aa', 'iang': 'aa',
    'ua': 'aa', 'uai': 'aa', 'uan': 'aa', 'uang': 'aa',
    'i': 'ih', 'in': 'ih', 'ing': 'ih',
    'u': 'ou', 'un': 'ou', 'uo': 'ou', 'ui': 'ou',
    'e': 'ee', 'ei': 'ee', 'en': 'ee', 'eng': 'ee', 'er': 'ee', 'ie': 'ee',
    'o': 'oh', 'ou': 'oh', 'ong': 'oh', 'iong': 'oh',
    'v': 'ou', 've': 'ou', 'vn': 'ou',
}

_VOWEL_KEYS = ['iang', 'iong', 'uang', 'ing', 'eng', 'ong', 'ian', 'uan', 'iao', 'uai',
               'ang', 'an', 'en', 'in', 'un', 'ai', 'ei', 'ao', 'ou', 'ie', 've', 'vn',
               'er', 'ua', 'uo', 'ui', 'a', 'o', 'e', 'i', 'u', 'v']


def pinyin_to_viseme(pinyin_str):
    if not pinyin_str or lazy_pinyin is None:
        return 'aa'
    p = re.sub(r'[1-4]', '', pinyin_str.lower().strip())
    for vowel in _VOWEL_KEYS:
        if p.endswith(vowel):
            return VOWEL_TO_VISEME.get(vowel, 'aa')
    return 'aa'


def text_to_visemes(text):
    if lazy_pinyin is None:
        return []
    return [pinyin_to_viseme(p) for p in lazy_pinyin(text)]


def _find_rhubarb():
    tools_dir = os.path.join(BASE_DIR, "tools")
    for root, _dirs, files in os.walk(tools_dir):
        if "rhubarb.exe" in files and os.path.isdir(os.path.join(root, "res")):
            return os.path.join(root, "rhubarb.exe")
    return os.path.join(tools_dir, "rhubarb.exe")


RHUBARB_PATH = _find_rhubarb()

RHUBARB_TO_VISEME = {
    'A': None, 'B': 'ih', 'C': 'ee', 'D': 'aa',
    'E': 'oh', 'F': 'ou', 'G': 'ih', 'H': 'aa', 'X': None,
}


def mp3_to_wav(mp3_bytes, wav_path):
    if av is None:
        raise RuntimeError("PyAV not available")
    container = av.open(io.BytesIO(mp3_bytes))
    stream = container.streams.audio[0]
    resampler = av.AudioResampler(format='s16', layout='mono', rate=16000)
    pcm = bytearray()
    for frame in container.decode(stream):
        for f in resampler.resample(frame):
            pcm.extend(f.to_ndarray().tobytes())
    container.close()
    with wave.open(wav_path, 'wb') as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(16000)
        wf.writeframes(bytes(pcm))


def rhubarb_analyze(wav_path):
    if not os.path.isfile(RHUBARB_PATH):
        return []
    try:
        result = subprocess.run(
            [RHUBARB_PATH, "-r", "phonetic", "-f", "json", "--consoleLevel", "fatal", wav_path],
            capture_output=True, text=True, timeout=10,
        )
        if result.returncode != 0:
            return []
        return json.loads(result.stdout).get("mouthCues", [])
    except Exception as error:
        print("rhubarb error:", error)
        return []


def build_viseme_timeline(mouth_cues):
    return [
        {"start": c["start"], "end": c["end"], "viseme": RHUBARB_TO_VISEME.get(c["value"])}
        for c in mouth_cues
    ]


class ChatRequest(BaseModel):
    text: str = Field(min_length=1, max_length=500)
    context: Dict[str, str] = Field(default_factory=dict)


def match_action(text: str):
    for keywords, name in ACTION_RULES:
        if any(keyword in text for keyword in keywords):
            return name
    return None


def split_sentence(text: str, min_length: int = 6) -> List[str]:
    parts = re.split(r"([。！？!?；;\n])", text)
    sentences: List[str] = []
    current = ""
    for part in parts:
        if not part:
            continue
        current += part
        if re.search(r"[。！？!?；;\n]", part) and len(current) >= min_length:
            sentences.append(current.strip())
            current = ""
    if current.strip():
        sentences.append(current.strip())
    return [sentence for sentence in sentences if sentence]


def _result(reply, action=None, quick_replies=None, context=None):
    return {
        "reply": reply,
        "action": action,
        "quick_replies": quick_replies or [],
        "context": context or {},
    }


def build_reply(text: str, context: Dict[str, str] | None = None):
    """Return a deterministic demo response without calling an LLM or hospital system."""
    message = text.strip()
    state = dict(context or {})
    flow = state.get("flow")
    step = state.get("step")

    if flow == "alert":
        if any(word in message for word in ["已确认", "知道了", "确认"]):
            return _result(
                "好的，健康预警已在本次演示中标记为已确认。请留意身体变化，如有明显不适请及时就医。",
                "confirm",
            )
        if "联系家人" in message:
            return _result(
                "好的，已模拟向家人发起联系提醒。演示系统不会真实发送消息。",
                "confirm",
            )
        if any(word in message for word in ["稍后", "提醒我"]):
            return _result(
                "好的，已模拟设置稍后提醒。演示系统不会真实创建通知。",
                "confirm",
            )

    if flow == "appointment" and step == "department":
        department = next((item for item in DEPARTMENTS if item in message), "")
        if department:
            return _result(
                f"已选择{department}。您希望预约哪个时间？",
                "booking",
                APPOINTMENT_TIMES,
                {"flow": "appointment", "step": "time", "department": department},
            )
        return _result(
            "我还没有听清科室。请选择内科、外科、康复科或体检中心。",
            "booking",
            DEPARTMENTS,
            state,
        )

    if flow == "appointment" and step == "time":
        appointment_time = next((item for item in APPOINTMENT_TIMES if item in message), "")
        if appointment_time:
            department = state.get("department", "所选科室")
            return _result(
                f"请确认：{department}，{appointment_time}。这是流程演示，不会向医院真实提交预约。",
                "booking",
                ["确认预约", "重新选择", "取消预约"],
                {
                    "flow": "appointment",
                    "step": "final_confirm",
                    "department": department,
                    "time": appointment_time,
                },
            )
        return _result("请选择一个预约时间。", "booking", APPOINTMENT_TIMES, state)

    if flow == "appointment" and step == "final_confirm":
        if "重新" in message:
            return _result(
                "好的，请重新选择科室。",
                "booking",
                DEPARTMENTS,
                {"flow": "appointment", "step": "department"},
            )
        if "取消" in message:
            return _result("本次模拟预约已取消。您还可以继续咨询其他服务。", "confirm")
        if "确认" in message:
            department = state.get("department", "所选科室")
            appointment_time = state.get("time", "所选时间")
            return _result(
                f"已完成模拟预约：{department}，{appointment_time}。演示系统未连接医院，不会产生真实挂号记录。",
                "confirm",
            )
        return _result(
            "请确认预约、重新选择，或取消预约。",
            "booking",
            ["确认预约", "重新选择", "取消预约"],
            state,
        )

    if any(word in message for word in ["预警", "异常提醒", "风险提醒"]):
        return _result(
            "发现一条模拟健康预警：今天上午的血压记录偏高。您可以确认已知晓、联系家人，或稍后提醒。",
            "alert",
            ["我已确认", "联系家人", "稍后提醒"],
            {"flow": "alert", "step": "confirm"},
        )

    if any(word in message for word in ["预约", "挂号", "门诊"]):
        return _result(
            "好的，我们先选择科室。这是本地流程演示，不会连接医院或真实挂号。",
            "booking",
            DEPARTMENTS,
            {"flow": "appointment", "step": "department"},
        )

    if any(word in message for word in ["健康", "不舒服", "症状", "头晕", "头疼", "血压", "血糖", "失眠"]):
        return _result(
            "我已记录您的描述。请先坐下休息并补充水分；如果症状持续、加重，或伴随胸痛、呼吸困难等情况，请尽快联系家人并及时就医。本演示不能替代医生诊断。",
            "explain",
            ["查看健康预警", "预约门诊"],
        )

    if any(word in message for word in ["服务", "咨询", "项目"]):
        return _result(
            "我可以演示健康查询、预警确认和服务预约。您想先体验哪一项？",
            "explain",
            ["健康查询", "查看健康预警", "预约门诊"],
        )

    if any(word in message.lower() for word in ["你好", "您好", "嗨", "在吗", "hello"]):
        return _result(
            "您好，我是安心健康助手。您可以直接说出需求，我能演示健康查询、预警确认和服务预约。",
            "greet",
            ["健康查询", "查看健康预警", "预约门诊"],
        )

    if any(word in message for word in ["谢谢", "感谢", "辛苦"]):
        return _result("不客气。祝您平安健康，有需要可以继续告诉我。", "thanks")

    return _result(
        "我可以帮助您演示健康查询、预警确认和服务预约。请直接说出您想办理的事情。",
        quick_replies=["健康查询", "查看健康预警", "预约门诊"],
    )


def llm_reply(text: str) -> str:
    """Compatibility wrapper: replies are rule-driven and do not use an LLM."""
    return build_reply(text)["reply"]


async def tts_to_mp3(text: str) -> bytes:
    if edge_tts is None:
        return b""
    communicate = edge_tts.Communicate(text, TTS_VOICE, rate="+15%")
    buffer = io.BytesIO()
    async for chunk in communicate.stream():
        if chunk["type"] == "audio":
            buffer.write(chunk["data"])
    return buffer.getvalue()


@app.get("/")
async def index():
    return RedirectResponse(url="/static/VRMCharacter.html")


@app.get("/api/health")
async def health():
    return {"status": "ok", "tts_available": edge_tts is not None}


@app.post("/api/chat")
async def chat(req: ChatRequest):
    result = build_reply(req.text, req.context)
    segments = []
    for sentence in split_sentence(result["reply"]):
        audio = b""
        try:
            audio = await tts_to_mp3(sentence)
        except Exception as error:
            print("tts error:", error)
        audio_base64 = base64.b64encode(audio).decode("utf-8") if audio else ""
        viseme_timeline = []
        if audio and av is not None:
            wav_path = None
            try:
                with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tf:
                    wav_path = tf.name
                mp3_to_wav(audio, wav_path)
                viseme_timeline = build_viseme_timeline(rhubarb_analyze(wav_path))
            except Exception as error:
                print("lipsync error:", error)
            finally:
                if wav_path and os.path.isfile(wav_path):
                    os.unlink(wav_path)
        segments.append({
            "text": sentence,
            "audio": audio_base64,
            "visemes": text_to_visemes(sentence),
            "visemeTimeline": viseme_timeline,
        })
    return {
        **result,
        "segments": segments,
        "tts_available": edge_tts is not None,
    }


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8890)
