<template>
  <div class="nf">
    <div class="nf-code">404</div>
    <p class="nf-text">没有找到这个页面</p>
    <router-link class="ss-btn primary" to="/">回到主页</router-link>
  </div>
</template>

<script setup lang="ts"></script>

<style scoped>
.nf {
  min-height: 60dvh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
}

.nf-code {
  font-size: 54px;
  font-weight: 700;
  color: var(--ss-accent);
  letter-spacing: 2px;
}

.nf-text {
  margin: 0;
  color: var(--ss-muted);
  font-size: 13.5px;
}
</style>
