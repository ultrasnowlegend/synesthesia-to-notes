import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App.js';
import './styl.css';

createRoot(document.getElementById('koren')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
