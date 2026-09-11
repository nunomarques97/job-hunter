import React from 'react';
import ReactDOM from 'react-dom/client';

import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';

import { AppStateProvider } from './app/AppState';
import { Shell } from './app/Shell';
import { StartupView } from './views/StartupView';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AppStateProvider>
      <StartupView>
        <Shell />
      </StartupView>
    </AppStateProvider>
  </React.StrictMode>,
);
