/**
 * Tests du resolver Vue SFC (GitWand)
 *
 * Fixtures :
 *   F1 — modification dans <template> d'un seul côté
 *   F2 — modification dans <script setup> d'un seul côté
 *   F3 — fichier .vue minimal
 *   F4 — ajout d'un <style scoped> d'un côté
 *   F5 — conflit dans <template> des deux côtés → conflit ou fallback
 */

import { describe, it, expect } from "vitest";
import { resolve } from "../../resolver.js";

// ─── F1 — modification dans <template> d'un seul côté ────────────────────────

describe("F1 — Vue : modification dans <template> d'un seul côté (diff3)", () => {
  const input = [
    `<<<<<<< ours`,
    `<template>`,
    `  <div class="app">`,
    `    <h1>Hello World</h1>`,
    `    <p>Welcome to my app</p>`,
    `  </div>`,
    `</template>`,
    ``,
    `<script setup>`,
    `const title = 'Hello World';`,
    `</script>`,
    `||||||| base`,
    `<template>`,
    `  <div class="app">`,
    `    <h1>Hello World</h1>`,
    `  </div>`,
    `</template>`,
    ``,
    `<script setup>`,
    `const title = 'Hello World';`,
    `</script>`,
    `=======`,
    `<template>`,
    `  <div class="app">`,
    `    <h1>Hello World</h1>`,
    `  </div>`,
    `</template>`,
    ``,
    `<script setup>`,
    `const title = 'Hello World';`,
    `</script>`,
    `>>>>>>> theirs`,
  ].join("\n");

  it("auto-résout via le resolver vue", () => {
    const result = resolve(input, "App.vue");
    expect(result.stats.autoResolved).toBe(1);
  });

  it("le résultat contient la modification du template", () => {
    const result = resolve(input, "App.vue");
    expect(result.mergedContent).toContain("Welcome to my app");
  });

  it("la raison mentionne [vue]", () => {
    const result = resolve(input, "App.vue");
    expect(result.resolutions[0].resolutionReason).toMatch(/\[vue\]/i);
  });
});

// ─── F2 — modification dans <script setup> d'un seul côté ────────────────────

describe("F2 — Vue : modification dans <script setup> d'un seul côté (diff3)", () => {
  const input = [
    `<<<<<<< ours`,
    `<template>`,
    `  <button @click="handleClick">Click me</button>`,
    `</template>`,
    ``,
    `<script setup lang="ts">`,
    `import { ref } from 'vue';`,
    `import { useRouter } from 'vue-router';`,
    ``,
    `const count = ref(0);`,
    `const router = useRouter();`,
    ``,
    `function handleClick() {`,
    `  count.value++;`,
    `}`,
    `</script>`,
    `||||||| base`,
    `<template>`,
    `  <button @click="handleClick">Click me</button>`,
    `</template>`,
    ``,
    `<script setup lang="ts">`,
    `import { ref } from 'vue';`,
    ``,
    `const count = ref(0);`,
    ``,
    `function handleClick() {`,
    `  count.value++;`,
    `}`,
    `</script>`,
    `=======`,
    `<template>`,
    `  <button @click="handleClick">Click me</button>`,
    `</template>`,
    ``,
    `<script setup lang="ts">`,
    `import { ref } from 'vue';`,
    ``,
    `const count = ref(0);`,
    ``,
    `function handleClick() {`,
    `  count.value++;`,
    `}`,
    `</script>`,
    `>>>>>>> theirs`,
  ].join("\n");

  it("auto-résout via le resolver vue", () => {
    const result = resolve(input, "Button.vue");
    expect(result.stats.autoResolved).toBe(1);
  });

  it("le résultat contient le code ajouté dans script setup", () => {
    const result = resolve(input, "Button.vue");
    expect(result.mergedContent).toContain("useRouter");
  });

  it("la raison mentionne [vue]", () => {
    const result = resolve(input, "Button.vue");
    expect(result.resolutions[0].resolutionReason).toMatch(/\[vue\]/i);
  });
});

// ─── F3 — fichier .vue minimal ────────────────────────────────────────────────

describe("F3 — Vue minimal : ne plante pas", () => {
  const input = [
    `<<<<<<< ours`,
    `<template><div>Ours</div></template>`,
    `=======`,
    `<template><div>Theirs</div></template>`,
    `>>>>>>> theirs`,
  ].join("\n");

  it("ne lève pas d'exception", () => {
    expect(() => resolve(input, "Minimal.vue")).not.toThrow();
  });

  it("produit un résultat avec au moins un hunk", () => {
    const result = resolve(input, "Minimal.vue");
    expect(result.hunks.length).toBeGreaterThanOrEqual(1);
  });
});

// ─── F4 — ajout d'un <style scoped> d'un côté ────────────────────────────────

describe("F4 — Vue : ajout d'un <style scoped> d'un côté (diff3)", () => {
  const input = [
    `<<<<<<< ours`,
    `<template>`,
    `  <div class="card">Card content</div>`,
    `</template>`,
    ``,
    `<script setup lang="ts">`,
    `// component logic`,
    `</script>`,
    ``,
    `<style scoped>`,
    `.card {`,
    `  padding: 16px;`,
    `  border-radius: 8px;`,
    `  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);`,
    `}`,
    `</style>`,
    `||||||| base`,
    `<template>`,
    `  <div class="card">Card content</div>`,
    `</template>`,
    ``,
    `<script setup lang="ts">`,
    `// component logic`,
    `</script>`,
    `=======`,
    `<template>`,
    `  <div class="card">Card content</div>`,
    `</template>`,
    ``,
    `<script setup lang="ts">`,
    `// component logic`,
    `</script>`,
    `>>>>>>> theirs`,
  ].join("\n");

  it("auto-résout via le resolver vue", () => {
    const result = resolve(input, "Card.vue");
    expect(result.stats.autoResolved).toBe(1);
  });

  it("le résultat contient le bloc style ajouté", () => {
    const result = resolve(input, "Card.vue");
    expect(result.mergedContent).toContain("<style scoped>");
    expect(result.mergedContent).toContain(".card");
  });

  it("la raison mentionne [vue]", () => {
    const result = resolve(input, "Card.vue");
    expect(result.resolutions[0].resolutionReason).toMatch(/\[vue\]/i);
  });
});

// ─── F5 — conflit dans <template> des deux côtés ─────────────────────────────

describe("F5 — Vue : conflit dans <template> des deux côtés (diff3)", () => {
  const input = [
    `<<<<<<< ours`,
    `<template>`,
    `  <div class="app">`,
    `    <h1>My Awesome App</h1>`,
    `    <p>Version 2.0</p>`,
    `  </div>`,
    `</template>`,
    `||||||| base`,
    `<template>`,
    `  <div class="app">`,
    `    <h1>My App</h1>`,
    `  </div>`,
    `</template>`,
    `=======`,
    `<template>`,
    `  <div class="app">`,
    `    <h1>My Great App</h1>`,
    `    <span>Beta</span>`,
    `  </div>`,
    `</template>`,
    `>>>>>>> theirs`,
  ].join("\n");

  it("ne lève pas d'exception", () => {
    expect(() => resolve(input, "App.vue")).not.toThrow();
  });

  it("la raison mentionne [vue]", () => {
    const result = resolve(input, "App.vue");
    expect(result.resolutions[0].resolutionReason).toMatch(/\[vue\]/i);
  });
});
