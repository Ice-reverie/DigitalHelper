# 人物与动作资源

- `characters/`：3D 人物。`Lumine.vrm` 是原始文件，仅移动目录；`Lumine_companion.vrm` 是网页默认版本，增加双眼眨眼、元音口型和视线角度配置，原几何、贴图二进制数据保持不变。
- `animations/`：动作。`Lumine_idle.blend` 是通过 Blender MCP 制作的可编辑工程，打开 `DigitalHelper_Idle` 场景，按空格预览。`Lumine_idle.json` 是网页读取的采样动作数据，8 秒循环、30 FPS，16 个人形骨骼及 75 个头发/衣服骨骼轨道。
- `animations/build_idle.py`：Blender 制作与导出脚本。需要先使用 VRM 插件导入原始人物，骨架名为 `Armature`、脸部网格名为 `U_Char_1`；在 Blender 中执行，输出上述工程、采样动作和适配人物副本。

头发与衣服使用骨骼关键帧摆动，不是实时布料碰撞模拟。网页端对四元数进行球面插值；眨眼由独立计时器每约 2.2–4.8 秒触发，保证播放其他动作时仍可眨眼。

眼睛响应鼠标/触摸在屏幕中的位置，平滑跟随，离开窗口或结束触摸后回正。未启用摄像头或真人追踪。开启“减少动态”会暂停待机骨骼动画，并让视线回到正前方；眨眼保留。

默认资源通过 `/api/avatar` 和 `/api/animations/idle` 读取。JSON 轨道中的 `bone` 表示 VRM 标准化骨骼绝对旋转，`node` 表示原模型节点相对初始局部旋转的增量，仅用于匹配的 Lumine 模型；上传其他人物不会套用这组专属轨道。
