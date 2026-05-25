"use client";

import {
  createContext, useContext, useState, useEffect, ReactNode,
} from "react";
import { translations, Lang } from "./i18n";

interface LangCtx {
  lang:    Lang;
  setLang: (l: Lang) => void;
  tr:      typeof translations["en"];
}

const LangContext = createContext<LangCtx>({
  lang:    "en",
  setLang: () => {},
  tr:      translations.en,
});

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>("en");

  useEffect(() => {
    const saved = localStorage.getItem("vc_lang") as Lang | null;
    if (saved === "en" || saved === "hi") setLangState(saved);
  }, []);

  function setLang(l: Lang) {
    setLangState(l);
    localStorage.setItem("vc_lang", l);
  }

  return (
    <LangContext.Provider value={{ lang, setLang, tr: translations[lang] }}>
      {children}
    </LangContext.Provider>
  );
}

export function useLang() {
  return useContext(LangContext);
}
