<template>
  <div class="fixed inset-0 z-50 bg-black/30 flex items-center justify-center" data-testid="skill-schedule-dialog" @click="emit('cancel')">
    <div
      class="bg-white rounded-lg shadow-xl w-96 max-w-[90vw] p-5 space-y-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="skill-schedule-dialog-title"
      @click.stop
    >
      <h3 id="skill-schedule-dialog-title" class="text-base font-semibold text-gray-800">
        {{ t("pluginManageSkills.scheduleTitle", { name: skillName }) }}
      </h3>

      <div class="flex gap-2" role="radiogroup" :aria-label="t('pluginManageSkills.scheduleTypeLabel')">
        <button
          type="button"
          class="h-8 px-2.5 flex items-center gap-1 text-sm rounded border"
          :class="scheduleType === 'daily' ? 'bg-blue-50 border-blue-500 text-blue-700' : 'border-gray-300 text-gray-600 hover:bg-gray-50'"
          data-testid="skill-schedule-type-daily"
          @click="scheduleType = 'daily'"
        >
          {{ t("pluginManageSkills.scheduleDaily") }}
        </button>
        <button
          type="button"
          class="h-8 px-2.5 flex items-center gap-1 text-sm rounded border"
          :class="scheduleType === 'interval' ? 'bg-blue-50 border-blue-500 text-blue-700' : 'border-gray-300 text-gray-600 hover:bg-gray-50'"
          data-testid="skill-schedule-type-interval"
          @click="scheduleType = 'interval'"
        >
          {{ t("pluginManageSkills.scheduleInterval") }}
        </button>
      </div>

      <label v-if="scheduleType === 'daily'" class="block text-xs text-gray-600">
        {{ t("pluginManageSkills.scheduleTimeLabel") }}
        <input
          v-model="dailyTime"
          type="time"
          data-testid="skill-schedule-daily-time"
          class="mt-1 w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:border-blue-400"
        />
        <span class="block mt-1 text-[11px] text-gray-400">{{ t("pluginManageSkills.scheduleTimeHint") }}</span>
      </label>

      <div v-else class="grid grid-cols-2 gap-3">
        <label class="block text-xs text-gray-600">
          {{ t("pluginManageSkills.scheduleEvery") }}
          <input
            v-model.number="intervalAmount"
            type="number"
            min="1"
            data-testid="skill-schedule-interval-amount"
            class="mt-1 w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:border-blue-400"
          />
        </label>
        <label class="block text-xs text-gray-600">
          {{ t("pluginManageSkills.scheduleUnit") }}
          <select
            v-model="intervalUnit"
            data-testid="skill-schedule-interval-unit"
            class="mt-1 w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:border-blue-400"
          >
            <option value="minutes">{{ t("pluginManageSkills.scheduleUnitMinutes") }}</option>
            <option value="hours">{{ t("pluginManageSkills.scheduleUnitHours") }}</option>
          </select>
        </label>
      </div>

      <div v-if="errorMessage" class="text-xs text-red-600" data-testid="skill-schedule-error">
        {{ errorMessage }}
      </div>

      <div class="flex justify-end gap-2 pt-1">
        <button
          class="h-8 px-2.5 flex items-center gap-1 text-sm rounded border border-gray-300 text-gray-600 hover:bg-gray-50"
          data-testid="skill-schedule-cancel"
          @click="emit('cancel')"
        >
          {{ t("common.cancel") }}
        </button>
        <button
          class="h-8 px-2.5 flex items-center gap-1 text-sm rounded bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-40"
          :disabled="submitting"
          data-testid="skill-schedule-submit"
          @click="submit"
        >
          <span class="material-icons text-sm">schedule</span>
          {{ submitting ? t("pluginManageSkills.scheduleSaving") : t("pluginManageSkills.scheduleSubmit") }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { buildScheduleSubmission, type ScheduleSubmission } from "./scheduleSubmission";

const { t } = useI18n();

const props = defineProps<{
  skillName: string;
  submitting?: boolean;
  errorMessage?: string;
}>();

const emit = defineEmits<{
  cancel: [];
  submit: [payload: ScheduleSubmission];
}>();

const scheduleType = ref<"daily" | "interval">("daily");
const dailyTime = ref("09:00");
const intervalAmount = ref(1);
const intervalUnit = ref<"minutes" | "hours">("hours");

function onKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape") emit("cancel");
}

onMounted(() => {
  document.addEventListener("keydown", onKeydown);
});

onUnmounted(() => {
  document.removeEventListener("keydown", onKeydown);
});

function submit(): void {
  if (props.submitting) return;
  const payload = buildScheduleSubmission(
    scheduleType.value,
    { localTime: dailyTime.value },
    { amount: Number(intervalAmount.value), unit: intervalUnit.value },
  );
  if (payload === null) return;
  emit("submit", payload);
}
</script>
