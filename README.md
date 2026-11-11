# dsh-go-quota

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

OpenCode Go 多账号额度卡片与 Key 切换插件，运行在 [DeepSeek Harness](https://github.com/deepseek-ai)（DSH）桌面版的 Web UI 里。

每个 OpenCode Go 订阅 Key 一张额度卡：实时查看 5h / 周 / 月三档用量，点卡片切换当前 Key；支持星标置顶、单/双列布局、拖动悬浮窗、展开收起动画，并与 DSH 左下角的 Go 额度面板联动。

> 本项目与 OpenCode、DeepSeek 官方无隶属关系。额度查询使用 OpenCode Go 的接口，接口可能随时变化。

## 功能

- **每个 Key 一张卡**：5h / 本周 / 本月进度条、百分比、重置倒计时；≥70% 变黄，≥90% 变红。
- **当前账号细长横条**：账号名 + 5h / 周 / 月三档 + 星标，不占用一张大卡。
- **点击切换**：把该账号的 Key 写入 DSH 凭据库的 `OPENCODE_GO_API_KEY`，并刷新 `dsh-cost-meter`；卡片显示「切换中…」。
- **添加 / 删除**：Key 只以掩码（前 4 + 后 4）下发浏览器；当前账号不显示删除按钮。
- **星标置顶**：灰色实心五角星，点击变金色并在切换列表置顶；再点取消。
- **布局**：标题栏布局图标切换单列 ↔ 双列，宽度弹簧过渡 + 卡片错峰入场；首次点击前按账号数自适应。
- **拖动 / 收起**：收起胶囊或标题栏拖动；位置、布局、星标、收起状态存 cookie + localStorage，跨重启保留。
- **动效**：展开/收起弹簧、卡片错峰、胶囊 pop；支持 `prefers-reduced-motion`。
- **安全区**：顶部保留 84px，避免压到窗口标题栏/拖拽区；面板在 Electron 拖拽区可点击。

## 界面

- 标题栏：`Go 账号 · N 个账号` + 布局图标 + 刷新 + 收起。
- 使用中横条：`● 账号名 ★ 使用中 5h x% · 周 y% · 月 z%`。
- 卡片组：每个账号一张，当前账号不在卡片组里。
- 底部：`+ 添加账号` / 更新时间。

欢迎 PR 提供脱敏截图；请勿提交真实 Key 或账号数据。

## 安装

### 前置

- DSH 桌面版，带 Web UI（本插件使用 DSH 的 Web 客户端插件 API；不同 DSH 版本可能有差异）。
- 一个 OpenCode Go 订阅 Key（`oc_...`）。
- 首次使用需要让 DSH 能访问 `https://opencode.ai/zen/go/v1/usage`。

### 本地 Bundle 安装

1. 克隆或下载本仓库到本地目录：

   ```bash
   git clone https://github.com/EyuNO1/dsh-go-quota
   ```

2. 在 DSH 里把它作为本地 bundle 安装：
   - 打开 DSH 的插件管理页，选择「安装本地 Bundle / Install local bundle」，选中该目录；或
   - 让 DSH 的 agent 执行：

     ```
     plugin_manager install_bundle target=<仓库绝对路径>
     ```

3. 重启 / 刷新 DSH。右上角出现「Go 账号」浮层。

4. 首次启动会把凭据库里已有的 `OPENCODE_GO_API_KEY` 导入为「默认账号」；没有则在浮层点「+ 添加账号」。

> 本包是 DSH 本地 bundle（包名 `@local/dsh-go-quota`），不是 npm 包；`@local/` 前缀是本地安装约定。

### 开发模式

修改 `client.js` 后刷新 DSH 页面即可（部分环境支持热加载）；修改 `index.js` / `cordis.patch.yml` 后需要重载插件或重启 DSH。

```bash
node --check index.js
node --check client.js
```

## 使用

- **切换**：点卡片正文（不是星标/删除）切换当前 Key；当前账号会变成顶部横条，原当前账号回到卡片组。
- **星标**：点账号名右侧灰星，标记为重要并置顶；再点金星取消。
- **布局**：点标题栏布局图标，在单列/双列之间切换；选择会记住。
- **拖动**：收起后拖胶囊，或展开后拖标题栏；位置自动限制在屏幕内。
- **刷新**：点标题栏刷新图标，强制重查所有账号额度。

## 数据与安全

- Key 保存在 DSH 凭据库的 `OPENCODE_GO_API_KEY` 中；账号列表保存在
  `$DSH_HOME/plugin-data/dsh-go-quota/accounts.json`（权限 0600）。
- 浏览器只拿到掩码（前 4 + 后 4），拿不到完整 Key。
- Key 只作为 `https://opencode.ai/zen/go/v1/usage` 的 Bearer 和 DSH 凭据值使用；无遥测、不上传第三方。
- 插件 HTTP 路由与 DSH 同源、仅本机，不额外监听端口。
- 位置/布局/星标/收起状态存 host 级 cookie + localStorage，不包含 Key。
- 请勿在 issue / PR 中粘贴 `accounts.json`、完整 Key 或带个人数据的截图。安全报告见 [SECURITY.md](SECURITY.md)。

## 工作原理

```text
DSH Web UI
  shell.overlay ── 「Go 账号」浮层 (client.js)
         │  fetch（同源）
         ▼
Host plugin (index.js)
  GET  /go-quota/state
  POST /go-quota/accounts          {name, key}
  POST /go-quota/accounts/remove   {id}
  POST /go-quota/activate          {id}
  POST /go-quota/refresh
         │ accounts.json + DSH credentials + costMeter
         ▼
https://opencode.ai/zen/go/v1/usage
```

- **激活**：写 `OPENCODE_GO_API_KEY`，读回校验；成功后才确认切换，失败会报错。
- **首次导入**：从 DSH 凭据库读取已有 Key，不覆盖、不丢 Key。
- **额度**：并发查询所有账号，约 20 秒缓存；`?force=1` 绕过。

## 兼容性 / 已知限制

- OpenCode Go 的 usage 接口不是公开稳定 API；请求需要浏览器 UA，可能触发 Cloudflare 限制。
- DSH 的 Web 客户端插件 API 仍在演进；本插件按 2026-11 的 desktop 版本验证。
- 面板顶部保留 84px 安全区，因此不能拖到窗口最顶；这是为了避免压到标题栏/拖拽区后无法点击。
- 位置/布局/星标是 host 级 cookie：用 `localhost` 和 `127.0.0.1` 打开会被视为两份。
- 手动选过布局后不再自动跟随账号数；清除 `dsh_goq_layout` cookie 可恢复自动。
- 星标是浏览器本地 UI 偏好，不写入 `accounts.json`。
- 两列布局下最后一张奇数卡片右侧会留一个空位。

## 开发 / 贡献

- 纯 ESM，无构建步骤；源码即发布。
- `node --check index.js`、`node --check client.js` 必须通过。
- UI 颜色全部使用 `--dsw-alias-*` token；避免硬编码主题色。
- PR 请附：改了什么、如何验证、是否影响切换/凭据/额度链路。
- 不要提交 Key、`accounts.json`、个人截图或 `$DSH_HOME` 下的数据。

## License

[MIT](LICENSE) © 2026 dsh-go-quota contributors

## English

**dsh-go-quota** is a local-first DeepSeek Harness (DSH) Web UI plugin that shows one quota card per OpenCode Go subscription key: 5-hour, weekly and monthly usage, a compact active-account bar, click-to-switch of the active `OPENCODE_GO_API_KEY`, star-to-pin ordering, one/two-column layout, draggable placement, and open/close animations. It integrates with `dsh-cost-meter`.

Install: clone this repo, install the folder as a local DSH bundle (Plugins UI or `plugin_manager install_bundle target=<path>`), restart DSH, then add your `oc_...` keys. The first launch imports an existing `OPENCODE_GO_API_KEY` as the default account.

Keys stay in the DSH credential store; only masked values reach the browser; no telemetry. The OpenCode Go usage endpoint is unofficial and may change. MIT licensed. Not affiliated with OpenCode or DeepSeek.
