import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import './styles.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';
import { I18nProvider } from './i18n';

const root = document.getElementById('root');
if (root !== null)
  createRoot(root).render(
    <StrictMode>
      <I18nProvider>
        <App />
      </I18nProvider>
    </StrictMode>,
  );
