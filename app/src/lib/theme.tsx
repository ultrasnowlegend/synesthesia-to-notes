import { Monitor, Moon, Sun } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Hint } from '@/components/ui/tooltip';

export type Theme = 'dark' | 'light' | 'system';

function stored(): Theme {
  try {
    const t = localStorage.getItem('theme');
    if (t === 'dark' || t === 'light' || t === 'system') return t;
  } catch {
    // The default then.
  }
  return 'dark';
}

/** Puts the theme on the document; dark unless chosen otherwise. */
export function applyTheme(theme: Theme = stored()): void {
  const dark =
    theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
}

const NEXT: Record<Theme, Theme> = { dark: 'light', light: 'system', system: 'dark' };
const LABEL: Record<Theme, string> = { dark: 'Tmavý vzhled', light: 'Světlý vzhled', system: 'Vzhled podle systému' };

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(stored);
  useEffect(() => {
    applyTheme(theme);
    try {
      localStorage.setItem('theme', theme);
    } catch {
      // Not remembered.
    }
    if (theme !== 'system') return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const follow = (): void => applyTheme('system');
    media.addEventListener('change', follow);
    return () => media.removeEventListener('change', follow);
  }, [theme]);
  const Icon = theme === 'dark' ? Moon : theme === 'light' ? Sun : Monitor;
  return (
    <Hint label={`${LABEL[theme]} — přepnout`}>
      <Button variant="ghost" size="icon" aria-label={LABEL[theme]} onClick={() => setTheme(NEXT[theme])}>
        <Icon />
      </Button>
    </Hint>
  );
}
