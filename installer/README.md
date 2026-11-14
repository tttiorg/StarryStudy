# Windows 桌面启动器安装包

这个目录用来构建 Release 里的 `StarryStudy-Setup-<版本>.exe`。
生成的 exe 是 Node SEA 单文件，**目标机器不需要安装 Node**，双击即可安装。

## 安装包装了什么

- 把启动器复制到 `%LOCALAPPDATA%\Programs\StarryStudy\`
- 在 `%APPDATA%\StarryStudy\config.json` 写入你的访问网址
- 创建桌面与开始菜单快捷方式，并写入「添加或删除程序」的卸载项
- 启动器用 Edge / Chrome 以独立配置目录打开 `--app` 全屏窗口，不驻留后台、不监听端口

启动器本身不含任何业务数据，也不联网，只负责把网址交给浏览器。

## 用法

双击 exe，在弹出的输入框里填入**你自己部署好的** StarryStudy 网址（自定义域名），
安装完成后从桌面快捷方式打开即可。首次需要登录一次，之后浏览器会记住会话。

静默安装：

```text
StarryStudy-Setup.exe --url https://你的域名
```

其它参数：

| 参数 | 作用 |
|---|---|
| `--launch` | 打开已安装的窗口（快捷方式用） |
| `--uninstall` | 卸载（移除快捷方式与卸载项） |
| `--version` / `--help` | 版本与帮助 |
| `--install-dir <目录>` / `--config-dir <目录>` | 自定义安装与配置位置 |
| `--no-shortcut` | 不创建快捷方式与卸载项 |

网址需要先部署好 StarryStudy 服务端，步骤见仓库 [`docs/SELF-HOSTING.md`](../docs/SELF-HOSTING.md)。

## 从源码构建

前置：Windows + Node 22（与 CI 一致）。

```bash
npm ci
node installer/build.mjs
```

产物在 `dist-installer/StarryStudy-Setup-<版本>.exe`。
构建会把 `installer/src/main.cjs` 注入当前 Node 的 `node.exe`，因此生成的 exe
与构建机 Node 版本一致；blob 等中间文件构建完自动清理。
