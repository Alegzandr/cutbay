import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { useStore } from './store/store';
import './i18n';
import './index.css';

// TEMP DEBUG: expose store for e2e diagnostics.
(window as unknown as { __store: typeof useStore }).__store = useStore;

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
