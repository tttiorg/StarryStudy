import { createRouter, createWebHistory } from "vue-router";

// History 模式：断言地址是 /subjects/<id>，不是 /#/subjects/<id>（FE-07）。
// Worker 在 /api/* 之后才回退 index.html，SPA 深链接由它兜底。
const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: "/",
      name: "home",
      component: () => import("@/views/Home.vue"),
      meta: { title: "主页" },
    },
    {
      path: "/timetable",
      name: "timetable",
      component: () => import("@/views/TimetableView.vue"),
      meta: { title: "课表" },
    },
    {
      path: "/subjects/:id",
      name: "subject",
      component: () => import("@/views/SubjectView.vue"),
      props: true,
      meta: { title: "学科" },
    },
    {
      path: "/:pathMatch(.*)*",
      name: "notfound",
      component: () => import("@/views/NotFound.vue"),
      meta: { title: "未找到" },
    },
  ],
});

router.afterEach((to) => {
  const t = to.meta.title ? `${String(to.meta.title)} · StarryStudy` : "StarryStudy";
  document.title = t;
});

export default router;
