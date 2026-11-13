// 本仓库的 typecheck（根 tsconfig.json）只装了 @cloudflare/workers-types（面向 Worker），
// 没有 @types/node。桌面启动器是唯一跑在 Node 里的包，为了让 `npm run typecheck` 能覆盖它、
// 又不必给公开仓库新增依赖（也避免 npm ci 与已有 lockfile 不一致），这里按需声明本包实际
// 调用到的内置模块签名。只声明用得到的几个函数，不做完整的 Node 类型补齐。

declare module "node:child_process" {
  export interface ChildProcess {
    unref(): void;
    on(event: "error", listener: (err: Error) => void): ChildProcess;
  }
  export function spawn(
    command: string,
    args: readonly string[],
    options: { detached?: boolean; stdio?: "ignore" },
  ): ChildProcess;
}

declare module "node:fs" {
  export function readFileSync(path: string, encoding: "utf8"): string;
  export function existsSync(path: string): boolean;
  export function mkdirSync(path: string, options?: { recursive?: boolean }): void;
}

declare module "node:os" {
  export function homedir(): string;
}

declare module "node:path" {
  export function join(...parts: string[]): string;
  export function resolve(...parts: string[]): string;
}

declare module "node:url" {
  export function fileURLToPath(url: string | URL): string;
}
