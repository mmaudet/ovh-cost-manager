import { useState, useEffect, createContext, useContext } from 'react';
import { translations } from '../i18n/translations';
import { readStored, store } from '../utils/storage.js';

const LanguageContext = createContext();

export function LanguageProvider({ children, defaultLanguage = 'fr' }) {
  const [language, setLanguage] = useState(() => {
    // The language of an earlier visit first, which the browser may not have kept
    const saved = readStored('ovh-dashboard-language');
    if (saved && (saved === 'fr' || saved === 'en')) {
      return saved;
    }
    return defaultLanguage;
  });

  useEffect(() => {
    store('ovh-dashboard-language', language);
  }, [language]);

  const t = (key) => {
    return translations[language]?.[key] || translations['fr']?.[key] || key;
  };

  const value = {
    language,
    setLanguage,
    t
  };

  return (
    <LanguageContext.Provider value={value}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return context;
}
