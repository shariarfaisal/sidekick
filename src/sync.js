import { wasLocalWrite } from './storage.js';

const SYNCED_KEYS = {
  sidekick_notes: 'onNotesChanged',
  sidekick_theme: 'onThemeChanged',
  sidebar_ai_model: 'onModelChanged',
};

export function initSync(handlers) {
  if (typeof chrome === 'undefined' || !chrome.storage?.onChanged) return;

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;

    for (const [key, { newValue }] of Object.entries(changes)) {
      if (wasLocalWrite(key)) continue;

      const handlerName = SYNCED_KEYS[key];
      if (handlerName && handlers[handlerName]) {
        handlers[handlerName](newValue);
      }
    }
  });
}
