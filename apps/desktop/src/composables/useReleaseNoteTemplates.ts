/**
 * useReleaseNoteTemplates — named release note templates (v3).
 *
 * Templates are stored in AppSettings.releaseNoteTemplates.
 * The active template is remembered per repo (cwd) in AppSettings.activeReleaseNoteTemplateIdByRepo.
 * Null / absent / "__builtin_default" = Default (no custom rules).
 */

import { computed } from "vue";
import { loadSettings, saveSettings, type ReleaseNoteTemplate } from "./useSettings";

function uuid(): string {
  return crypto.randomUUID();
}

export function allTemplates(): ReleaseNoteTemplate[] {
  return loadSettings().releaseNoteTemplates || [];
}

export function findTemplate(id: string): ReleaseNoteTemplate | undefined {
  if (id === "__builtin_default") {
    return {
      id: "__builtin_default",
      name: "Default",
      customRules: "",
    };
  }
  return allTemplates().find((t) => t.id === id);
}

export function getActiveTemplateId(cwd: string): string | null {
  return loadSettings().activeReleaseNoteTemplateIdByRepo[cwd] ?? null;
}

export function getActiveTemplate(cwd: string): ReleaseNoteTemplate | null {
  const id = getActiveTemplateId(cwd);
  if (!id || id === "__builtin_default") return null;
  return findTemplate(id) ?? null;
}

export function addTemplate(template: Omit<ReleaseNoteTemplate, "id">): string {
  const id = uuid();
  const s = loadSettings();
  s.releaseNoteTemplates = [...(s.releaseNoteTemplates || []), { ...template, id }];
  saveSettings(s);
  return id;
}

export function updateTemplate(id: string, patch: Partial<Omit<ReleaseNoteTemplate, "id">>): void {
  if (id === "__builtin_default") return;
  const s = loadSettings();
  s.releaseNoteTemplates = (s.releaseNoteTemplates || []).map((t) => (t.id === id ? { ...t, ...patch } : t));
  saveSettings(s);
}

export function removeTemplate(id: string): void {
  if (id === "__builtin_default") return;
  const s = loadSettings();
  s.releaseNoteTemplates = (s.releaseNoteTemplates || []).filter((t) => t.id !== id);
  // Clear any repo pointing to the deleted template
  for (const cwd of Object.keys(s.activeReleaseNoteTemplateIdByRepo)) {
    if (s.activeReleaseNoteTemplateIdByRepo[cwd] === id) {
      delete s.activeReleaseNoteTemplateIdByRepo[cwd];
    }
  }
  saveSettings(s);
}

export function setActiveTemplate(cwd: string, templateId: string | null): void {
  const s = loadSettings();
  if (templateId === null || templateId === "__builtin_default") {
    delete s.activeReleaseNoteTemplateIdByRepo[cwd];
  } else {
    s.activeReleaseNoteTemplateIdByRepo = { ...s.activeReleaseNoteTemplateIdByRepo, [cwd]: templateId };
  }
  saveSettings(s);
}

export function useReleaseNoteTemplates(getCwd?: () => string) {
  const templates = computed(() => allTemplates());

  const activeTemplateId = computed<string | null>(() =>
    getCwd ? getActiveTemplateId(getCwd()) : null
  );

  const activeTemplate = computed<ReleaseNoteTemplate | null>(() =>
    getCwd ? getActiveTemplate(getCwd()) : null
  );

  function activate(templateId: string | null) {
    if (!getCwd) return;
    setActiveTemplate(getCwd(), templateId);
  }

  return {
    templates,
    activeTemplateId,
    activeTemplate,
    activate,
    add: addTemplate,
    update: updateTemplate,
    remove: removeTemplate,
  };
}
