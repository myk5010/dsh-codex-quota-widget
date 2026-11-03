# Debug 日志：定位额度查询红点

## 使用

悬停角标打开详情，开启 **Debug 日志**。默认关闭；开启后Host与当前浏览器分别在内存保留最近300条，
30分钟后自动停止，手动关闭也会停止收集。关闭后保留已收集内容，便于查看或导出；插件重新激活/Host重启会丢失Host内存日志。

- **Host 调试日志**：界面显示最近30条，包括查询阶段、HTTP状态、耗时、超时标志、底层网络错误枚举、缓存/合并和退避。
- **浏览器 RPC 调试日志**：显示最近10条浏览器到DSH请求的耗时、成功/失败及是否取消。
- **清空日志**：清除Host和当前页面的客户端日志，不改变额度或登录状态。
- **导出 JSON**：获取完整有界Host日志和当前浏览器日志，下载 `codex-quota-debug.json`；不会自动上传或保存到Host磁盘。如果Host无法读取，仍导出本地缓存的Host尾部与浏览器日志，并以 `hostReadFailed: true` 标注不是完整Host记录。

Debug不额外请求额度接口，也不改变5秒轮询/缓存/退避。Host默认总检查预算20秒、浏览器状态RPC预算30秒；
实际Host配置与日志一起导出。调试控制操作共用30秒取消预算，失败只显示通用提示。

Host开关属于当前DSH实例，其他已认证页面会在下一次正常状态刷新看到开启状态；客户端RPC日志仅当前页面所有。
如果网络已断开导致关闭操作无法送达Host，会显示操作失败，Host仍受30分钟自动到期约束。

## 如何读

| 日志/字段 | 含义 |
|---|---|
| `query_started` / `qN` | 一次实际额度检查（不是聊天请求ID） |
| `stage=credentials_read` | 读取既有grant |
| `credentials_lock` / `oauth_refresh` | 等待凭据锁/执行必要续期 |
| `upstream_fetch` | 等待额度接口响应头 |
| `body_read` / `normalize` | 读取响应与校验额度字段 |
| `upstream_headers` / `httpStatus` | 真正的额度HTTP响应，如403/429/500；外层DSH RPC200不代表额度成功 |
| `deadline_exceeded` / `timedOut=true` | Host总预算定时器到期；看stage确定卡在哪一步 |
| `networkCode=ECONNRESET` 等 | 来自底层异常cause的允许列表，不是猜测原始message |
| `cache_hit` / `join_inflight` | 复用缓存/等待同一在途检查，不是额外上游请求 |
| `backoff` / `retryMs` | 后续查询等待时间；期间仍红不表示在持续探测网络 |
| 浏览器 `RPC失败` / `aborted` | 浏览器到Host失败/被取消；结合耗时和Host日志区分网络段 |

先开启Debug，正常使用一段时间，红点出现时导出，再关闭。若最近列表没有失败，可能尚未等到一次实际查询，
或者故障发生在开启前；Debug不会追溯以前没有保存的异常。一次成功采样也不能证明之前没有网络波动。

## 隐私和存储

只记录显式允许的事件、阶段、数字、布尔值和错误枚举。**不记录**access/refresh、账号ID/邮箱、cookie、
认证头、请求/响应正文、会话内容、原始错误message/stack、代理URL或上游完整连接字符串。
未知属性/事件在Host和客户端导出时都再次过滤。导出不包含完整quota响应。

接口沿用DSH的浏览器认证与Host/Origin栅栏；`/api/codex-quota/debug`只接受enable/disable/read/clear。
未登录不能读取或开启日志，跨Origin调用被拒绝。请只在自己的受信浏览器下载并分享必要的脱敏日志。

## Host 版本更新

[构建脚本](<../scripts/build.mjs>) 同时生成客户端和版本化Host/monitor/debug文件，
[组合声明](<../cordis.patch.yml>) 使用相对的 `lib/host.<version>.js` 文件入口；DSH将它按包位置锚定。
相对依赖也版本化，避免Node继续使用旧版已求值模块。

更新运行中的插件时先停用本组合包并等待旧fiber退出，再安装新包、恢复选择并刷新现有GUI。
只改一个运行中条目的name、只替换文件或只改依赖版本，不保证重新导入Host代码。不要启用会导致
框架退出的源码watcher，也不要因此停止/重启生产服务；若不能安全重新激活，报告并由人工决定。

发布包应从干净checkout构建，避免将本地 `lib/` 中旧版本开发产物一并打包；生成目录不提交Git。
