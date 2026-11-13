// 桌面启动器：用系统浏览器开一个「独立 + 全屏」的应用窗口。本包不含任何业务数据，不联网、
// 不读数据库、不开端口，只负责把一个网址交给浏览器。
//
// W-02 不适用：v1 写 .vbs 是为了静默拉起一个常驻 Node 服务；v2 的桌面启动器由根命令
//   `npm run desktop`（tsx packages/desktop/src/index.ts）直接跑，不需要 VBScript / .bat
//   启动器，因此不涉及 UTF-16LE + BOM 那套编码坑，本包不写任何 .vbs / .bat。
// W-04 不适用：v2 云端是唯一数据源，本机没有服务器、不监听端口，自然没有 EADDRINUSE 与
//   「先认端口归属再决定动作」的逻辑；v1 的 looksLikeOurApp 那套不要照搬。
// 端口 / 服务相关的逻辑都在 Worker 与采集器里，与这个窗口无关。

import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { readAppUrl, nodeProcess } from "./env.ts";

// 标准安装路径。找不到再退化成按命令名启动，最后才退回系统默认浏览器（不会全屏）。
const WIN_BROWSERS = [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
];
const MAC_BROWSERS = [
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
];
const LINUX_BROWSERS = [
  "/usr/bin/microsoft-edge",
  "/usr/bin/microsoft-edge-stable",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
];

function candidates(platform: string): string[] {
  if (platform === "win32") return WIN_BROWSERS;
  if (platform === "darwin") return MAC_BROWSERS;
  return LINUX_BROWSERS;
}

function launch(url: string, platform: string): void {
  // 必须是「独立」的配置目录，而不是浏览器默认 profile。
  // 为什么：--start-fullscreen 是启动开关。当用户本来就用 Edge / Chrome 上着网（浏览器主
  // 进程已存在）时，新起的 msedge.exe 只会把命令行转发给已有进程、由它开窗口，启动开关
  // 不再生效，开出来就是一个普通大小的 --app 窗口。给一个专属配置目录等于强制起一个
  // 全新的浏览器进程，开关必然生效。这个目录是持久的（不是每次新建的临时目录）：登录
  // 会话存在它里面，第一次要重新登录一次，之后一直记住。
  const profileDir = join(homedir(), ".starry-study", "desktop-profile");
  mkdirSync(profileDir, { recursive: true });

  const flags = [
    `--user-data-dir=${profileDir}`,
    `--app=${url}`,
    "--start-fullscreen",
    "--no-first-run",
    "--no-default-browser-check",
  ];

  const exe = candidates(platform).find(existsSync);
  let command: string;
  let args: string[];
  if (exe) {
    command = exe;
    args = flags;
  } else if (platform === "win32") {
    command = "msedge";
    args = flags;
    console.log("未在标准路径找到 Edge / Chrome，尝试按命令名启动（可能不是全屏）。");
  } else if (platform === "darwin") {
    command = "open";
    args = [url];
    console.log("未找到 Chrome / Edge，退回系统默认浏览器（不会全屏）。");
  } else {
    command = "xdg-open";
    args = [url];
    console.log("未找到 Chrome / Edge，退回系统默认浏览器（不会全屏）。");
  }

  // W-03：用 exec() 时父进程一退浏览器会跟着死，表现为「第一次能开、之后打不开」。
  // detached 让浏览器成为独立进程组，父进程怎么退都与它无关；stdio 必须 ignore，否则
  // 父进程的管道句柄被继承、退不干净；unref 让父进程不必等子进程就能结束。
  const child = spawn(command, args, { detached: true, stdio: "ignore" });
  child.on("error", (err) => {
    console.error("浏览器启动失败：" + err.message + "，请手动打开 " + url);
    nodeProcess().exit(1);
  });
  child.unref();

  // 短暂留住父进程，让 spawn 找不到可执行文件时抛出的 ENOENT 有机会通过上面的 'error'
  // 监听报出来；detached 已保证浏览器独立，这段停留不影响窗口（W-03）。
  setTimeout(() => undefined, 300);
  console.log("已拉起浏览器独立窗口。");
}

function main(): void {
  const proc = nodeProcess();
  try {
    launch(readAppUrl(), proc.platform);
  } catch (e) {
    console.error((e as Error).message);
    proc.exit(1);
  }
}

main();
