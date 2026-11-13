// 逐跳手动跟重定向是硬要求：fetch 自动跟会丢掉中间跳的 Set-Cookie，
// 表现是登录「成功」却没拿到会话（BB-03）。所以这里自己循环、每跳吸 cookie。
import { nowIso } from "@starry/shared";

export const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0 Safari/537.36 Edg/120.0";

export interface Hop {
  url: string;
  status: number;
  location: string;
}

export interface HttpResponse {
  status: number;
  url: string;       // 最终落地 URL（判会话过期靠它）
  location: string;  // 最后一跳的 Location（不跟随重定向时靠它判过期）
  body: string;
  hops: Hop[];
}

export interface RequestOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string | URLSearchParams;
  // 默认跟随；streamViewer 要用 false，因为 3xx 本身就是「会话过期」的信号
  followRedirects?: boolean;
  timeoutMs?: number;
}

// node: 模块用变量字符串动态导入：运行时 Node 正常解析，类型检查又不会被
// 缺 @types/node 卡住。IDE 里给一份最小形状，避免整片 any。
interface FsPromisesLike {
  mkdir(p: string, opts: { recursive: boolean }): Promise<unknown>;
  writeFile(p: string, data: string, enc: string): Promise<void>;
}
interface PathLike {
  dirname(p: string): string;
  resolve(...parts: string[]): string;
  join(...parts: string[]): string;
}
interface UrlLike {
  fileURLToPath(u: string): string;
}

export class HttpClient {
  readonly jar = new Map<string, string>();
  private readonly userAgent: string;
  private readonly timeoutMs: number;
  private readonly maxHops: number;

  constructor(opts: { userAgent?: string; timeoutMs?: number; maxHops?: number } = {}) {
    this.userAgent = opts.userAgent ?? USER_AGENT;
    this.timeoutMs = opts.timeoutMs ?? 20_000;
    this.maxHops = opts.maxHops ?? 8;
  }

  clearJar(): void {
    this.jar.clear();
  }

  private cookieHeader(): string {
    return Array.from(this.jar.entries())
      .map(([k, v]) => `${k}=${v}`)
      .join("; ");
  }

  private absorb(res: Response): void {
    // Node 20 有 getSetCookie()；老环境回退只拿到第一条（BB-06）
    const h = res.headers as unknown as {
      getSetCookie?: () => string[];
      get(name: string): string | null;
    };
    const raw: Array<string | null> =
      typeof h.getSetCookie === "function" ? h.getSetCookie() : [h.get("set-cookie")];
    for (const item of raw) {
      if (!item) continue;
      const first = String(item).split(";")[0];
      const eq = first.indexOf("=");
      if (eq < 0) continue;
      const name = first.slice(0, eq).trim();
      let value = first.slice(eq + 1).trim();
      if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
      // 值为空 = 服务端在删这个 cookie，必须从罐里移除而不是留个空串
      if (!value) this.jar.delete(name);
      else this.jar.set(name, value);
    }
  }

  /** BB 种会话时会带这几个名字之一；没有就说明登录还没真正落地。 */
  hasSessionCookie(): boolean {
    for (const k of this.jar.keys()) {
      if (/s_session_id|BbRouter|JSESSIONID|BbSecure/i.test(k)) return true;
    }
    return false;
  }

  async request(url: string, opts: RequestOptions = {}): Promise<HttpResponse> {
    const follow = opts.followRedirects !== false;
    const baseHeaders: Record<string, string> = {
      "User-Agent": this.userAgent,
      "Accept-Language": "zh-CN,zh;q=0.9",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      ...(opts.headers ?? {}),
    };

    let cur = url;
    let method = opts.method ?? "GET";
    let body = opts.body;
    const hops: Hop[] = [];
    const loop = follow ? this.maxHops : 1;

    for (let i = 0; i < loop; i += 1) {
      const headers = { ...baseHeaders };
      const ck = this.cookieHeader();
      if (ck) headers.Cookie = ck;

      let payload: string | undefined;
      if (body instanceof URLSearchParams) {
        headers["Content-Type"] = "application/x-www-form-urlencoded; charset=UTF-8";
        payload = body.toString();
      } else {
        payload = body;
      }

      const res = await fetch(cur, {
        method,
        headers,
        body: payload,
        redirect: "manual",
        signal: AbortSignal.timeout(opts.timeoutMs ?? this.timeoutMs),
      });
      this.absorb(res);

      const loc = res.headers.get("location") ?? "";
      hops.push({ url: cur, status: res.status, location: loc });

      if (follow && res.status >= 300 && res.status < 400 && loc) {
        cur = new URL(loc, cur).toString();
        method = "GET"; // 302 之后一律转 GET（浏览器行为）
        body = undefined;
        continue;
      }

      const text = await res.text();
      return { status: res.status, url: cur, location: loc, body: text, hops };
    }
    throw new Error(`重定向次数过多（超过 ${this.maxHops} 跳），停在 ${cur}`);
  }
}

/**
 * 失败时留证据（BB-07）。只回路径、不把 HTML 打到屏上。
 * 落在仓库根的 .workbuddy/bb-debug/，该目录已被根 .gitignore 排除；
 * 落盘失败不能盖住原始故障，所以这里吞掉 IO 错、返回空串。
 * nowIso() 只用于给文件命名，不参与任何业务日期判断。
 */
export async function dumpDebugHtml(label: string, html: string): Promise<string> {
  try {
    const fsMod = "node:fs/promises";
    const pathMod = "node:path";
    const urlMod = "node:url";
    const fs = (await import(fsMod)) as FsPromisesLike;
    const path = (await import(pathMod)) as PathLike;
    const { fileURLToPath } = (await import(urlMod)) as UrlLike;

    const here = path.dirname(fileURLToPath(import.meta.url)); // src/
    const root = path.resolve(here, "../../..");                // src -> collector -> packages -> 仓库根
    const dir = path.join(root, ".workbuddy", "bb-debug");
    await fs.mkdir(dir, { recursive: true });
    const stamp = nowIso().replace(/[:.]/g, "-");
    const file = path.join(dir, `${label}-${stamp}.html`);
    await fs.writeFile(file, html, "utf8");
    return file;
  } catch {
    return "";
  }
}

/** 用配置里的域名判断，绝不写死任何学校域名。 */
export function sameHost(a: string, b: string): boolean {
  try {
    return new URL(a).hostname === new URL(b).hostname;
  } catch {
    return false;
  }
}
