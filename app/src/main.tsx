import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { TooltipProvider } from '@/components/ui/tooltip';
import { applyTheme } from '@/lib/theme';

import { App } from './App.js';
import './style.css';

applyTheme();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <TooltipProvider>
      <App />
    </TooltipProvider>
  </StrictMode>,
);
