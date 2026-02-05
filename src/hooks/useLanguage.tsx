import React, { createContext, useContext, useState, useEffect } from 'react';
import { LANGUAGES, LangCode } from '../utils/languages';

const LanguageContext = createContext<any>(null);

export const LanguageProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // Load saved language or default to 'en'
  const [lang, setLang] = useState<LangCode>(
    (localStorage.getItem('app_lang') as LangCode) || 'en'
  );

  const changeLanguage = (code: LangCode) => {
    setLang(code);
    localStorage.setItem('app_lang', code);
  };

  // Helper to get text: t('play_btn')
  const t = (key: keyof typeof LANGUAGES['en']['ui']) => {
    return LANGUAGES[lang].ui[key] || LANGUAGES['en'].ui[key];
  };

  return (
    <LanguageContext.Provider value={{ lang, changeLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  );
};

export const useLanguage = () => useContext(LanguageContext);