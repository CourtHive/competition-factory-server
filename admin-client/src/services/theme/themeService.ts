const STORAGE_KEY = 'admin_theme';

type ThemePref = 'light' | 'dark' | 'system';

function getThemePreference(): ThemePref {
  return (localStorage.getItem(STORAGE_KEY) as ThemePref) || 'dark';
}

function resolveTheme(pref: ThemePref): 'light' | 'dark' {
  if (pref === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return pref;
}

function applyTheme(pref: ThemePref): void {
  const resolved = resolveTheme(pref);
  document.documentElement.setAttribute('data-theme', resolved);
  localStorage.setItem(STORAGE_KEY, pref);
  updateThemeIcon(pref);
}

function updateThemeIcon(pref: ThemePref): void {
  const el = document.getElementById('themeToggle');
  if (!el) return;

  el.classList.remove('fa-moon', 'fa-sun', 'fa-circle-half-stroke');
  switch (pref) {
    case 'dark':
      el.classList.add('fa-moon');
      el.title = 'Theme: Dark';
      break;
    case 'light':
      el.classList.add('fa-sun');
      el.title = 'Theme: Light';
      break;
    case 'system':
      el.classList.add('fa-circle-half-stroke');
      el.title = 'Theme: System';
      break;
  }
}

export function cycleTheme(): void {
  const current = getThemePreference();
  const next: ThemePref = current === 'dark' ? 'light' : current === 'light' ? 'system' : 'dark';
  applyTheme(next);
}

export function initTheme(): void {
  const pref = getThemePreference();
  applyTheme(pref);
}

export function initThemeToggle(id: string): void {
  const el = document.getElementById(id);
  if (el) el.addEventListener('click', cycleTheme);
}
