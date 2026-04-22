<script setup lang="ts">
import { ref } from "vue";
import { useI18n } from "../composables/useI18n";
import BaseModal from "./BaseModal.vue";

const { t } = useI18n();

const emit = defineEmits<{
  close: [];
  push: [];
}>();

const pushing = ref(false);

async function handlePush() {
  pushing.value = true;
  emit("push");
}
</script>

<template>
  <BaseModal
    size="sm"
    hide-header
    :aria-label="t('merge.successTitle')"
    @close="emit('close')"
  >
    <div class="msm-body">
      <div class="msm-icon">
        <svg width="48" height="48" viewBox="0 0 48 48" fill="none" aria-hidden="true">
          <circle cx="24" cy="24" r="24" />
          <path d="M15 24.5l6 6L33 18" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </div>

      <h2 class="msm-title">{{ t('merge.successTitle') }}</h2>
      <p class="msm-desc">{{ t('merge.successDesc') }}</p>
    </div>

    <template #footer>
      <button class="bm-btn bm-btn--ghost" @click="emit('close')">
        {{ t('merge.successClose') }}
      </button>
      <button class="bm-btn bm-btn--primary" @click="handlePush" :disabled="pushing">
        <svg v-if="!pushing" width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M8 12V3M4 7l4-4 4 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M2 14h12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
        </svg>
        <span v-if="pushing" class="msm-spinner"></span>
        {{ t('merge.successPush') }}
      </button>
    </template>
  </BaseModal>
</template>

<style scoped>
.msm-body {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: var(--space-4);
  padding: var(--space-3) var(--space-2) var(--space-2);
}

.msm-icon svg circle { fill: var(--color-success-soft); }
.msm-icon svg path   { stroke: var(--color-success); }

.msm-title {
  margin: 0;
  font-size: var(--font-size-xl);
  font-weight: var(--font-weight-semibold);
  color: var(--color-text);
}

.msm-desc {
  margin: 0;
  font-size: var(--font-size-md);
  color: var(--color-text-muted);
  line-height: var(--line-height-normal);
}

.msm-spinner {
  width: 14px;
  height: 14px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-top-color: #fff;
  border-radius: 50%;
  animation: msm-spin 0.6s linear infinite;
}

@keyframes msm-spin {
  to { transform: rotate(360deg); }
}
</style>
