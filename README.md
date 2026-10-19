# dsh-pro-tools

DeepSeek Harness **桌面端插件包**：一个 Cordis bundle（设置页 + 开关）加一个**真正运行在 Electron 主进程里的桌面插件**（托盘菜单、桌面行为），两者共用一个开关状态文件。

* **桌面插件** `desktop/plugin.cjs`：跑在桌面外壳的 Electron 主进程里，拥有托盘条目、文案和点击行为——需要 `app`/`shell`/`dialog`/`Notification` 的能力都写在这里。
* **桌面宿主** `desktop/tray-hook.js`：注入 `resources/app/lib/main.js` 的一段**通用宿主**，只做三件事：加载桌面插件、把插件给的条目合并进外壳自己的托盘菜单、把点击路由回插件。它不含任何具体功能。
* **dsh bundle**（`index.js` + `client.js`）：设置页「增强工具」的开关；Host 半把开关状态发布成 `state.json`，并把插件模块部署到 `~/.dsh/pro-tools/desktop/plugin.cjs`。

```
设置页开关 ──ctx.remote.settings.update──> bundle Config 重新 apply
                                                │  deploy + 写状态
                                                ▼
                      ~/.dsh/pro-tools/desktop/plugin.cjs
                      ~/.dsh/pro-tools/state.json  { features: {...} }
                                                │（1.5s 轮询，插件 mtime 变化也重载）
                                                ▼
                    桌面宿主：plugin.trayItems(state) → 合并进托盘右键菜单
```

> 现在有两个功能：`restart-tray`（托盘「重启 DeepSeek Harness」，默认开）、`open-state-folder`（托盘打开数据目录，默认关，用来演示第二种桌面能力）。

---

## 一、安装

### 1. 装 bundle（设置页 + 开关状态）

```powershell
# 一条命令：打包 → 写入 profile 的 dependencies + dsh.profile.bundles → pnpm install
node scripts/install-to-profile.mjs

# 或者手工：
npm pack --pack-destination "$env:USERPROFILE\.dsh\local-plugins"
# 然后在 profile package.json 里加依赖 file:...\dsh-pro-tools-<版本>.tgz，
# 并把 "dsh-pro-tools" 加进 dsh.profile.bundles，最后在 profile 里 pnpm install
```

装好后插件页（设置 → 插件）会列出 **dsh-pro-tools**，profile 里多一行 `pro-tools`，`~/.dsh/pro-tools/state.json` 与 `desktop/plugin.cjs` 立刻被写入。

> **不要用「目录依赖」安装**（`file:<仓库目录>` 或 `install_bundle target=<目录>`）：pnpm 会生成**相对**符号链接，而本机 profile 路径经过 junction（`C:\Users\...\.dsh` → `D:\Users\...\.dsh`），相对链接在别名路径下会断，loader 报 `cannot resolve profile bundle`。打包成 tarball 后包被物化进 profile，没有这个问题。

### 2. 装桌面宿主（一次性）

托盘住在 Electron 主进程里，插件包无法直接注册，所以要把**宿主**注入外壳：

```powershell
node "D:\path\to\dsh-pro-tools\desktop\apply-desktop-hook.mjs" --main "D:\Programs\DeepSeek Harness\resources\app\lib\main.js"
```

然后重启一次 DeepSeek Harness。之后：

```powershell
node desktop/apply-desktop-hook.mjs --check        # 宿主是否在、版本是否最新
node desktop/apply-desktop-hook.mjs --uninstall    # 只移除宿主区段
```

脚本行为：

* 区段标记 `// >>> dsh-pro-tools desktop host v2` / `// <<< ...`，**幂等**；旧版本宿主（v1 的 tray hook）会被自动替换；
* 写入前 `node --check`，语法不过不落盘；
* 顺手清掉原型期的手改（硬编码的 `restartTrayApplication` 菜单项与文案）；
* 备份到 `main.js.dsh-pro-tools.<时间戳>.bak` 与 `~/.dsh/pro-tools/backups/`。

**Harness 升级后** `resources/app` 会被替换：重跑一次上面的命令即可；插件、开关状态、桌面插件模块都不受影响。`--check` 直接告诉你是否需要重跑。

---

## 二、加一个新功能

桌面功能分两半，各改一处：

**1) 开关**（设置页可见）：

```js
// features/my-feature.js
export const meta = {
  id: 'my-feature',
  order: 30,
  defaultEnabled: false,
  title: { zh: '我的功能', en: 'My feature' },
  description: { zh: '一句话说明。', en: 'One line about it.' },
};
```

在 `features/index.js` 的 `SOURCE` 登记，再 `node scripts/build-catalog.mjs`。

**2) 桌面行为**（只在功能开启时出现）：

```js
// desktop/plugin.cjs —— trayItems() 里追加一行
rows.push({
  id: 'my-row',
  order: 30,
  feature: 'my-feature',                       // 宿主按 state.features 过滤
  label: { zh: '我的托盘项', en: 'My tray row' },
  run(api) {                                    // api = { app, shell, dialog, Notification, … }
    api.dialog.showMessageBox({ message: 'hi' });
    return true;                                // 返回 false 则回落到声明式 action
  },
});
```

`node desktop/hook-test.mjs` 与 `node scripts/check.mjs` 会验证：条目引用的开关必须存在、双语标签齐全、开关关闭时条目消失。

想要「开关 + 不接任何桌面行为」也完全可以——只写第 1 步，留给以后接逻辑。

---

## 三、为什么这样设计（升级韧性）

| 层 | 依赖的稳定面 | 升级时的影响 |
|---|---|---|
| 桌面宿主（注入段） | `tray`、`Menu`、`app`、`shell`、`currentDesktopLocale` 等外壳符号 | 只在 `main.js` 结构大改时失效；重跑脚本，找不到锚点会打印整段宿主代码 |
| 桌面插件（`plugin.cjs`） | 宿主给的契约：`trayItems(context)` + Electron API | 与 DSH 版本无关，只跟宿主契约走；宿主向后兼容地加字段 |
| dsh bundle | Cordis `apply`、schemastery `Config`、`settings.section`、`ctx.remote.settings` | 官方设置页一直用这套接口 |
| 数据契约 | `state.json` 只有一个 `features` 映射 | 加功能不改契约，只改代码 |

关键取舍：

* **宿主薄、插件厚**：宿主不含任何功能逻辑，只有「加载 + 合并 + 路由」。真正的桌面能力（及其 API 使用）全在 `plugin.cjs`，所以扩展桌面功能不需要碰注入段，也就不需要重新打补丁。
* **合并而不是重建菜单**：宿主临时劫持 `Menu.buildFromTemplate` 抓外壳自己的模板，把条目插到最后一个分隔符前——官方以后往托盘加「检查更新」之类不会被吞掉；抓不到就退回自建菜单。
* **热更新**：宿主每 1.5s 比对 `state.json` 与插件文件的 mtime，改开关或更新插件都会重建菜单，**不用重启**。
* **不可用即降级**：状态文件损坏、插件抛错、条目超限（16）都被丢弃或截断；任何异常只 `console.warn`，外壳照常启动。

---

## 四、目录结构

```
dsh-pro-tools/
├─ index.js                     Host 半：Config → 部署插件 + 发布 state.json
├─ client.js                    浏览器半：设置页开关（含生成的 catalog）
├─ cordis.patch.yml             bundle 行（id: pro-tools）
├─ features/
│  ├─ index.js                  开关注册表（唯一需要改的汇总文件）
│  ├─ restart-tray.js           托盘「重启 DeepSeek Harness」开关
│  └─ open-state-folder.js      托盘打开数据目录开关（默认关）
├─ lib/
│  ├─ paths.js                  DSH_HOME / ~/.dsh 路径规则
│  └─ state-file.js             原子写 state.json + 部署 desktop/plugin.cjs
├─ desktop/
│  ├─ plugin.cjs                ★桌面插件：托盘条目与行为（Electron 主进程）
│  ├─ tray-hook.js              桌面宿主（注入 main.js 的规范源）
│  ├─ apply-desktop-hook.mjs    注入 / 检查 / 卸载 / 版本迁移
│  └─ hook-test.mjs             用桩 Electron 跑宿主 + 真插件
├─ scripts/
│  ├─ build-catalog.mjs         生成 client.js 的功能目录
│  └─ check.mjs                 注册表、状态、插件契约、语法自检
└─ locale/{en,zh}.json          插件管理器里的标题与描述
```

---

## 五、故障排查

### 插件页看不到 dsh-pro-tools

插件页读的是 profile 的 `dependencies` 与 `dsh.profile.bundles`，不是 `cordis.patch.yml`。只靠一行手写 patch 能跑起来，但不会出现在清单里：

```powershell
# 检查清单里到底有没有
#   plugin_manager action=list_bundles
# 检查 profile manifest
node -e "const j=require('C:/Users/Administrator/.dsh/profiles/desktop/package.json');console.log(j.dependencies, j.dsh.profile.bundles)"
```

缺条目就按上面「安装」重新走一遍 `scripts/install-to-profile.mjs`。

### `cannot resolve profile bundle "<name>"`

目录依赖 + profile 路径别名（junction）导致的相对符号链接断裂。改用 tarball 安装（见上），并把 `node_modules/<name>` 那个悬空链接删掉再装。

### `ERR_PNPM_TARBALL_INTEGRITY`：profile 装啥都失败

如果 profile 依赖里有 GitHub 分支 tarball（如 `.../tar.gz/refs/heads/master`），上游一改，锁文件 integrity 就对不上，**整个 profile 的 pnpm 安装都会卡住**（与本插件无关）。处理顺序：

1. `pnpm store prune` 后重试 `plugin_manager install_bundle`；
2. 仍失败则 `pnpm install --update-checksums`（确认上游没换实现）；
3. 或把该依赖换成固定 commit / 发布版本。

网络受限时的**无 pnpm 兜底**（本机验证过）：

```powershell
New-Item -ItemType Junction `
  -Path "$env:USERPROFILE\.dsh\profiles\desktop\node_modules\dsh-pro-tools" `
  -Target "D:\AI\DeepSeek Harness\dsh-pro-tools"
cd "D:\AI\DeepSeek Harness\dsh-pro-tools"; npm install --omit=dev --no-audit --no-fund
# 再在 profile 的 cordis.patch.yml 末尾插入 insert 行：
#   - insert:
#       - id: pro-tools
#         name: dsh-pro-tools
#         config: { tray: true, features: {} }
```

### 托盘里没有插件条目

1. `node desktop/apply-desktop-hook.mjs --check`：`host: missing` 说明升级后没重跑注入；
2. 注入后必须**重启一次**桌面端（宿主在启动时加载）；
3. 设置页的「桌面托盘」总开关关掉时 `state.json` 会被删除，托盘回到原生菜单；
4. `~/.dsh/pro-tools/desktop/plugin.cjs` 缺失时宿主什么也不渲染——重开一次设置页或重启 bundle 会重新部署。

### 改了 `plugin.cjs` 没生效

宿主按 mtime 重载模块，正常 1.5s 内生效；若文件系统时间精度或 require 缓存挡住，重启一次桌面端即可（`node desktop/hook-test.mjs` 可先验证逻辑）。

---

## 六、English summary

`dsh-pro-tools` splits a desktop feature into the three places it has to live: a **desktop plugin** (`desktop/plugin.cjs`) that runs in the Electron main process and owns tray rows and their behaviour; a thin, marker-delimited **desktop host** injected once into the shell (`desktop/tray-hook.js`, installed by `desktop/apply-desktop-hook.mjs`) that loads the plugin, merges its rows into the shell's own tray menu, and routes clicks back; and a **dsh bundle** whose settings page writes the switch state and deploys the plugin to `~/.dsh/pro-tools`.

Adding a desktop feature = one switch file + one `trayItems` row + `node scripts/build-catalog.mjs`. Toggles and plugin updates reach the tray live via a 1.5 s poll of the state file and the plugin's mtime.

## License

MIT
