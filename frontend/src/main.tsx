import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { applyTheme, usePrefsStore } from './store/prefs';
import './index.css';

applyTheme(usePrefsStore.getState().theme);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
