<div align="center">

<img src="assets/banner.webp" width="100%" alt="B站伙伴 · dsh-bili-eyes：让 AI 真的看懂 B站视频，也能自己逛 B站">

[![npm](https://img.shields.io/npm/v/dsh-bili-eyes)](https://www.npmjs.com/package/dsh-bili-eyes)
[![license](https://img.shields.io/npm/l/dsh-bili-eyes)](LICENSE)
[![QQ 交流群](https://img.shields.io/badge/QQ%20%E4%BA%A4%E6%B5%81%E7%BE%A4-1130276670-12B7F5?logo=qq&logoColor=white)](#交流与反馈)

[快速开始](#快速开始) · [文档](docs/README.md) · [更新记录](CHANGELOG.md) · [反馈问题](https://github.com/QiuYeDx/dsh-bili-eyes/issues)

</div>

## 简介

dsh-bili-eyes 是一个 DeepSeek Harness（DSH）插件。给她一个 B站链接，她能看到分镜图、台词、热评和弹幕，然后像看过的朋友一样聊。登录一个 B站账号（建议小号）后，她还能自己逛 B站、处理收件箱，并在你允许的范围内点赞、收藏、评论、私信你。

适合接给 QQ 机器人这类「群友会分享视频」的场景，也能在 DSH 窗口里直接用。装上就能用：不需要 yt-dlp，ffmpeg 可以在设置页一键下载。

## 功能

**看视频**

- **分镜图 + 台词**：按剪辑节奏分格，每格带时间和台词（B站 AI 字幕或语音识别）；长视频分成多张图。分镜来自 [dsh-video-storyboard](https://github.com/SAOS-3624/dsh-video-storyboard)。
- **B站上下文**：标题、UP、播放与点赞、标签、简介、B站 AI 总结、热评、弹幕高频词和最密集的时段。
- **放大看**：对某几秒取高清帧，格子更少、每格更大。

**逛 B站**

- **搜和刷**：站内搜索、首页推荐、热门、排行、关注动态、UP 主投稿、评论区。
- **顺着逛**：`bili_surf` 在插件里顺着线索逛（搜 → 打开 → 看评论 → 点 UP 主），只把摘要和路线交回会话。
- **自己逛**：每天在设定的时间段里自己逛几次，看情况评论、点赞、收藏，把最想推荐的告诉你。

**互动**（默认全关）

- **写操作**：点赞、收藏、评论、回复、私信主人、发动态、关注。
- **权限表**：按「对谁」（自己人 / 主人评论区里的别人 / 外面的人）分开定档，每格可选关、主人开口才做、先问主人、直接做；额度、间隔、正文检查都写在代码里。
- **收件箱和守评论区**：别人回复、@ 她，或者主人投稿下有新评论时，交给她或插件处理。
- **表情**：评论里用 B站自带的表情，顶层评论还能带一张你上传的表情包。

**接 QQ 机器人**

- **dsh-qq 一键适配**：给桥接加工具白名单，有事经 QQ 私聊告诉主人。
- **谁叫的**：群里按主人 / 熟人 / 别人分别决定看不看视频，省 token。

## 快速开始

**1. 安装**

在 DSH「设置 → 插件」里添加插件，包名填 `dsh-bili-eyes`，装完重启 DSH。或者用命令行：

```bash
dsh plugin --profile desktop add dsh-bili-eyes
```

**2. 检查**

打开「设置 → B站伙伴 → 概览」看安装检查。缺 ffmpeg 就点「下载 ffmpeg」，其余都是可选项。

**3. 试用**

在对话里说「帮我看看这个视频 `https://www.bilibili.com/video/BV…`」，或者在设置页「看视频 → 试看」里贴一个链接。

到这一步只用了只读能力，不会往 B站发任何东西。登录 B站、语音识别、写操作、自己逛等更多功能，见 [安装与上手](docs/guide/安装与上手.md#按需打开更多)。

## 文档

| 文档 | 内容 |
| --- | --- |
| [安装与上手](docs/guide/安装与上手.md) | 安装、登录、语音识别、按需打开功能、升级和卸载 |
| [设置页](docs/guide/设置页.md) | 设置页各页签里有什么 |
| [工具](docs/guide/工具.md) | 给模型的工具和参数 |
| [写操作与权限](docs/guide/写操作与权限.md) | 权限表、主人怎么同意、门卫、收藏、关注、表情 |
| [后台功能](docs/guide/后台功能.md) | 自己逛、收件箱、守评论区 |
| [接入 QQ 机器人](docs/guide/接入QQ机器人.md) | dsh-qq 一键适配、谁叫的、其他桥接 |
| [配置项](docs/guide/配置项.md) | 配置文件的全部字段 |
| [开发](docs/guide/开发.md) | 从源码安装、命令行、测试 |

协议和设计文档见 [文档目录](docs/README.md)。

## 使用条件

| 需要 | 说明 |
| --- | --- |
| DSH | 0.2.1 前后（在 0.2.1-rc.3 上验证过） |
| ffmpeg / ffprobe | 看画面需要，设置页能一键下载；没有时只返回文字 |
| B站账号 | 可选，建议小号。登录后才有 AI 字幕和总结、1080P、收件箱和写操作 |
| 系统 | Windows 上完整验证过；macOS / Linux 已适配但未实测 |

完整说明见 [使用条件](docs/guide/安装与上手.md#使用条件)。

## 安全与隐私

- **默认什么都不发**：写操作和「自己逛」默认全关，只装不改设置就只有只读能力。
- **只认 B站**：工具不接受本机路径和其他网站；视频、评论、私信里的文字一律当素材，不当指令。
- **登录信息只在本机**：存在 `~/.dsh/bili-eyes/credential.json`，相当于账号密码，不会经过设置页接口返回。插件不上报任何数据。
- **账号风险**：写操作有频率和内容的硬上限，风控时自动暂停，但风险总是存在。建议用小号，并在简介里写明是 AI 运营。

## 交流与反馈

- QQ 交流群：**1130276670**（设置页「设置 → 关于」里可以一键复制）
- 问题和建议：[GitHub Issues](https://github.com/QiuYeDx/dsh-bili-eyes/issues)
- 更新记录：[CHANGELOG.md](CHANGELOG.md) · [GitHub Releases](https://github.com/QiuYeDx/dsh-bili-eyes/releases)

## 致谢

- [SAOS-3624/dsh-video-storyboard](https://github.com/SAOS-3624/dsh-video-storyboard)（MIT）：分镜、台词对齐、转写生命周期。
- [SocialSisterYi/bilibili-API-collect](https://github.com/SocialSisterYi/bilibili-API-collect)：B站接口与 WBI 签名文档。
- [c1overzz/dsh-bili-scroll](https://github.com/c1overzz/dsh-bili-scroll)、[Yuuyuko-uu/dsh-bili-subagent](https://github.com/Yuuyuko-uu/dsh-bili-subagent)（MIT）：冲浪与互动参考了它们内置的 [bilibili-mcp](https://github.com/adoresever/bilibili-mcp) 的接口用法和收件箱的记账方式（用 JS 重写，没有照搬代码）。

## 许可证

[MIT](LICENSE)
