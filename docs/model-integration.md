# 可选大模型对话

默认无需配置：`/api/chat` 继续使用现有规则回复。前端请求和响应结构不变，模型回复同样经过语音合成、口型分析，`action` 交给现有场景动作播放器；连续动作去重和“减少动态”仍由前端处理。

## 后端配置

本版支持 OpenAI 兼容的 Chat Completions JSON 协议。协议参考：[请求格式](https://api-docs.deepseek.com/api/create-chat-completion/)、[JSON 输出](https://api-docs.deepseek.com/guides/json_mode/)。不包括 Responses、Anthropic 原生协议或任意请求模板；API Key 设置页面暂未加入。

安装可选客户端：`python -m pip install "httpx>=0.27,<1"`（也已列入 requirements.txt）。在启动项目的 PowerShell 中设置：

```powershell
$env:DIGITALHELPER_LLM_PROTOCOL = 'openai-compatible'
$env:DIGITALHELPER_LLM_BASE_URL = 'https://你的服务地址/v1'
$env:DIGITALHELPER_LLM_MODEL = '你的模型名'
$secret = Read-Host 'API Key' -AsSecureString
$env:DIGITALHELPER_LLM_API_KEY = [System.Net.NetworkCredential]::new('', $secret).Password
.\run.cmd
```

Base URL 填服务商文档要求的前缀，系统追加 `/chat/completions`；不要填完整接口路径。远程服务要求 HTTPS，本机 localhost/127.0.0.1/::1 支持 HTTP。配置只由服务端进程读取，不写入仓库、不返回前端。环境变量只影响从当前终端新启动的进程；已有服务需要重新启动。删除 Key 后重新启动即可恢复规则模式：`Remove-Item Env:DIGITALHELPER_LLM_API_KEY`。

`GET /api/health` 新增 `llm_configured`，仅表示配置完整且客户端可用，不表示网络或 Key 已验证。没有配置、配置缺项、不支持的协议或缺少 httpx 都使用规则模式。请求超时（总计15秒）、401/429/5xx、格式错误、拒答、无依据服务介绍及非法动作也回退规则；不在日志中记录 Key、用户原文或上游错误内容。

## 规则与动作边界

- 正在进行的预约、预警流程优先；模型不能更改 context、quick_replies，也不能执行操作。流程对应 booking/alert/confirm。
- 问候、感谢、眨眼继续使用固定回复及 greet/thanks/wink。
- 普通聊天可使用模型回复；服务介绍只能依据代码内 services/limits/controls 三项项目说明生成，并返回资料 ID，使用 explain 动作。
- 尚未引入审核过的医疗知识库。已有健康规则及医疗关键词匹配的问题继续走规则；模型提示词要求对医疗问题和缺乏依据的问题拒答。资料 ID 校验和关键词过滤不等于事实证明，也不能保证覆盖所有医疗表达或消除幻觉；本版不适合用作医疗诊断系统。
- 模型只可建议 explain 或 null；业务动作不能由模型触发。过长、额外流程字段、明显伪造操作结果或不合法的回复会被丢弃。

目前模型调用为单轮，不上传历史对话、业务上下文或个人健康记录。启用后本轮普通聊天文本会发送给所配置的模型服务。

## 验证

`python -B -m unittest discover -s tests -p test_model_gateway.py -v`

测试通过模拟 HTTP 验证路径、鉴权、正常回复、失败回退、业务优先、动作与语音衔接，不消耗真实模型费用。真实模型仍需配置后检查服务商兼容性与回复质量。
