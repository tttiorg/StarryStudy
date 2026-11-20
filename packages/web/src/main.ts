import { createApp } from "vue";
import { createPinia } from "pinia";
import ElementPlus from "element-plus";
import zhCn from "element-plus/es/locale/lang/zh-cn";

import "element-plus/dist/index.css";
import "element-plus/theme-chalk/dark/css-vars.css";
// theme.css 必须在 Element Plus 之后：html.dark / html.light 里要压过它的 --el-* 默认值
import "@/styles/theme.css";
import "@/styles/app.css";
import "@/styles/boot.css";

import App from "./App.vue";
import router from "./router";

const app = createApp(App);
app.use(createPinia());
app.use(router);
app.use(ElementPlus, { locale: zhCn });
app.mount("#app");
