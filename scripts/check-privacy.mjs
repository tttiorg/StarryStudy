// 提交前自检：§4.5 两条命令的跨平台实现。
// 用 Node 递归扫描而不是 grep，因为 Windows 上没有可靠的 grep -rInE。
// 命中即退出码 1，CI 和 pre-commit 都调它。
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, relative, extname } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const SKIP_DIRS = new Set([
  "node_modules", ".git", "dist", ".wrangler", ".workbuddy", "coverage", "data",
]);
// 锁文件是机器生成的依赖清单，不是人写的源码；本地私有配置由 git 口径天然排除。
const SKIP_FILES = new Set(["package-lock.json"]);
const TEXT_EXT = new Set([
  ".ts", ".tsx", ".js", ".mjs", ".cjs", ".vue", ".json", ".toml", ".yaml", ".yml",
  ".md", ".sql", ".html", ".css", ".sh", ".env", ".example", ".gitignore", "",
]);

// 规则一：真实 IP / 学校域名。故意拼接关键字，避免本文件自己命中。
const infraRe = new RegExp(
  String.raw`([0-9]{1,3}\.){3}[0-9]{1,3}|` + ["sus" + "tech", "edu" + "\\.cn"].join("|"),
  "i",
);
// 规则二：疑似硬编码凭据。
const credRe = new RegExp(
  "(pass" + "word|pass" + "wd|sec" + "ret|to" + "ken)" + String.raw`\s*[:=]\s*['"][^'"]{6,}`,
  "i",
);

function walk(dir, out) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (!SKIP_DIRS.has(name)) walk(full, out);
      continue;
    }
    if (SKIP_FILES.has(name)) continue;
    if (!TEXT_EXT.has(extname(name)) && !name.startsWith(".env")) continue;
    if (st.size > 2 * 1024 * 1024) continue;
    out.push(full);
  }
}

// 优先按「会被提交的内容」取文件：git 已跟踪 + 未跟踪但未被忽略。
// 本机参考资料（.workbuddy/）、本地密钥（.dev.vars）、构建产物都由 gitignore 天然排除，
// 这比扫描整个目录更贴近 §4.5「提交前自检」的语义。
// 没有 git（例如从 zip 解压）时回退到目录扫描。
function gitFiles() {
  try {
    const out = execFileSync(
      "git", ["ls-files", "--cached", "--others", "--exclude-standard"],
      { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    );
    return out.split(/\r?\n/).filter(Boolean).map((p) => join(ROOT, p));
  } catch {
    return null;
  }
}

function usable(full) {
  const name = basename(full);
  if (SKIP_FILES.has(name)) return false;
  if (!TEXT_EXT.has(extname(name)) && !name.startsWith(".env")) return false;
  try {
    const st = statSync(full);
    return st.isFile() && st.size <= 2 * 1024 * 1024;
  } catch {
    return false;
  }
}

const listed = gitFiles();
const files = listed ? listed.filter(usable) : [];
if (!files.length) walk(ROOT, files);
const hits = [];
for (const file of files) {
  const text = readFileSync(file, "utf8");
  text.split(/\r?\n/).forEach((line, i) => {
    // 回环地址与虚构域名不泄露任何基础设施信息，先抹掉再检查。
    // 不用「整行放行」：同一行里若还藏着真实 IP 或学校域名，仍然会被抓出来。
    const scrubbed = line
      .replace(/127(?:\.\d{1,3}){3}|0(?:\.\d{1,3}){3}|localhost|\[::1\]/gi, "LOCAL")
      .replace(/example\.(?:com|org|net)/gi, "EXAMPLE");
    if (infraRe.test(scrubbed)) hits.push([file, i + 1, "真实地址/学校域名", line.trim()]);
    else if (credRe.test(scrubbed)) hits.push([file, i + 1, "疑似硬编码凭据", line.trim()]);
  });
}

if (hits.length) {
  console.error(`隐私自检未通过，命中 ${hits.length} 处：`);
  for (const [file, line, why, text] of hits) {
    console.error(`  ${relative(ROOT, file)}:${line} [${why}] ${text.slice(0, 160)}`);
  }
  process.exit(1);
}
console.log(`隐私自检通过：扫描 ${files.length} 个文件，两条规则全绿。`);
