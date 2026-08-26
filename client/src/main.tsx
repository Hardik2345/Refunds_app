import { AppProvider } from '@shopify/polaris';
import enTranslations from '@shopify/polaris/locales/en.json';
import '@shopify/polaris/build/esm/styles.css';
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Toaster } from 'sonner'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppProvider i18n={enTranslations}>
      <App />
      {/* Styled with Polaris tokens so toasts read as part of the admin, not a bolt-on. */}
      <Toaster
        position="bottom-center"
        closeButton
        duration={4500}
        toastOptions={{
          style: {
            background: 'var(--p-color-bg-inverse)',
            color: 'var(--p-color-text-inverse)',
            border: 'none',
            borderRadius: 'var(--p-border-radius-300)',
            boxShadow: 'var(--p-shadow-400)',
            fontFamily: 'var(--p-font-family-sans)',
            fontSize: 'var(--p-font-size-325)',
          },
        }}
      />
    </AppProvider>
  </StrictMode>,
)


