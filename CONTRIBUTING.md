# 开发与版本更新

本仓库是唯一源码主线；旧Lab任务只作历史/部署证据，不再复制维护整套插件源码。

## 开发

1. 使用Node24，`npm ci --ignore-scripts` 安装锁定依赖。
2. 宿主逻辑在 [host.js](<host.js>) / [monitor.js](<monitor.js>)；界面在 [client.cjs](<source/client.cjs>)。
3. `npm test` 自动构建并运行mock回归；UI变更还需 `npm run test:browser`。
4. 审查diff，不提交运行数据。只暂存本次明确改动的路径。

## 新版本

1. 修改 [package.json](<package.json>) 的版本并更新 [CHANGELOG.md](<CHANGELOG.md>)。
2. 运行完整测试，构建并生成本地tarball：

   ```sh
   npm test
   npm run test:browser
   mkdir -p dist
   npm pack --pack-destination dist
   sha256sum dist/*.tgz
   ```

3. 创建源码提交和对应本地tag，不重写已有tag。
4. GitHub远端/推送/公开发布需另行授权。可将tarball与SHA256作为GitHub Release附件；CI不自动发布。
5. 生产安装另行确认并记录包版本、源码commit、hash、验收与回滚。不要直接修改安装目录。

纯客户端更新也需要保证Host退出旧client快照并重新读取新产物；刷新现有GUI验证。
Host代码更新不得假定免重启可用；若部署确需重启，报告原因并由人工操作，代理不向生产进程发信号。

## 测试边界

[浏览器测试](<tests/browser.mjs>) 仅构造本地内存mock页面。它不会读取DSH_HOME、启动token或真实账号凭据。
机器专用的真实GUI认证验收脚本留在Lab，没有迁入本仓库。不要将生产cookies/会话数据加进测试或CI。
