import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { LanguageProvider } from './hooks/useLanguage.jsx'
import App from './App'
import './index.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000, // 5 minutes
      refetchOnWindowFocus: false
    }
  }
})

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <LanguageProvider defaultLanguage="fr">
        <App />
      </LanguageProvider>
    </QueryClientProvider>
  </React.StrictMode>,
)
