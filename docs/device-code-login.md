# 通过 pi-ai CLI 设备码登录，并将 Codex OAuth grant 导入 DSH

本文记录当前插件使用的登录准备流程。**额度 Widget 本身不提供登录界面**：它只读取 DSH 已有的
`llm-pi-ai/openai-codex` OAuth grant。首次登录由 pi-ai CLI 完成，随后将 CLI 的临时 `auth.json`
安全导入 `$DSH_HOME/.credentials.yaml`。令牌全程只在 Host 本地文件/内存，不能粘贴到聊天、GitHub
Issue、截图或源码。

> 此流程面向已经获授权使用 ChatGPT/Codex 的账户。上游 OAuth/API 可能变化；若 CLI 菜单、验证页或
> 服务端响应与下文不同，请停下核实，不要尝试绕过验证。订阅访问资格由 OpenAI 决定。

## 数据流与凭据格式

```text
ChatGPT Plus/Pro 账户
    │ 浏览器打开官方设备验证页，输入一次性 user code
    ▼
pi-ai CLI 轮询并交换授权码/PKCE
    │ 当前工作目录/auth.json（临时敏感文件）
    ▼ 本地安全合并，不经过浏览器/聊天
$DSH_HOME/.credentials.yaml
  records["llm-pi-ai/openai-codex"]
    kind: grant
    payload: { type, access, refresh, expires, accountId }
    │ DSH pi-ai adapter 每次请求读取；刷新在 DSH 凭据锁内更新同一记录
    ▼
https://chatgpt.com/backend-api
```

OAuth grant 与 API-key `refs` 是两种不同格式：**不要**把 access token 填进 `refs`、`OPENAI_API_KEY`
或插件设置；Codex 原生 OAuth 必须存为 `records` 下的 `kind: grant`。

## 1. 找到与 DSH 配套的 pi-ai CLI

推荐使用当前 DSH Release 自带的 CLI，避免拿另一版本的 OAuth 凭据格式来回导入。`DSH_HOME` 默认为
`$HOME/.dsh`；如部署指定了其它 home，先用它的绝对路径：

```sh
export DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
```

定位该 Release 中的 CLI（下例假设当前 Release 是 `0.2.0-rc.2`；把目录替换为实际安装版本）：

```sh
export DSH_RELEASE="$DSH_HOME/releases/0.2.0-rc.2"
export PI_AI_CLI="$DSH_RELEASE/node_modules/@earendil-works/pi-ai/dist/cli.js"
test -f "$PI_AI_CLI" || { echo '找不到 pi-ai CLI；停止并核对 DSH Release 路径' >&2; exit 1; }
```

若不知道版本，可列出候选路径后手工确认哪个与当前运行的 DSH Release 一致：

```sh
find "$DSH_HOME/releases" -path '*/node_modules/@earendil-works/pi-ai/dist/cli.js' -type f -print
```

不要直接运行 `npx @earendil-works/pi-ai` 来“碰运气”选版本：npx 可能下载一个与当前 DSH 不同的最新版。

## 2. 运行设备码登录

CLI 将 `auth.json` 写到**当前工作目录**。因此先创建只供本次授权使用的私有临时目录，并在写文件前设置
umask：

```sh
umask 077
export CODEX_LOGIN_DIR="$HOME/.cache/dsh-codex-device-login"
mkdir -p "$CODEX_LOGIN_DIR"
chmod 700 "$CODEX_LOGIN_DIR"
cd "$CODEX_LOGIN_DIR"
node "$PI_AI_CLI" login openai-codex
```

如果系统要求输入登录方式，选 **Device code login (headless)**（通常是选项 `2`，以当前 CLI 实际菜单为准）。
CLI 会显示官方验证网址和一次性 code：

1. 在任意联网浏览器打开 CLI 显示的 `https://auth.openai.com/codex/device`。
2. 用你的 ChatGPT Plus/Pro 账号登录，并输入终端显示的 code。
3. 回到终端等待 CLI 完成轮询，并确认出现 `Credentials saved to auth.json` 且进程正常退出。

设备码有时限，过期就重新运行 CLI 获取新码；**不要重复提交已过期的 code**。设备码模式不需要
`localhost:1455` 浏览器回调，适合 DSH Web 经 SSH/代理转发访问的情况。不要选 Browser login 后把远端
回调地址误认为 DSH Web 的地址。

可只检查临时文件权限和字段名，不打印任何值：

```sh
stat -c 'mode=%a bytes=%s' "$CODEX_LOGIN_DIR/auth.json"
node --input-type=module -e '
  import fs from "node:fs";
  const v=JSON.parse(fs.readFileSync(process.argv[1], "utf8"))["openai-codex"];
  console.log({type:v?.type, fields:Object.keys(v ?? {}).sort(), hasAccess:!!v?.access,
    hasRefresh:!!v?.refresh, hasAccountId:!!v?.accountId, expiresIsNumber:Number.isFinite(v?.expires)});
' "$CODEX_LOGIN_DIR/auth.json"
```

不要 `cat auth.json`、不要在 terminal sharing/日志里打印其内容。`access` 和 `refresh` 都是账户机密。

## 3. 安全导入 DSH 凭据记录

**先让正在运行的 Codex 请求空闲**，不要与模型调用/刷新同时手改凭据文件。DSH 自身的刷新用 `modifyRecord`
锁；外部编辑器不参加该锁。

目标文件为 `$DSH_HOME/.credentials.yaml`。替换已有 Codex 记录前，必须先做仅当前 OS 用户可读的备份：

```sh
export DSH_CREDENTIALS="$DSH_HOME/.credentials.yaml"
export CODEX_BACKUP="$DSH_CREDENTIALS.before-codex-login.$(date +%Y%m%dT%H%M%S%z).$$"
if [ -f "$DSH_CREDENTIALS" ]; then
  test ! -e "$CODEX_BACKUP" || { echo '备份文件已存在；停止，不覆盖' >&2; exit 1; }
  cp -p "$DSH_CREDENTIALS" "$CODEX_BACKUP"
  chmod 600 "$CODEX_BACKUP"
  printf '已创建受限权限备份：%s\n' "$(basename "$CODEX_BACKUP")"
fi
```

**备份同样含有全部账户凭据**：不要将它加入仓库/同步盘/支持工单；确认导入成功且不再需要恢复后，按部署
的安全策略删除这份副本。若已有目标记录，导入程序默认拒绝覆盖，需先确认备份是安全的，再显式设
`REPLACE_CODEX_GRANT=1`。

下面脚本使用该 Release 自带的 `yaml` 库，保留其它 refs/records；验证新文件后以 mode `0600` 写临时文件，
再同目录原子替换。它只输出记录地址、类型和字段名，绝不输出凭据值：

```sh
DSH_HOME="$DSH_HOME" DSH_RELEASE="$DSH_RELEASE" \
CODEX_AUTH_JSON="$CODEX_LOGIN_DIR/auth.json" \
DSH_CREDENTIALS="$DSH_CREDENTIALS" \
node --input-type=module <<'NODE'
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

const home = process.env.DSH_HOME;
const release = process.env.DSH_RELEASE;
const authPath = process.env.CODEX_AUTH_JSON;
const target = process.env.DSH_CREDENTIALS || path.join(home || '', '.credentials.yaml');
const existedBefore = fs.existsSync(target);
if (!home || !path.isAbsolute(home) || !release || !path.isAbsolute(release) ||
    !authPath || !path.isAbsolute(authPath) || !path.isAbsolute(target)) {
  throw new Error('请设置绝对路径 DSH_HOME、DSH_RELEASE、CODEX_AUTH_JSON、DSH_CREDENTIALS');
}
const require = createRequire(path.join(release, 'package.json'));
const { parseDocument } = require('yaml');
const key = 'llm-pi-ai/openai-codex';
const credential = JSON.parse(fs.readFileSync(authPath, 'utf8'))['openai-codex'];
if (credential?.type !== 'oauth' || typeof credential.access !== 'string' || !credential.access ||
    typeof credential.refresh !== 'string' || !credential.refresh ||
    typeof credential.accountId !== 'string' || !credential.accountId ||
    !Number.isFinite(credential.expires)) {
  throw new Error('auth.json 缺少完整 Codex OAuth 字段；不打印/展示其值');
}
let before = 'version: 1\nrefs: {}\nrecords: {}\n';
if (fs.existsSync(target)) {
  const mode = fs.statSync(target).mode & 0o777;
  if ((mode & 0o077) !== 0) throw new Error('凭据文件权限过宽；先将其收紧到仅属主可读写（0600）');
  before = fs.readFileSync(target, 'utf8');
}
const doc = parseDocument(before, { uniqueKeys: true });
if (doc.errors.length) throw new Error('现有凭据 YAML 无法解析；停止以免覆盖');
const state = doc.toJS();
if (state.version !== 1 || Object.keys(state).some(k => !['version','refs','records'].includes(k)))
  throw new Error('不是预期的 version-1 DSH credentials 文档；停止');
const existing = state.records?.[key];
if (existing && process.env.REPLACE_CODEX_GRANT !== '1')
  throw new Error('目标 grant 已存在。先做受限备份；确认要替换时设置 REPLACE_CODEX_GRANT=1');
if (!state.records) doc.set('records', {});
doc.setIn(['records', key], { kind: 'grant', payload: credential });
const output = String(doc);
const check = parseDocument(output, { uniqueKeys: true });
if (check.errors.length) throw new Error('生成的凭据 YAML 无法重新解析；未写入');
const verified = check.toJS();
if (verified.records?.[key]?.kind !== 'grant' ||
    verified.records[key].payload?.type !== 'oauth' ||
    verified.records[key].payload?.accountId !== credential.accountId ||
    verified.records[key].payload?.access !== credential.access ||
    verified.records[key].payload?.refresh !== credential.refresh) {
  throw new Error('新 grant 回读不匹配；未写入');
}
// Refuse to overwrite another writer's changes made since the initial read.
if (fs.existsSync(target) !== existedBefore || (existedBefore && fs.readFileSync(target, 'utf8') !== before))
  throw new Error('凭据文件在导入期间发生变化；没有写入，请空闲后重新开始');
const temp = `${target}.tmp-${process.pid}-${randomUUID()}`;
try {
  fs.writeFileSync(temp, output, { flag: 'wx', mode: 0o600 });
  fs.chmodSync(temp, 0o600);
  fs.renameSync(temp, target);
  fs.chmodSync(target, 0o600);
} finally {
  try { fs.unlinkSync(temp); } catch {}
}
const finalDoc = parseDocument(fs.readFileSync(target, 'utf8'), { uniqueKeys: true }).toJS();
if (finalDoc.records?.[key]?.kind !== 'grant') throw new Error('写后回读失败');
console.log(JSON.stringify({ ok: true, key, kind: 'grant', payloadFields: Object.keys(finalDoc.records[key].payload).sort(),
  refsPreserved: Object.keys(finalDoc.refs ?? {}).length, records: Object.keys(finalDoc.records ?? {}).length,
  target: path.basename(target), mode: (fs.statSync(target).mode & 0o777).toString(8) }));
NODE
```

脚本成功后，DSH 的 credentials 文件 watcher 会重载文件；**额度插件本身不需要重新登录，也不需要为了凭据重启服务**。
凭据文件的整体原子替换仍应只在Codex调用空闲时做，以避免和后台token刷新竞争。

导入完成并回读成功后，应删除临时 `auth.json`（并按安全策略处理备份）：

```sh
rm -- "$CODEX_LOGIN_DIR/auth.json"
```

普通 `rm` 不保证SSD/日志文件系统物理擦除；关键是临时目录权限正确、不进Git/同步盘且不散发副本。

## 4. 确认路由与验证

`llm-pi-ai` 必须存在 `openai-codex` 目录路由，且不指定 `apiKeyEnv`，才能让适配器读取
`llm-pi-ai/openai-codex` 原生 OAuth grant。web Models 页面能配置模型路由，但当前额度Widget的独立客户端**没有**
Codex首次授权按钮。如果路由未配置，先通过 Models 设置选择 Codex；手改 `cordis.patch.yml` 时只合并该provider，
不要替换整个 `providers` 映射。

在模型选择器选Codex模型发送短测试请求。遇到 `401`、`403` 或模型访问提示时，不要复制token；看终端错误码、
订阅访问资格、接口是否临时故障，并可按上面流程重新做一次显式grant替换。

## 5. 安全/排错

- `auth.json` 与 `.credentials.yaml` 中的grant相当于账户令牌；OS文件权限、备份和浏览器认证必须受保护。
- 不要提交 `.credentials.yaml`、`auth.json`、备份、console输出、access/refresh/accountId或登录截图。
- CLI成功但quota显示未登录：检查当前 DSH 进程和导入脚本使用的是同一 `DSH_HOME`，记录键精确为
  `llm-pi-ai/openai-codex`，记录kind为 `grant`；不要把grant塞进 `refs`。
- 导入时显示目标记录已存在：默认是防误覆盖保护；先备份，确认这是同一账户的重新登录后，才显式启用替换。
- CLI不提供device-code选项、设备码过期、OAuth响应字段变化时，停止并确认当前pi-ai Release与上游授权流程；不要混用陌生release或第三方token。
