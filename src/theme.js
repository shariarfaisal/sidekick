import { storage } from './storage.js';

const THEME_KEY = 'sidekick_theme';

export async function initTheme() {
  const saved = await storage.get(THEME_KEY);
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const theme = saved || (prefersDark ? 'dark' : 'light');
  applyTheme(theme);
  return theme;
}

export function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  updateThemeIcon(theme);
}

export async function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme');
  const next = current === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  await storage.set(THEME_KEY, next);
  return next;
}

function updateThemeIcon(theme) {
  const icon = document.getElementById('icon-theme');
  if (!icon) return;
  if (theme === 'dark') {
    icon.innerHTML = `<path d="M9 2a7 7 0 107 7 5 5 0 01-7-7z" fill="currentColor"/>`;
  } else {
    icon.innerHTML = `
      <circle cx="9" cy="9" r="4"/>
      <line x1="9" y1="1" x2="9" y2="3"/><line x1="9" y1="15" x2="9" y2="17"/>
      <line x1="1" y1="9" x2="3" y2="9"/><line x1="15" y1="9" x2="17" y2="9"/>
      <line x1="3.3" y1="3.3" x2="4.7" y2="4.7"/><line x1="13.3" y1="13.3" x2="14.7" y2="14.7"/>
      <line x1="3.3" y1="14.7" x2="4.7" y2="13.3"/><line x1="13.3" y1="4.7" x2="14.7" y2="3.3"/>
    `;
  }
}
