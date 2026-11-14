"use strict";

// StarryStudy 桌面启动器的 Windows 安装包。
// 为什么是单文件：目标机器不保证装了 Node，所以用 Node SEA 把这段脚本注入 node.exe，
// 得到一个不依赖运行时的原生 exe。同一个 exe 兼任安装器、启动器与卸载器，
// 安装时把自己复制一份到用户目录，快捷方式指向那份副本。

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawn, spawnSync } = require("node:child_process");

const APP = "StarryStudy";
const VERSION = "2.0.0";
const EXE_NAME = "StarryStudy.exe";
const DEFAULT_URL = "https://study.example.com";

// 与 packages/desktop 保持一致：优先标准安装路径，找不到再按命令名启动。
// 必须用独立的 user-data-dir，否则浏览器主进程已存在时 --start-fullscreen 会被转发丢掉。
const WIN_BROWSERS = [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
];

function homeDir() {
  return os.homedir();
}

function localAppData() {
  return process.env.LOCALAPPDATA || path.join(homeDir(), "AppData", "Local");
}

function roamingAppData() {
  return process.env.APPDATA || path.join(homeDir(), "AppData", "Roaming");
}

function installDir(override) {
  return override || path.join(localAppData(), "Programs", APP);
}

function configDir(override) {
  return override || path.join(roamingAppData(), APP);
}

function configFile(override) {
  return path.join(configDir(override), "config.json");
}

function installedExe(override) {
  return path.join(installDir(override), EXE_NAME);
}

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--launch") out.launch = true;
    else if (a === "--uninstall") out.uninstall = true;
    else if (a === "--version" || a === "-v") out.version = true;
    else if (a === "--help" || a === "-h") out.help = true;
    else if (a === "--no-shortcut") out.noShortcut = true;
    // 仅用于构建自检：跳过复制自身，避免把 80MB 的 node.exe 复制到临时目录。
    else if (a === "--skip-copy") out.skipCopy = true;
    else if (a === "--url") out.url = argv[++i];
    else if (a.startsWith("--url=")) out.url = a.slice("--url=".length);
    else if (a === "--install-dir") out.installDir = argv[++i];
    else if (a === "--config-dir") out.configDir = argv[++i];
    else out._.push(a);
  }
  return out;
}

function validUrl(v) {
  if (!v || typeof v !== "string") return false;
  try {
    const u = new URL(v.trim());
    return (u.protocol === "https:" || u.protocol === "http:") && Boolean(u.hostname);
  } catch {
    return false;
  }
}

function psQuote(s) {
  return "'" + String(s).replace(/'/g, "''") + "'";
}

// PowerShell 走临时 .ps1 而不是 -Command：脚本里有中文和大量引号，
// 写成带 BOM 的文件可以避开命令行转义与代码页不一致导致的乱码。
function runPs(script) {
  const tmp = path.join(os.tmpdir(), `starry-${process.pid}-${Date.now()}.ps1`);
  fs.writeFileSync(tmp, "\uFEFF" + script, "utf8");
  try {
    const r = spawnSync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", tmp],
      { encoding: "utf8", windowsHide: true, timeout: 120000 },
    );
    return {
      ok: r.status === 0,
      stdout: (r.stdout || "").trim(),
      stderr: (r.stderr || "").trim(),
    };
  } finally {
    try {
      fs.unlinkSync(tmp);
    } catch {
      // 临时脚本删不掉不影响安装结果。
    }
  }
}

function askUrl() {
  const script = `
Add-Type -AssemblyName Microsoft.VisualBasic
$u = [Microsoft.VisualBasic.Interaction]::InputBox(
  '请输入 StarryStudy 的访问网址（部署完成后绑定的自定义域名）',
  'StarryStudy 安装',
  '${DEFAULT_URL}')
[Console]::Out.Write($u)
`;
  const r = runPs(script);
  if (!r.ok) return null;
  const v = r.stdout.trim();
  return v || null;
}

function createShortcuts(exe, dir, roaming) {
  const startMenu = path.join(roaming, "Microsoft", "Windows", "Start Menu", "Programs", `${APP}.lnk`);
  const script = `
$ws = New-Object -ComObject WScript.Shell
$desktop = $ws.SpecialFolders('Desktop')
$targets = @((Join-Path $desktop '${APP}.lnk'), ${psQuote(startMenu)})
foreach ($p in $targets) {
  $sc = $ws.CreateShortcut($p)
  $sc.TargetPath = ${psQuote(exe)}
  $sc.Arguments = '--launch'
  $sc.WorkingDirectory = ${psQuote(dir)}
  $sc.IconLocation = ${psQuote(exe)} + ',0'
  $sc.Description = '${APP} 桌面启动器'
  $sc.Save()
}
`;
  return runPs(script);
}

function registerUninstall(exe, dir) {
  const uninstall = `"${exe}" --uninstall`;
  const script = `
$key = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${APP}'
New-Item -Path $key -Force | Out-Null
New-ItemProperty -Path $key -Name 'DisplayName' -Value '${APP}' -PropertyType String -Force | Out-Null
New-ItemProperty -Path $key -Name 'DisplayVersion' -Value '${VERSION}' -PropertyType String -Force | Out-Null
New-ItemProperty -Path $key -Name 'Publisher' -Value '${APP}' -PropertyType String -Force | Out-Null
New-ItemProperty -Path $key -Name 'InstallLocation' -Value ${psQuote(dir)} -PropertyType String -Force | Out-Null
New-ItemProperty -Path $key -Name 'DisplayIcon' -Value ${psQuote(exe + ',0')} -PropertyType String -Force | Out-Null
New-ItemProperty -Path $key -Name 'UninstallString' -Value ${psQuote(uninstall)} -PropertyType String -Force | Out-Null
New-ItemProperty -Path $key -Name 'NoModify' -Value 1 -PropertyType DWord -Force | Out-Null
New-ItemProperty -Path $key -Name 'NoRepair' -Value 1 -PropertyType DWord -Force | Out-Null
`;
  return runPs(script);
}

function removeShortcutsAndRegistry(roaming) {
  const startMenu = path.join(roaming, "Microsoft", "Windows", "Start Menu", "Programs", `${APP}.lnk`);
  const script = `
$ws = New-Object -ComObject WScript.Shell
$desktop = $ws.SpecialFolders('Desktop')
$targets = @((Join-Path $desktop '${APP}.lnk'), ${psQuote(startMenu)})
foreach ($p in $targets) { if (Test-Path $p) { Remove-Item $p -Force } }
$key = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${APP}'
if (Test-Path $key) { Remove-Item $key -Force -Recurse }
`;
  return runPs(script);
}

function readConfig(override) {
  const file = configFile(override);
  if (!fs.existsSync(file)) {
    console.error("未找到配置，请先运行安装程序。");
    process.exit(1);
  }
  let url;
  try {
    url = JSON.parse(fs.readFileSync(file, "utf8")).url;
  } catch {
    url = null;
  }
  if (!validUrl(url)) {
    console.error("配置里的网址无效：" + file);
    process.exit(1);
  }
  return url.trim();
}

function launch(url) {
  const profile = path.join(homeDir(), ".starry-study", "desktop-profile");
  fs.mkdirSync(profile, { recursive: true });

  const flags = [
    `--user-data-dir=${profile}`,
    `--app=${url}`,
    "--start-fullscreen",
    "--no-first-run",
    "--no-default-browser-check",
  ];
  const exe = WIN_BROWSERS.find((p) => fs.existsSync(p)) || "msedge";

  // detached + unref：父进程退出后浏览器不受影响，否则窗口会随安装器一起关闭。
  const child = spawn(exe, flags, { detached: true, stdio: "ignore", windowsHide: true });
  child.on("error", (err) => {
    console.error("浏览器启动失败：" + err.message + "，请手动打开 " + url);
    process.exit(1);
  });
  child.unref();
  console.log("已拉起 StarryStudy 窗口：" + url);
}

function install(args) {
  const dir = installDir(args.installDir);
  const cfgDir = configDir(args.configDir);
  const targetExe = installedExe(args.installDir);

  let url = args.url;
  if (!url && !args.noShortcut) url = askUrl();
  if (!validUrl(url)) {
    console.error("未获得有效网址，安装已取消。");
    console.error("可改用静默安装：StarryStudy-Setup.exe --url https://你的域名");
    process.exit(1);
  }
  url = url.trim();

  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(cfgDir, { recursive: true });

  // 复制自身到用户目录；快捷方式与卸载程序都指向这份副本。
  if (!args.skipCopy) fs.copyFileSync(process.execPath, targetExe);
  fs.writeFileSync(configFile(args.configDir), JSON.stringify({ url, version: VERSION }, null, 2), "utf8");

  if (!args.noShortcut) {
    const roaming = roamingAppData();
    const shortcuts = createShortcuts(targetExe, dir, roaming);
    const registry = registerUninstall(targetExe, dir);
    if (!shortcuts.ok || !registry.ok) {
      console.log("提示：快捷方式或卸载信息创建失败，程序仍可手动运行 " + targetExe);
    }
  }

  console.log("安装完成：" + targetExe);
  console.log("访问地址：" + url);
  console.log("首次打开需要登录一次，之后浏览器会记住会话。");
}

function uninstall(args) {
  const dir = installDir(args.installDir);
  const roaming = roamingAppData();
  removeShortcutsAndRegistry(roaming);

  // 正在运行的 exe 不能删自己：交给 cmd 延迟几秒再删整个目录。
  const cmd = `timeout /t 2 /nobreak >nul & rmdir /s /q "${dir}"`;
  const child = spawn("cmd.exe", ["/c", cmd], { detached: true, stdio: "ignore", windowsHide: true });
  child.unref();
  console.log("已卸载 StarryStudy。配置保留在 " + configDir(args.configDir) + "，可直接删除。");
}

function printHelp() {
  const lines = [
    `${APP} ${VERSION} 桌面启动器 / 安装包`,
    "",
    "用法：",
    "  StarryStudy-Setup.exe                    安装（弹窗询问网址）",
    "  StarryStudy-Setup.exe --url <网址>       静默安装，不弹窗",
    "  StarryStudy-Setup.exe --launch           打开已安装的窗口",
    "  StarryStudy-Setup.exe --uninstall       卸载",
    "  StarryStudy-Setup.exe --version         显示版本",
    "",
    "高级参数：--install-dir <目录>  --config-dir <目录>  --no-shortcut",
    "",
    "网址需要先部署好 StarryStudy 服务端（见仓库 docs/SELF-HOSTING.md）。",
  ];
  console.log(lines.join("\n"));
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.version) return console.log(APP + " " + VERSION);
  if (args.help) return printHelp();
  if (args.launch) return launch(readConfig(args.configDir));
  if (args.uninstall) return uninstall(args);

  // 带显式安装参数（静默安装 / 自检）时一律走安装流程。
  const explicit = Boolean(args.url || args.installDir || args.configDir || args.noShortcut || args.skipCopy);
  if (explicit) return install(args);

  // 双击且已经装过：直接打开窗口，避免重复安装。
  if (fs.existsSync(installedExe()) && fs.existsSync(configFile())) {
    return launch(readConfig());
  }
  return install(args);
}

main();
