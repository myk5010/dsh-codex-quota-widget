# dsh-codex-quota-widget

DSH Web 的 ChatGPT Codex 订阅额度角标插件。当前版本 **1.0.3**。
本仓库是后续插件更新的源码主线；现有DSH部署不依赖此目录的实时改动。

## 功能

- 角标显示距额度重置的倒计时和剩余百分比，例如 `5天10小时 57%`；短于一天显示小时/分钟。详情保留窗口名称、绝对重置时间及上次成功更新。
- 倒计时使用上游实际 `resetAt`，随原有5秒刷新计算；重置时间缺失显示“重置时间未知”，时间已过显示“待刷新”，不假定额度已经恢复。不伪造窗口或绝对token余额。
- 桌面悬停打开，鼠标移出角标/面板整体范围立即关闭；跨空隙和面板内部不会误关。
- 触屏点击切换，支持键盘focus/Enter/Esc；桌面距底边96px、手机88px；确认模态打开时自动避让。
- 页面每5秒请求；宿主共享缓存/单飞，避免多标签放大上游流量；后台标签暂停，切回即查询。
- 网络错误保留旧数据并标过期；未登录/登录过期清除旧额度；429遵守Retry-After，其它错误指数退避。
- 使用已有 `llm-pi-ai/openai-codex` OAuth记录；续期在DSH凭据锁内协调，成功轮换令牌不能因为查询取消而丢失。
- 本插件不发起首次登录；pi-ai CLI 设备码授权和安全导入已有 grant 的步骤见[独立指南](<docs/device-code-login.md>)。
- 额度摘要走DSH已认证API，不传access/refresh、账号ID、邮箱或原始上游响应给浏览器。

本插件**不是完整模型接入代理**。SSE/模型配置由DSH适配器管理；请求性能列表及特殊模型错误恢复尚未实现。

## 环境与兼容性

- 推荐Node24；开发要求Node22或更高。
- 已在DSH `0.2.0-rc.2` 验证，使用Host的credentials/connection服务与客户端 `shell.overlay` slot。
- 浏览器使用DSH平台React singleton，不把独立React副本打进插件。
- Host peer：`@deepseek-ai/schemastery ^3.18.2`。某些Profile通过父级依赖映射提供peer，pnpm可能提示missing-peer，但DSH实际可解析；应验证而非盲目升级生产核心库。
- Codex额度接口非稳定公共契约；字段改变或拒绝访问会显示明确状态，不冒充额度耗尽。

## 本地开发

```sh
npm ci --ignore-scripts
npm test
npx playwright install chromium
npm run test:browser
```

单元与浏览器测试均使用mock数据，无需ChatGPT账号、DSH运行实例或任何token。
浏览器测试默认读取本地开发依赖，截图进入忽略的 `test-results/`；可通过
`CHROMIUM_PATH` 指定已有Chromium，通过 `ARTIFACT_DIR` 指定测试产物位置。

## 打包与安装

```sh
mkdir -p dist
npm pack --pack-destination dist
sha256sum dist/*.tgz
```

`prepack` 自动生成客户端 [构建入口](<scripts/build.mjs>) 的产物；tarball只包含运行文件、说明及license。
`private: true` 防止误发npm，不影响本地打包/安装。

经确认后在DSH插件页安装tarball并启用组合包，或：

```sh
dsh plugin --profile web add /absolute/path/to/dist/dsh-codex-quota-widget-1.0.3.tgz --ignore-scripts
```

当前bundle配置见 [cordis.patch.yml](<cordis.patch.yml>)：`pollIntervalMs: 5000`、`timeoutMs: 10000`。
已有依赖的升级可能保留停用状态，请核对当前Profile的bundle选择。安装后刷新现有Web GUI并验证。
修改Host模块可能需要重新激活/人工重启，不能假定复制文件就能热更新。

## 关闭与回滚

在插件页关闭组合包，或从当前Profile的bundle列表移除 `dsh-codex-quota-widget`。
这只撤回额度UI/API，不删除Codex登录记录、不改模型或SSE设置。
回滚到旧版本先确认生产授权和快照；不要整文件覆盖用户的新配置，也不要停止/重启生产服务。

## 仓库结构

```text
host.js                 DSH接线与安全续期
monitor.js              额度归一化、共享缓存与退避
source/client.cjs       界面、悬停交互和5秒轮询
scripts/build.mjs       生成DSH客户端factory
cordis.patch.yml        独立组合包声明
tests/                  mock单元/浏览器回归
.github/workflows/      仅构建测试，不接真实账号/不自动部署
```

[更新记录](<CHANGELOG.md>) · [开发/发布流程](<CONTRIBUTING.md>) · [MIT License](<LICENSE>)

源码从此前已验证的1.0.2快照迁入。初始本地tag不是GitHub/npm发布；旧版本变更记入CHANGELOG，
不伪造原始提交历史。远端创建、推送和公开发布需单独确认。
