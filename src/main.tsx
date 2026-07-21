import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { registerCoopWorker } from './app/coop';
import './i18n';
import './index.css';

// Fire-and-forget: buys the multi-threaded ffmpeg core from the next visit on,
// and costs nothing when it fails.
registerCoopWorker();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
