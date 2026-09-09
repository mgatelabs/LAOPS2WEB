import { Injectable, signal, inject } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';

export interface LocaleInfo {
  code: string;
  label: string;
}

interface LocalesFile {
  locales: LocaleInfo[];
  default: string;
}

const THEME_KEY = 'laops.theme';
const LANG_KEY = 'laops.lang';

const THEMES = ['auto', 'light', 'dark'] as const;
export type Theme = typeof THEMES[number];

@Injectable({ providedIn: 'root' })
export class SettingsService {
  private readonly translate = inject(TranslateService);

  theme = signal<Theme>('auto');
  language = signal<string>('en');
  locales = signal<LocaleInfo[]>([{ code: 'en', label: 'English' }]);
  resolvedTheme = signal<'light' | 'dark'>('dark');

  readonly media = typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: dark)') : null;

  constructor() {
    let theme: string = 'auto';
    try {
      theme = localStorage.getItem(THEME_KEY) ?? 'auto';
    } catch {
      // ignore
    }
    if (!THEMES.includes(theme as Theme)) theme = 'auto';
    this.theme.set(theme as Theme);

    let lang = 'en';
    try {
      lang = localStorage.getItem(LANG_KEY) ?? 'en';
    } catch {
      // ignore
    }
    if (lang !== 'en' && lang !== 'de' && lang !== 'fr') lang = 'en';
    this.language.set(lang);
    if (lang !== 'en') {
      this.translate.use(lang);
      document.documentElement.lang = lang;
    }
    this.applyTheme(true);

    this.media?.addEventListener('change', () => {
      if (this.theme() === 'auto') this.applyTheme();
    });
  }

  setTheme(theme: Theme): void {
    this.theme.set(theme);
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      // ignore
    }
    this.applyTheme();
  }

  setLanguage(lang: string): void {
    this.language.set(lang);
    try {
      localStorage.setItem(LANG_KEY, lang);
    } catch {
      // ignore
    }
    this.translate.use(lang);
    document.documentElement.lang = lang;
  }

  loadLocales(file: LocalesFile): void {
    if (file?.locales?.length) {
      this.locales.set(file.locales);
    }
  }

  applyTheme(silent = false): void {
    const t = this.theme();
    const mode = t === 'auto' ? (this.media?.matches ? 'dark' : 'light') : t;
    this.resolvedTheme.set(mode);
    const body = document.body;
    body.classList.remove('laops-light-theme', 'laops-dark-theme');
    body.classList.add(mode === 'dark' ? 'laops-dark-theme' : 'laops-light-theme');
    if (!silent) {
      // no extra work needed
    }
  }
}
