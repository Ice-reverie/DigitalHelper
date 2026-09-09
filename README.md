# 数字人交互系统

> 拟人化三维数字人 + 自然语音交互系统（课程作业项目）

## 项目简介

本项目是一个基于 Web 的数字人交互系统：用户可以通过语音或文字自然地完成健康查询、健康预警确认和服务预约演示。浏览器可按需加载 VRM 格式的三维虚拟人模型；模型尚未完成时，业务对话、语音输入与语音播报仍可独立使用。系统不会接入真实大模型、医院或消息服务，回复和业务步骤均由本地规则驱动。

本项目拥有"对话 + 语音合成"的服务能力，展示层采用「Three.js + three-vrm 三维渲染」的方案，使数字人具备可更换的 3D 形象、口型同步与肢体动作能力。

## 功能特性

- **VRM 模型加载**：通过网页文件选择器加载本地 `.vrm` 三维模型，支持随时更换，鼠标旋转缩放查看。
- **内置人物切换**：「帮助与设置 → 演示人员设置」可选择当前 8 个模型，切换时自动调整全身视角，并适配待机、口型和标准骨骼动作；原始模型文件保持不变。
- **自然语音交互**：浏览器语音识别或文字输入 → 规则式问答 → 语音播报。
- **完整演示流程**：健康查询、预警确认、分步预约均可在未加载模型时体验。
- **适老化界面**：大字号、大点击区域、高对比度、明确状态反馈与快捷选项。
- **口型同步**：优先结合 Rhubarb 时间轴和音频能量驱动嘴型；时间轴缺失时使用音量驱动的元音轮换，浏览器播报时使用近似口型动画。
- **拟人化表情**：自动眨眼、静默时头部微动、说话时轻微点头。
- **肢体动作**：一键「打招呼」挥手；支持加载 `.vrma` 动作文件手动播放。
- **关键词触发动作**：对话命中预设关键词时，自动加载并播放对应 `.vrma` 动作（greet / booking / alert / confirm / thanks / explain）。
- **业务问答**：内置健康查询、预警确认、预约挂号、服务咨询、问候、致谢等意图。

## 技术栈

| 层次 | 技术 |
|------|------|
| 前端 | HTML5 / CSS3 / JavaScript (ES6+) |
| 3D 渲染 | Three.js 0.180.0（WebGL） |
| 模型加载 | @pixiv/three-vrm 3.5.5 |
| 动作加载 | @pixiv/three-vrm-animation + AnimationMixer |
| 语音输入 | Web Speech API（不支持时保留文字输入） |
| 音频处理 | Web Audio API（AnalyserNode） |
| 后端框架 | FastAPI + Uvicorn |
| 语音合成 | edge-tts（微软 Azure 神经网络语音） |

## 系统架构

前后端分离的 B/S 架构。服务端负责对话与语音合成，前端负责三维渲染、口型驱动与交互。

    浏览器（Three.js + three-vrm 渲染 VRM / 口型动画 / 交互）
        │  HTTP (JSON) + 静态资源
    服务端（FastAPI）
        ├── /static/*   静态页面与脚本托管
        └── /api/chat   对话 + 动作匹配 + 语音合成接口

## 环境要求

- 操作系统：Windows 10/11
- Python 3.12（推荐 Anaconda）
- 现代浏览器（支持 ES Module、Import Map、WebGL2）
- 网络：前端库和 edge-tts 在线语音需要网络；edge-tts 不可用时自动使用浏览器语音播报

## 安装与运行

Windows 下双击根目录的 `run.cmd` 即可启动，也可在终端执行。脚本依次查找项目的 `.venv`、`venv`、`env`、`virtualenv`，随后检查已激活的虚拟环境；没有时使用全局 `python` 或 `py -3`。缺少依赖时会提示安装命令，不会自动安装。`run.cmd --check` 仅检查并显示所选 Python，不启动服务。

```bash
# 1. 安装依赖
pip install fastapi uvicorn pydantic edge-tts

# 2. 在项目根目录启动服务
python vrm_demo/vrm_server.py

# 3. 浏览器打开
# http://localhost:8890/
```

> 提示：若系统存在多个 Python 解释器，请使用实际安装依赖的解释器（例如 `D:\anaconda\python.exe`）。

## 使用说明

1. 打开页面后，可直接点击「开始说话」（不用按住），或在输入框中输入需求；顶部「放大文字」可切换大字号。
   - 示例：「我最近头晕」「查看健康预警」「帮我预约门诊」。
2. 使用回复下方的大按钮完成预警确认、选择科室、选择时间和最终确认；预约任意步骤都可选择或输入「取消预约」。
3. 页面自动加载`models/characters/Lumine_companion.vrm`（原始模型保存在同目录的 `Lumine.vrm`），按人物尺寸适配正面全身；鼠标左键拖动可旋转，Shift + 左键拖动可平移，滚轮可缩放；点「恢复全身」回到默认视角。若需更换形象，在「演示人员设置」中选择其他 `.vrm` 文件。
4. 可继续选择本地 `.vrma` 动作，七个场景动作统一放在 `models/animations/`，使用 `场景_序号.vrma` 命名。每次回复从同场景版本中随机选择；有多个版本时避免连续播放同一版本。添加版本后刷新页面即可使用。
5. 若当前浏览器不支持语音识别，页面会明确提示，文字输入仍可正常使用。
6. 「问问健康」「查看提醒」「预约服务」无需打字即可使用；点击另一项常用服务会切换到该服务的新流程。

> 说明：预警、联系家人和预约均为本地模拟流程，不会真实发送消息或向医院提交数据。

语音按句播放；某句在线合成或播放失败时，使用浏览器语音补播该句，再继续下一句。后端最多并发处理 3 个句子，单句在线合成超过 15 秒会降级。口型时间轴需要额外安装 `av` 并使用仓库内的 Rhubarb 工具；缺少这些组件不影响文字对话和备用口型。

## 开发验证与旧素材工具

```bash
python -B -m unittest discover -s tests -v
node --test tests/test_vrm_frontend.cjs
```

素材处理测试需要 `numpy` 和 `opencv-python`。前端测试使用 Node 内置测试运行器及浏览器 API 替身，不需要安装 npm 包；真实麦克风、在线 TTS 和模型显示仍需浏览器实测。

旧视频素材入口为 `app.py`（需要 Gradio），命令行入口为 `python data_preparation_mini.py 输入视频 输出目录`。脚本输出 `data/processed.mp4` 和逐帧对齐的 `data/processed.pkl`，供 `data_preparation_web.py` 继续生成 Web 素材。它使用 FFmpeg、OpenCV、NumPy、PyTorch，以及 `checkpoint/scrfd_2.5g_kps.onnx` 和 `checkpoint/face_landmarker_256x256.pt`；后续 Web 素材生成另需 DINet 模型权重。可选 `--matting` 沿用 RVM，额外需要 RobustVideoMatting、相关依赖、CUDA 和 `checkpoint/rvm_resnet50.pth`。这些权重和环境依赖不随修复补入仓库。

素材脚本仅清理本次创建的临时帧目录，异常退出也会清理，不删除用户已有的 `frames` 目录。

### 动作文件命名约定

| 文件名 | 触发关键词 |
|--------|-----------|
| `greet_1.vrma` | 你好 / 您好 / 嗨 / 在吗 / hello |
| `booking_1.vrma` | 预约 / 挂号 / 门诊 |
| `thanks_1.vrma` | 谢谢 / 感谢 / 辛苦 |
| `explain_1.vrma`、`explain_2.vrma` | 健康 / 不舒服 / 症状 / 头晕 / 头疼 / 血压 / 血糖 / 失眠 |
| `alert_1.vrma` | 预警 / 异常 / 提醒 |
| `confirm_1.vrma` | 确认 / 知道了 / 联系家人 |

动作文件缺失不影响对话功能，仅不播放动作。

## 项目结构

    vrm_demo/
    ├── vrm_server.py           # FastAPI 服务端（对话 + TTS + 动作匹配 + 静态托管）
    └── static/
        ├── VRMCharacter.html   # 主页面
        └── js/
            └── VRMCharacter.js # 渲染、口型、表情、动作、交互逻辑
    models/
    ├── characters/             # VRM 人物
    └── animations/             # 场景_序号.vrma、待机及配套摆动数据
    docs/
    ├── 需求定义书.md            # 需求定义书
    └── 技术设计文档.md          # 技术设计文档

（本系统核心为 `vrm_demo/` 目录。）

## 相关文档

- [可选大模型配置与规则回退](docs/model-integration.md)
- [需求定义书](docs/需求定义书.md)
- [技术设计文档](docs/技术设计文档.md)

数字人资源分类与 Blender 待机工程说明见 [models/README.md](models/README.md)。页面自动读取 Blender 导出的 8 秒待机动作，支持头发/衣服摆动、自然站姿、自动眨眼及鼠标/触摸视线跟随。
