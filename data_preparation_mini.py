import base64
import io
import mimetypes
import os
import re
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


app = FastAPI(title="安心健康助手")

mimetypes.add_type("text/javascript", ".js")
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
app.mount("/static", StaticFiles(directory=os.path.join(BASE_DIR, "static")), name="static")

TTS_VOICE = "zh-CN-XiaoxiaoNeural"
DEPARTMENTS = ["内科", "外科", "康复�?", "体检中心"]
APPOINTMENT_TIMES = ["明天上午", "明天下午", "后天上午"]

ACTION_RULES = [
    (["预警", "异常", "提醒"], "alert"),
    (["确认", "知道�?", "联系家人"], "confirm"),
    (["你好", "您好", "�?", "在吗", "hello"], "greet"),
    (["预约", "挂号", "门诊"], "booking"),
    (["谢谢", "感谢", "辛苦"], "thanks"),
    (["健康", "不舒�?", "症状", "头晕", "头疼", "血�?", "血�?", "失眠"], "explain"),
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
    parts = re.split(r"([。！�?!?�?;\n])", text)
    sentences: List[str] = []
    current = ""
    for part in parts:
        if not part:
            continue
        current += part
        if re.search(r"[。！�?!?�?;\n]", part) and len(current) >= min_length:
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
        if any(word in message for word in ["已确�?", "知道�?", "确认"]):
            return _result(
                "好的，健康预警已在本次演示中标记为已确认。请留意身体变化，如有明显不适请及时就医�?",
                "confirm",
            )
        if "联系家人" in message:
            return _result(
                "好的，已模拟向家人发起联系提醒。演示系统不会真实发送消息�?",
                "confirm",
            )
        if any(word in message for word in ["稍后", "提醒�?"]):
            return _result(
                "好的，已模拟设置稍后提醒。演示系统不会真实创建通知�?",
                "confirm",
            )

    if flow == "appointment" and step == "department":
        department = next((item for item in DEPARTMENTS if item in message), "")
        if department:
            return _result(
                f"已选择{department}。您希望预约哪个时间�?",
                "booking",
                APPOINTMENT_TIMES,
                {"flow": "appointment", "step": "time", "department": department},
            )
        return _result(
            "我还没有听清科室。请选择内科、外科、康复科或体检中心�?",
            "booking",
            DEPARTMENTS,
            state,
        )

    if flow == "appointment" and step == "time":
        appointment_time = next((item for item in APPOINTMENT_TIMES if item in message), "")
        if appointment_time:
            department = state.get("department", "所选科�?")
            return _result(
                f"请确认：{department}，{appointment_time}。这是流程演示，不会向医院真实提交预约�?",
                "booking",
                ["确认预约", "重新选择", "取消预约"],
                {
                    "flow": "appointment",
                    "step": "final_confirm",
                    "department": department,
                    "time": appointment_time,
                },
            )
        return _result("请选择一个预约时间�?", "booking", APPOINTMENT_TIMES, state)

    if flow == "appointment" and step == "final_confirm":
        if "重新" in message:
            return _result(
                "好的，请重新选择科室�?",
                "booking",
                DEPARTMENTS,
                {"flow": "appointment", "step": "department"},
            )
        if "取消" in message:
            return _result("本次模拟预约已取消。您还可以继续咨询其他服务�?", "confirm")
        if "确认" in message:
            department = state.get("department", "所选科�?")
            appointment_time = state.get("time", "所选时�?")
            return _result(
                f"已完成模拟预约：{department}，{appointment_time}。演示系统未连接医院，不会产生真实挂号记录�?",
                "confirm",
            )
        return _result(
            "请确认预约、重新选择，或取消预约�?",
            "booking",
            ["确认预约", "重新选择", "取消预约"],
            state,
        )

    if any(word in message for word in ["预警", "异常提醒", "风险提醒"]):
        return _result(
            "发现一条模拟健康预警：今天上午的血压记录偏高。您可以确认已知晓、联系家人，或稍后提醒�?",
            "alert",
            ["我已确认", "联系家人", "稍后提醒"],
            {"flow": "alert", "step": "confirm"},
        )

    if any(word in message for word in ["预约", "挂号", "门诊"]):
        return _result(
            "好的，我们先选择科室。这是本地流程演示，不会连接医院或真实挂号�?",
            "booking",
            DEPARTMENTS,
            {"flow": "appointment", "step": "department"},
        )

    if any(word in message for word in ["健康", "不舒�?", "症状", "头晕", "头疼", "血�?", "血�?", "失眠"]):
        return _result(
            "我已记录您的描述。请先坐下休息并补充水分；如果症状持续、加重，或伴随胸痛、呼吸困难等情况，请尽快联系家人并及时就医。本演示不能替代医生诊断�?",
            "explain",
            ["查看健康预警", "预约门诊"],
        )

    if any(word in message for word in ["服务", "咨询", "项目"]):
        return _result(
            "我可以演示健康查诀��预警确认和服务预约。您想先体验哪一项？",
            "explain",
            ["健康查询", "查看健康预警", "预约门诊"],
        )

    if any(word in message.lower() for word in ["你好", "您好", "�?", "在吗", "hello"]):
        return _result(
            "您好，我是安心健康助手。您可以直接说出需求，我能演示健康查询、预警确认和服务预约�?",
            "greet",
            ["健康查询", "查看健康预警", "预约门诊"],
        )

    if any(word in message for word in ["谢谢", "感谢", "辛苦"]):
        return _result("不客气。祝您平安健康，有需要可以继续告诉我�?", "thanks")

    return _result(
        "我可以帮助您演示健康查询、预警确认和服务预约。请直接说出您想办理的事情�?",
        quick_replies=["健康查询", "查看健康预警", "预约门诊"],
    )


def llm_reply(text: str) -> str:
    """Compatibility wrapper: replies are rule-driven and do not use an LLM."""
    return build_reply(text)["reply"]


async def tts_to_mp3(text: str) -> bytes:
    if edge_tts is None:
        return b""
    communicate = edge_tts.Communicate(text, TTS_VOICE)
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
        try:
            audio = await tts_to_mp3(sentence)
            audio_base64 = base64.b64encode(audio).decode("utf-8") if audio else ""
        except Exception as error:
            print("tts error:", error)
            audio_base64 = ""
        segments.append({"text": sentence, "audio": audio_base64})
    return {
        **result,
        "segments": segments,
        "tts_available": edge_tts is not None,
    }


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8890)
            encode_binary_pixels(final_bgr, vid_width, modulo_value)

            cv2.imwrite(os.path.join(data_dir, f"{frame_index:06d}.png"), final_bgr)

            if reverse_option:
                frame_count_inverse = total_frames * 2 - frame_index - 1
                modulo_value = frame_count_inverse % MODULO_N
                encode_binary_pixels(final_bgr, vid_width, modulo_value)
                cv2.imwrite(os.path.join(data_dir, f"{frame_count_inverse:06d}.png"), final_bgr)

        # 保存关键�?
        with open(output_pkl_path, "wb") as f:
            pickle.dump(pts_3d, f)
            
        pts_3d = pts_3d.reshape(len(pts_3d), -1)
        smooth_array_ = smooth_array(pts_3d, weight=[0.01, 0.08, 0.82, 0.08, 0.01])
        pts_3d = smooth_array_.reshape(len(pts_3d), 478, 3)
        
        fps = 25
        crf = 18
        ffmpeg_cmd = [
            'ffmpeg', '-y',
            '-framerate', str(fps),
            '-i', os.path.join(data_dir, '%06d.png'),
            '-c:v', 'libx264',
            '-preset', 'medium',
            '-crf', str(crf),
            '-pix_fmt', 'yuv420p',
            output_video_path
        ]
        result = subprocess.run(
            ffmpeg_cmd,
            capture_output=True,
            text=True,
            creationflags=subprocess.CREATE_NO_WINDOW
        )
    return total_frames


def prepare_video(
        input_path: str,
        output_path: str,
        resize_option: bool = False
) -> int:
    if resize_option:
        cap = cv2.VideoCapture(input_path)
        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        rotate_code = int(cap.get(cv2.CAP_PROP_ORIENTATION_META))
        print(f"video info: width-{width} height-{height} rotate_code-{rotate_code}")
        if rotate_code == 90 or rotate_code == 270:
            width, height = height, width
        scale = min(720 / width, 1280 / height)
        new_width = int(width * scale)
        new_height = int(height * scale)
        # 确保新的宽高为偶�?
        new_width = new_width //2*2
        new_height = new_height //2*2
        cap.release()
        vf_arg = f"scale={new_width}:{new_height}"
        cmd = [
            "ffmpeg", "-i", input_path,
            "-vf", vf_arg,
            "-r", "25", '-f', 'image2', "-y", os.path.join(output_path, '%06d.png')
        ]
    else:
        cmd = [
            "ffmpeg", "-i", input_path,
            "-r", "25", '-f', 'image2', "-y", os.path.join(output_path, '%06d.png')
        ]

    print("ffmpeg cmd: ", cmd)
    # Run the command
    subprocess.run(cmd, check=True)

    # Count the number of frames generated
    frame_count = len([f for f in os.listdir(output_path) if f.endswith('.png')])
    return frame_count



def data_preparation_mini(input_video, video_dir_path, matting = False, resize_option = False, reverse_option = True):
    # 检测系统环境是否有ffmpeg
    if not shutil.which("ffmpeg"):
        raise EnvironmentError("FFmpeg未安装或不在PATH中，请安装ffmpeg并设置为环境变量")

    # 创建输出目录
    data_dir = os.path.join(video_dir_path, "data")
    os.makedirs(data_dir, exist_ok=True)

    frames_png_dir = os.path.join(video_dir_path, "frames")
    os.makedirs(frames_png_dir, exist_ok=True)

    frame_count = prepare_video(input_video, frames_png_dir, resize_option = resize_option)

    # 提取关键�?
    output_pkl_path = os.path.join(data_dir, "processed.pkl")
    output_video_path = os.path.join(data_dir, "processed.mp4")
    extract_from_video(frames_png_dir, output_pkl_path, output_video_path, matting, reverse_option)
    shutil.rmtree(frames_png_dir)
    result = {
        "status": "success",
        "frame_count": frame_count,
        "output_video": output_video_path
    }
    return result


def main():
    parser = argparse.ArgumentParser(description='视频人脸关键点提取工�?')
    parser.add_argument('input_video', type=str, help='输入视频文件路径')
    parser.add_argument('output_dir', type=str, help='输出文件夹位�?')
    parser.add_argument('--matting', action='store_true',
                        help='启用抠图功能（默认：禁用�?')
    parser.add_argument('--resize', action='store_true',
                        help='启用视频缩放功能（默认：禁用�?')

    # 解析参数
    args = parser.parse_args()

    print(f"输入视频: {args.input_video}")
    print(f"输出目录: {args.output_dir}")
    print(f"抠图功能: {'启用' if args.matting else '禁用'}")
    print(f"缩放功能: {'启用' if args.resize else '禁用'}")

    # 调用处理函数
    data_preparation_mini(
        args.input_video,
        args.output_dir,
        matting=args.matting,
        resize_option=args.resize,
        reverse_option=True  # 反向帧生成默认启�?
    )
    print("处理完成!")

if __name__ == "__main__":
    main()
