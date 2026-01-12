import { useState, useEffect, createContext, useContext } from 'react';
import { translations } from '../i18n/translations';

const LanguageContext = createContext();

export function LanguageProvider({ children, defaultLanguage = 'fr' }) {
  const [language, setLanguage] = useState(() => {
    // Check localStorage first
    const saved = localStorage.getItem('ovh-dashboard-language');
    if (saved && (saved === 'fr' || saved === 'en')) {
      return saved;
    }
    return defaultLanguage;
  });

  useEffect(() => {
    localStorage.setItem('ovh-dashboard-language', language);
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

export default useLanguage;
