import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import Boundary from './components/Boundary';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Boundary>
      <App />
    </Boundary>
  </StrictMode>,
);

// Offline support. Registration failures are non-fatal — the app just works
// online only.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {});
  });
}
