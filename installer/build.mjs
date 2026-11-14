// 构建 Windows 桌面启动器安装包（Node SEA）。
// 为什么用 SEA：目标机器不保证装了 Node，注入后的 exe 自带运行时，双击即可安装。
// 为什么把 blob 放在 .workbuddy 下：那是 gitignore 的本机目录，中间文件不会进仓库。
import { copyFileSync, mkdirSync, writeFileSync, rmSync, statSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const work = path.join(root, ".workbuddy", "installer-build");
const outDir = path.join(root, "dist-installer");
const main = path.join(here, "src", "main.cjs");
const FUSE = "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2";

const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
const outName = `StarryStudy-Setup-${pkg.version}.exe`;
const finalExe = path.join(outDir, outName);

rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });
mkdirSync(outDir, { recursive: true });

const blob = path.join(work, "sea-prep.blob");
const cfg = path.join(work, "sea-config.json");
const staged = path.join(work, "StarryStudy-Setup.exe");

writeFileSync(
  cfg,
  JSON.stringify({ main, output: blob, disableExperimentalSEAWarning: true }, null, 2),
  "utf8",
);

console.log("[1/4] 生成 SEA blob");
execFileSync(process.execPath, ["--experimental-sea-config", cfg], { cwd: root, stdio: "inherit" });

console.log("[2/4] 复制当前 Node 可执行文件");
copyFileSync(process.execPath, staged);

console.log("[3/4] 注入 blob");
let cli;
try {
  cli = require.resolve("postject/dist/cli.js");
} catch {
  cli = null;
}
if (cli) {
  execFileSync(
    process.execPath,
    [cli, staged, "NODE_SEA_BLOB", blob, "--sentinel-fuse", FUSE],
    { cwd: root, stdio: "inherit" },
  );
} else {
  // 本地未安装时临时拉取固定版本，保证构建结果可复现。
  execFileSync(
    "npx",
    ["-y", "postject@1.0.0-alpha.6", staged, "NODE_SEA_BLOB", blob, "--sentinel-fuse", FUSE],
    { cwd: root, stdio: "inherit", shell: true },
  );
}

console.log("[4/4] 校验并输出产物");
execFileSync(staged, ["--version"], { stdio: "inherit" });
copyFileSync(staged, finalExe);
rmSync(work, { recursive: true, force: true });

const size = (statSync(finalExe).size / 1024 / 1024).toFixed(1);
console.log(`产物：${finalExe} (${size} MiB)`);
