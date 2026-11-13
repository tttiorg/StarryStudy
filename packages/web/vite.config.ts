import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

// 不引入 node:url：本包没装 @types/node，用 URL 自己算绝对路径。
// Windows 下 file: URL 的 pathname 会多一个前导斜杠（/D:/...），要剥掉。
function fromHere(rel: string): string {
  const p = decodeURIComponent(new URL(rel, import.meta.url).pathname);
  return (/^\/[A-Za-z]:/.test(p) ? p.slice(1) : p).replace(/\\/g, "/");
}

// 静态资源和 API 同域，挂在根路径下。wrangler.toml 的 [assets].directory
// 指向这里的 dist，所以 outDir 只能是 dist、base 只能是 /。
export default defineConfig({
  base: "/",
  plugins: [vue()],
  resolve: {
    alias: {
      "@": fromHere("./src"),
      "@starry/shared": fromHere("../shared/src/index.ts"),
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      output: {
        // 把框架与 UI 库固定在独立 chunk，避免懒加载页面之间出现循环依赖
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          if (id.includes("element-plus")) return "ui";
          if (id.includes("/vue/") || id.includes("vue-router") || id.includes("pinia")) {
            return "vendor";
          }
          return "deps";
        },
      },
    },
  },
  server: {
    port: 5173,
    // 单独跑 vite 时把 API 转给本机 wrangler dev；不写 IP 字面量，避免隐私自检误判
    proxy: {
      "/api": "http://localhost:8787",
    },
  },
});
