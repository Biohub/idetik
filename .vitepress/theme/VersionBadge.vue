<template>
  <span class="api-version-badge">version {{ version }}</span>
</template>

<script setup>
const version = __IDETIK_VERSION__;
</script>

<style scoped>
.api-version-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  vertical-align: 3px;
  margin-left: 8px;
  padding: 2px 10px;
  border: 1px solid var(--vp-c-border);
  border-radius: var(--radius-pill);
  font-size: 12px;
  font-weight: 500;
  letter-spacing: normal;
  line-height: 1.6;
  color: var(--vp-c-text-2);
}

.api-version-badge::before {
  content: "";
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background-color: #26bd6c;
}
</style>
