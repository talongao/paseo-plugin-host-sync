# Host 备份

把 Paseo 的 **host 列表**加密备份到你自己的 GitHub 仓库，换设备后合并恢复。

Paseo 把 host 列表存在浏览器的 `localStorage` 里，不跟账号走，所以换浏览器或换机器列表就没了。这个插件把列表做成快照推进你自己的仓库，需要时再合并回来。

## 功能

- **备份** —— 每次新增一份快照，不覆盖历史
- **加密（默认开启，可关闭）** —— PBKDF2-SHA256（310k）+ AES-256-GCM，仓库里只有密文
- **恢复** —— 任选一份快照合并进当前浏览器
- **保留份数** —— 只留最近 N 份，其余自动删除
- **跨设备安全** —— 只能在别的机器上生效的连接（`localhost:6767`）会被丢掉；本机只保留直连

## 安装

在 **设置 → Hosts → ⋯ → 插件** 里安装，或命令行：

```bash
paseo plugin add git:talongao/paseo-plugin-host-sync
```

安装后可从 **设置 → Hosts → ⋯ → 插件 → Host 备份** 打开，也会注册一个 ⌘K 条目和一个侧边栏图标。

## 配置

| 项 | 说明 |
|---|---|
| 仓库 | `owner/repo` 或 GitHub 链接 |
| 分支 | 留空 = 仓库默认分支 |
| 目录 | 留空 = 仓库根目录 |
| Token | GitHub 个人访问令牌，需要该仓库的 **Contents: Read and write** |
| 密码 | ≥ 8 位，用于派生 AES 密钥 |
| 保留份数 | 只保留最近 N 份，`0` = 不限 |

快照文件名形如 `paseo-hosts-20261028-112233-mac-mini.enc.json`：时间、host 标签，加密时带 `.enc`。

## 数据去向

- 加密快照通过 GitHub Contents API 写入**你自己**的仓库。
- token 和密码保存在这个浏览器的 `localStorage`，不会发给 Paseo daemon，除了向 `api.github.com` 发请求时的 `Authorization` 头以外不会离开浏览器。
- 没有遥测，没有第三方服务，除了 `api.github.com` 不发起任何网络请求。

## 合并规则

恢复从不删除任何东西：

| 情况 | 结果 |
|---|---|
| 备份里有、本地没有 | 新增 |
| 本地有、备份里没有 | 原样保留 |
| 两边都有同一个 `serverId` | 连接取并集 |
| 重复恢复同一份 | 幂等 |

除了当前浏览器连着的这台 daemon，其它 host 的 loopback TCP（`localhost`、`127.0.0.1`、`::1`）都会被丢弃 —— 否则 `localhost:6767` 会指向错误的机器。

## 安全模型

- 加密：PBKDF2-SHA256（310,000 次迭代）+ AES-256-GCM，salt/iv 每次随机
- 关闭加密时，快照是明文，包含 host 连接信息（可能含 daemon 密码），只应在私有仓库使用
- 密码丢失无法恢复

## 开发

```bash
npm install
npm run typecheck
```

TypeScript 由 Paseo 自己编译，没有构建步骤。插件只用 host 提供的库（`@getpaseo/plugin`、`react`、`react-native`），没有运行时依赖。

## 许可证

MIT
