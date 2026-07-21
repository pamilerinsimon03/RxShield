import '@/styles/globals.css';
import type { AppProps } from 'next/app';
import { useEffect } from 'react';
import { DatabaseProvider } from '@/context/DatabaseContext';

const App = ({ Component, pageProps }: AppProps): JSX.Element => {
  useEffect(() => {
    if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker
          .register('/sw.js')
          .then((registration) => {
            console.log('[App] Service Worker registered successfully:', registration.scope);
          })
          .catch((error) => {
            console.error('[App] Service Worker registration failed:', error);
          });
      });
    }
  }, []);

  return (
    <DatabaseProvider>
      <Component {...pageProps} />
    </DatabaseProvider>
  );
};

export default App;
