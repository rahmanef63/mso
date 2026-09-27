"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import type { AboutPage } from "../lib/about-pages";

type AboutPageContextValue = {
  page: AboutPage;
  setPage: (page: AboutPage) => void;
};

const AboutPageContext = createContext<AboutPageContextValue | null>(null);

export function AboutPageState({ initial = "overview", children }: { initial?: AboutPage; children: ReactNode }) {
  const [page, setPage] = useState<AboutPage>(initial);
  const value = useMemo(() => ({ page, setPage }), [page]);
  return <AboutPageContext.Provider value={value}>{children}</AboutPageContext.Provider>;
}

export function useAboutPage(): AboutPageContextValue {
  return useContext(AboutPageContext) ?? { page: "overview", setPage: () => {} };
}
