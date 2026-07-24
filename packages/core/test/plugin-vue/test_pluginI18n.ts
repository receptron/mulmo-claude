import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ref, nextTick } from "vue";
import { createPluginI18n } from "../../src/plugin-vue/pluginI18n.ts";

// vue-i18n runs headless under node (no DOM, no app mount), so the factory can be
// exercised directly. Each test builds its own instance — the factory closes over
// per-instance state (i18n + sync flag), so nothing leaks between tests.

interface TestMessages {
  greeting: string;
}

const messages: Record<string, TestMessages> = {
  en: { greeting: "hello" },
  ja: { greeting: "こんにちは" },
};

describe("createPluginI18n", () => {
  it("applies the source's locale on the composable's first call", () => {
    const useTestI18n = createPluginI18n<TestMessages>(messages, () => "ja");
    const { t, locale } = useTestI18n();
    assert.equal(locale.value, "ja");
    assert.equal(t("greeting"), "こんにちは");
  });

  it("does not read the locale source before the composable's first call (lazy wiring)", () => {
    const calls = { count: 0 };
    const useTestI18n = createPluginI18n<TestMessages>(messages, () => {
      calls.count += 1;
      return "en";
    });
    assert.equal(calls.count, 0);
    useTestI18n();
    assert.equal(calls.count, 1);
  });

  it("wires the locale mirror exactly once across repeated calls", () => {
    const calls = { count: 0 };
    const useTestI18n = createPluginI18n<TestMessages>(messages, () => {
      calls.count += 1;
      return "en";
    });
    useTestI18n();
    useTestI18n();
    useTestI18n();
    assert.equal(calls.count, 1);
  });

  it("propagates reactive locale-source changes after the first call", async () => {
    const tag = ref("en");
    const useTestI18n = createPluginI18n<TestMessages>(messages, () => tag.value);
    const { t, locale } = useTestI18n();
    assert.equal(locale.value, "en");
    assert.equal(t("greeting"), "hello");
    tag.value = "ja";
    await nextTick();
    assert.equal(locale.value, "ja");
    assert.equal(t("greeting"), "こんにちは");
  });

  it("a throwing locale source propagates and leaves the sync retryable", () => {
    const binding = { configured: false };
    const useTestI18n = createPluginI18n<TestMessages>(messages, () => {
      if (!binding.configured) {
        throw new Error("binding not configured yet");
      }
      return "ja";
    });
    assert.throws(() => useTestI18n(), /binding not configured yet/);
    binding.configured = true;
    const { locale } = useTestI18n();
    assert.equal(locale.value, "ja");
  });
});
