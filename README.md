# dsh-pro-tools

给 **DeepSeek Harness** 桌面端用的可扩展增强工具包：一个 Cordis bundle，自带一个设置页（每个功能一个开关）和一个托盘菜单集成层。

* **宿主机（Host）半**：读取 bundle 的 Config（`tray`、`features`），把已启用功能贡献的托盘条目写成 `~/.dsh/pro-tools/tray.json`。
* **浏览器（Client）半**：在「设置 → 增强工具」里渲染开关，通过官方 `ctx.remote.settings` 接口读写 Config，不碰文件、不碰托盘。
* **桌面钩子**：`desktop/tray-hook.js` 是唯一需要注入桌面外壳 `resources/app/lib/main.js` 的一段代码。它读取上面的 JSON 并合并进托盘右键菜单，轮询文件变化，改开关后菜单实时更新。

```
设置页开关 ──> ctx.remote.settings.update ──> bundle Config 重新 apply
                                                   │
                                                   ▼
                                      ~/.dsh/pro-tools/tray.json
                                                   │（轮询）
                                                   ▼
                              桌面托盘右键菜单（由 hook 合并原生菜单项）
```

> 现状：`restart-tray`（托盘「重启 DeepSeek Harness」）默认开启，`open-state-folder`（托盘打开数据目录）默认关闭，用来演示第二种功能形态。

---

## 一、安装

### 1. 装 bundle（Host + Client 插件本体）

```powershell
# 在 Harness 里让 agent 执行，或直接用插件管理器安装这个目录：
#   plugin_manager  action=install_bundle  target="<绝对路径>\dsh-pro-tools"
```

安装后 `cordis.patch.yml` 会往 profile 里插入一行 `pro-tools`，设置页出现「增强工具」，`~/.dsh/pro-tools/tray.json` 立即被写入。

### 2. 装桌面钩子（托盘集成，一次性）

托盘在 Electron 主进程里，插件摸不到，所以要把这段代码注入桌面外壳：

```powershell
node "D:\path\to\dsh-pro-tools\desktop\apply-desktop-hook.mjs" --main "D:\Programs\DeepSeek Harness\resources\app\lib\main.js"
```

然后重启一次 DeepSeek Harness。检查/卸载：

```powershell
node desktop/apply-desktop-hook.mjs --check        # 是否已注入、是否是最新版本
node desktop/apply-desktop-hook.mjs --uninstall    # 只移除注入区段
```

脚本行为：

* 用 `// >>> dsh-pro-tools tray hook v1` / `// <<< ...` 标记区段，**幂等**，重复运行只会刷新区段；
* 写入前先 `node --check`，语法不过不落盘；
* 自动把原型期的手改（硬编码的 `restartTrayApplication` 菜单项与文案）清掉，避免出现两个「重启」；
* 备份到 `main.js.dsh-pro-tools.<时间戳>.bak` 以及 `~/.dsh/pro-tools/backups/`。

**DeepSeek Harness 升级后**：`resources/app` 会被替换，钩子随之消失——重新跑一次上面的命令即可，插件本体与配置不受影响。`--check` 可以直接看出是否需要重跑。

---

## 二、加一个新功能

1. 新建 `features/<id>.js`：

```js
export const meta = {
  id: 'my-feature',
  order: 30,
  defaultEnabled: false,
  title: { zh: '我的功能', en: 'My feature' },
  description: { zh: '一句话说明它做什么。', en: 'One line about what it does.' },
};

// 可选：往托盘贡献条目
export function tray(context) {
  return [{
    id: 'row',
    order: 10,
    labels: { zh: '我的托盘项', en: 'My tray row' },
    action: { type: 'openUrl', url: 'https://example.com' },  // 或 builtin: open/restart/quit、openPath
  }];
}
```

2. 在 `features/index.js` 的 `SOURCE` 里 import 并登记它。

3. `node scripts/build-catalog.mjs`，把功能元数据投影进 `client.js` 的生成区段。

4. `node scripts/check.mjs` 与 `node desktop/hook-test.mjs` 全绿即可。设置页会自动多出一个开关，无需改 UI、Config、托盘代码。

只想加一个「开关 + 什么都没接」的功能，第 1 步不写 `tray()` 即可——它就是一个纯开关，供后续逻辑读取。

---

## 三、为什么这样设计（升级韧性）

| 层 | 依赖的稳定面 | 升级时的影响 |
|---|---|---|
| Host 半 | Cordis `apply(ctx, config)`、`Config`（schemastery）、Node `fs` | 几乎不受影响 |
| Client 半 | `settings.section` 插槽、`ctx.remote.settings.describe/update`、locale 服务 | 官方设置页一直用这套接口 |
| 托盘钩子 | `tray`、`Menu`、`app`、`shell`、`currentDesktopLocale`、`focusPrimaryWindow`、`quitWithoutConfirmation` | 只在 `main.js` 结构大改时失效，重跑脚本即可；脚本找不到锚点会打印整段代码供手工放置 |

钩子的关键取舍：

* **合并而不是重建**：注入时临时劫持 `Menu.buildFromTemplate`，抓到桌面外壳自己的菜单模板，再把贡献条目插到最后一个分隔符之前——未来 Harness 往托盘加新项（比如「检查更新」）不会被吞掉。
* **零信任输入**：状态文件损坏、条目缺字段、条目过多（>12）都被丢弃或截断，菜单永远回落到原生形态。
* **不可用即降级**：任何一步抛错都只 `console.warn`，不会让 `main.js` 起不来。

---

## 四、目录结构

```
dsh-pro-tools/
├─ index.js                     Host 半：Config + 写 tray.json
├─ client.js                    浏览器半：设置页 + 开关（含生成的 catalog）
├─ cordis.patch.yml             bundle 行（id: pro-tools）
├─ features/
│  ├─ index.js                  功能注册表（唯一需要改的汇总文件）
│  ├─ restart-tray.js           托盘「重启 DeepSeek Harness」
│  └─ open-state-folder.js      托盘打开数据目录（默认关）
├─ lib/
│  ├─ paths.js                  DSH_HOME / ~/.dsh 路径规则
│  └─ tray-file.js              原子写 tray.json
├─ desktop/
│  ├─ tray-hook.js              注入 main.js 的规范源（可独立测试）
│  ├─ apply-desktop-hook.mjs    注入 / 检查 / 卸载
│  └─ hook-test.mjs             用桩 Electron 跑一遍托盘合并逻辑
├─ scripts/
│  ├─ build-catalog.mjs         生成 client.js 的功能目录
│  └─ check.mjs                 注册表、托盘投影、写文件、语法自检
└─ locale/{en,zh}.json          插件管理器里的标题与描述
```

---

## 五、故障排查

### `ERR_PNPM_TARBALL_INTEGRITY`：profile 装啥都失败

如果 profile 的依赖里有 GitHub 分支 tarball（例如 `https://codeload.github.com/<user>/<repo>/tar.gz/refs/heads/master`），上游分支一改，锁文件里的 integrity 就对不上，**整个 profile 的 pnpm 安装都会被卡住**（与本插件无关）：

```
ERR_PNPM_TARBALL_INTEGRITY  Got unexpected checksum for ".../tar.gz/refs/heads/master"
```

处理顺序：

1. `pnpm store prune` 后重试 `plugin_manager install_bundle`；
2. 仍失败则 `pnpm install --update-checksums`（接受上游新内容，注意确认上游没换实现）；
3. 或把该依赖从分支 tarball 换成固定 commit / 发布版本。

在本机验证过的**无 pnpm 兜底安装**（网络受限时可用）：

```powershell
# 1) 让包可以被 profile 解析
New-Item -ItemType Junction `
  -Path "$env:USERPROFILE\.dsh\profiles\desktop\node_modules\dsh-pro-tools" `
  -Target "D:\AI\DeepSeek Harness\dsh-pro-tools"

# 2) 补运行时依赖（schemastery）
cd "D:\AI\DeepSeek Harness\dsh-pro-tools"; npm install --omit=dev --no-audit --no-fund

# 3) 在 profile 的 cordis.patch.yml 末尾插入这一行（Loader 会热加载）
#    - insert:
#        - id: pro-tools
#          name: dsh-pro-tools
#          config:
#            tray: true
#            features: {}
```

这种装法下 `plugin_manager` 不接管该包，改代码后刷新页面即可（Client 半从链接目录读取）。

### 托盘里没有「重启 DeepSeek Harness」

1. `node desktop/apply-desktop-hook.mjs --check`：`hook: missing` 说明升级后没重跑注入；
2. 注入后必须**重启一次**桌面端（托盘菜单在启动时构建）；
3. 设置页里的「桌面托盘」总开关若被关掉，`tray.json` 会被删除，托盘回到原生菜单。

---

## 六、English summary

`dsh-pro-tools` is an installable Cordis bundle for the DeepSeek Harness desktop app. The Host half publishes enabled tray contributions to `~/.dsh/pro-tools/tray.json`; the browser half renders a **Pro Tools** settings page with one switch per feature and writes the bundle Config through `ctx.remote.settings`. Because Electron tray menus live in the main process, one small, marker-delimited, idempotent hook (`desktop/tray-hook.js`, installed by `desktop/apply-desktop-hook.mjs`) merges the published rows into the shell's own tray menu and polls the file, so toggling a switch updates the tray without restarting.

Adding a feature is a file plus two registrations: `features/<id>.js` → `features/index.js` → `node scripts/build-catalog.mjs`.

## License

MIT
