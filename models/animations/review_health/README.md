# 安心健康助手 · 新动作审核版 V2

基于项目当前默认的 `models/characters/schoolBoy.vrm`，使用 Blender 5.2.1 LTS 与本机现有 VRM 插件制作。模型网格、外观、材质、原始骨架和 `T-Pose` 保留；本目录保留审核工程和证据；用户确认后，V2 导出已接入正式网页。

**V2 已修正右肘袖管扭转塌陷和叠手姿态折腕过大的问题。** 调整手臂旋转分配、手腕方向及分离／回收路径，保留原网格、权重和骨架。参见 [修正前后对比](joint_compare.html) 与 [V2 关节检查](joint_audit_v2/README.md)。V2 已作为网页默认待机与讲解动作，审核页继续保留对照预览。

`previous_v1/` 保存修改前的 Blender 工程、动画导出、视频和生成脚本；`joint_audit/` 保留第一版问题证据，不能视为当前版本结论。

## 交付

| Action | 帧率 | 单次时长 | 实际播放帧 | 闭合关键帧 |
|---|---|---|---|---|
| `Idle_Doctor` | 30 fps / Base 1 | 8 秒 | F1–F240 | F241 = F1 |
| `Explain_Gentle` | 30 fps / Base 1 | 10 秒 | F1–F300 | F301 = F1 |

- `Anxin_Health_Actions.blend`：两个独立、可编辑的 Action，已打包贴图。当前打开为待机 F1。
- `Idle_Doctor.vrma` / `Explain_Gentle.vrma`：动画片段，保留 0–8 秒 / 0–10 秒时间戳终点。
- `Idle_Doctor_3loops.mp4` / `Explain_Gentle_3loops.mp4`：正面与前侧 45° 同屏，分别连续播放三个周期。
- `Transition_10f_preview.mp4`：实际 NLA 10 帧混合，待机 → 讲解 → 待机。
- `review.html`：本地独立审核页，支持动作选择、拖动进度和半速播放。

## 动作与绑定

先检查了实际 VRM0 人形映射、骨骼局部轴、约束、形态键和材质。原骨架是 FK 结构，无 IK 控制器或约束；使用现有骨骼生成关键帧，没有替换绑定。原始检查见 `rig-inspection.json`。

两个动作共享腹前叠手姿态，左手托住、右手轻搭。双脚略窄于肩宽，骨盆恒定，脚骨和脚趾骨全程固定。地面按实际鞋底表面放置。呼吸由脊柱、胸部与肩部的小幅旋转完成，叠手随胸部一起移动。

讲解动作包含手掌分离、抬手、第一次向前展开、轻微点头、停顿、较小的向外补充手势、回收和落手。V2 调整为斜向上的开放手掌，将旋转分配到上臂和前臂，并对手腕折角做平滑限制，避免旋转集中于肘部。放慢翻掌与回收，重新校正右手离开、返回左手的间隙。

眨眼使用已有 `Fcl_EYE_Close` 形态键；微笑使用已有 `Fcl_MTH_Up`，强度 0.12。两者由骨架自定义属性驱动。VRMA 映射到 `blink` / `happy`，没有加入发音口型。

## Blender 中检查

1. 打开工程，选择 `Armature`，在 Dope Sheet → Action Editor 选择 `Idle_Doctor` 或 `Explain_Gentle`。
2. 单次播放范围设为 1–240 或 1–300；三个周期设为 1–720 或 1–900。所有新增 F-Curve 已带 Cycles 修饰器。
3. `Review_Front`、`Review_45`、`Review_Hands` 分别用于正面、45° 和手部近景检查。
4. F241 / F301 是闭合关键帧，仅用于曲线连接和带时间戳的导出。视频没有把闭合帧额外重复渲染。

## 检查证据与范围

- `validation.json`：每半帧检查固定根节点、骨盆、脚和脚趾，以及首尾姿态、共同基础姿态、曲线接缝导数。两动作相关误差均为零。
- 对实际变形后的手与手、手与躯干表面做三角面相交检查。全程每 6 帧取样，分离和回收阶段额外逐帧检查，采样中未发现穿插。这是有限采样，不等同于所有网格连续碰撞证明。
- `vrma_roundtrip.json`：在独立 Blender 进程中回导两个 VRMA，比较骨骼位置、角度、时间戳和表情映射；位置误差小于 1 mm，角度误差小于 0.25°。
- `joint_audit_v2/measurements.json`：逐整数帧检查腕部折角、前臂轴向旋转和相邻帧旋转变化；配合正面、侧面、背面及手部近景实渲图复核。共同叠手姿态的左／右腕折角从约 66°／68° 降至 23°／27°，讲解右腕最大折角约 30°。
- `iteration_review.json`：本轮修改范围、前后证据和验收记录。
- `render-manifest.json`：实际预览分辨率、帧率、循环数量和编码信息。
- 正式网页使用 `../Idle_Doctor.vrma` 与 `../explain_1.vrma`，两者与本目录 V2 导出逐字节一致。运行时适配、切换、口型及回归验证记录见 `runtime-integration.json`。

## 复现

脚本位于项目 `tools/animation_authoring/`，路径从脚本位置解析。以下命令在项目根目录执行，`blender` 替换为本机 Blender 可执行文件：

```text
blender -b models/animations/review_health/Anxin_Health_Actions.blend --python-exit-code 1 --python tools/animation_authoring/build_health_review.py
blender -b models/animations/review_health/Anxin_Health_Actions.blend --python-exit-code 1 --python tools/animation_authoring/validate_health_review.py
blender -b models/animations/review_health/Anxin_Health_Actions.blend --python-exit-code 1 --python tools/animation_authoring/audit_health_joints.py
blender -b models/animations/review_health/Anxin_Health_Actions.blend --python-exit-code 1 --python tools/animation_authoring/export_health_review.py
blender -b models/animations/review_health/Anxin_Health_Actions.blend --python-exit-code 1 --python tools/animation_authoring/check_health_vrma.py
blender -b models/animations/review_health/Anxin_Health_Actions.blend --python-exit-code 1 --python tools/animation_authoring/render_health_review.py
python tools/animation_authoring/encode_health_review.py
```

依赖：Blender 5.2、现有 VRM 插件；视频编码脚本使用 `imageio-ffmpeg`。渲染序列只写入已忽略的 `output/health_animation_render_final/`，交付视频生成后可清理。
