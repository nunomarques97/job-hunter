import React from 'react';
import ReactDOM from 'react-dom/client';

import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';

import { AppStateProvider } from './app/AppState';
import { StartupView } from './views/StartupView';

// StartupView renders the shell in both states rather than standing in front of
// it: the same rail, command bar and footer, told the condition when there is
// one. The window's furniture is static text and never needed the backend.
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AppStateProvider>
      <StartupView />
    </AppStateProvider>
  </React.StrictMode>,
);
