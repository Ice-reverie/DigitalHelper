本目录用于存放数字人动作文件（.vrma 格式）

将制作好的动作文件按下列命名放到本目录，对话触发对应关键词时，数字人会自动播放该动作。

命名规则（文件名 = 动作名，扩展名必须为 .vrma）：

    greet.vrma    —— 触发词：你好 / 您好 / 嗨 / 在吗 / hello
    booking.vrma  —— 触发词：预约 / 挂号 / 门诊
    thanks.vrma   —— 触发词：谢谢 / 感谢 / 辛苦
    explain.vrma  —— 触发词：健康 / 不舒服 / 症状 / 头晕 / 头疼 / 血压 / 血糖 / 失眠

制作方法：
1. 在 Blender（安装 VRM Add-on）或 Unity（UniVRM）中为你的 VRM 模型制作动作；
2. 导出为 .vrma 文件；
3. 按上表命名，放入本目录。

提示：
- 动作文件缺失不影响对话，只是不播放动作，浏览器控制台会提示"动作文件未找到"。
- 修改关键词或动作名，可编辑后端 vrm_server.py 中的 ACTION_RULES，以及前端 VRMCharacter.js 中 playActionByName 的路径。