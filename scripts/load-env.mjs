/* 采集器启动前的 .env 预加载（用 node --import 注入）。
 *
 * 为什么不用 node --env-file / --env-file-if-exists：这两个选项要 Node 20.6 / 22.9
 * 以上，用户机器上是通过系统 PATH 找到的 Node 20，而 CI 和开发环境可能是 22，
 * 用版本相关的选项会让「在我这儿能跑、在你那儿报 bad option」。这里只用 fs，
 * 任何 Node 18+ 行为一致。
 *
 * 另外 --env-file 会把值里的 # 当行内注释截断（密码含 # 就悄悄少一截），
 * 自己解析则保留 #，并且让已存在的系统环境变量优先、不覆盖。
 *
 * .env 不存在时静默跳过：让采集器自己打印「缺少必要配置」的友好提示，
 * 而不是在这里抛一个看不懂的 ENOENT（等价于 --env-file-if-exists 的语义）。 */
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// 相对脚本自身定位项目根，这样从任何 cwd 启动都能找到同一份 .env
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const envPath = join(root, ".env");

if (existsSync(envPath)) {
  for (const raw of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let value = line.slice(eq + 1).trim();
    // 去掉成对的引号，不解析转义（本项目的值都是纯文本）
    if (
      value.length >= 2 &&
      ((value[0] === '"' && value[value.length - 1] === '"') ||
        (value[0] === "'" && value[value.length - 1] === "'"))
    ) {
      value = value.slice(1, -1);
    }
    // 命令行 / 系统里已经给过的优先，不拿 .env 覆盖
    if (process.env[key] === undefined) process.env[key] = value;
  }
}
