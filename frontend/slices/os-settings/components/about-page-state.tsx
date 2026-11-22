"use client";

import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import { useFeatureState } from "@/features/appshell";
import type { AboutPage } from "../lib/about-pages";

type AboutPageContextValue = {
  page: AboutPage;
  setPage: (page: AboutPage) => void;
};

const AboutPageContext = createContext<AboutPageContextValue | null>(null);

export function AboutPageState({ initial = "overview", winId, children }: { initial?: AboutPage; winId?: string; children: ReactNode }) {
  const [page, setPage] = useFeatureState<AboutPage>(winId, "settings-about-page", initial);
  useEffect(() => { if (winId) setPage(current => current); }, [setPage, winId]);
  const value = useMemo(() => ({ page, setPage }), [page, setPage]);
  return <AboutPageContext.Provider value={value}>{children}</AboutPageContext.Provider>;
}

export function useAboutPage(): AboutPageContextValue {
  return useContext(AboutPageContext) ?? { page: "overview", setPage: () => {} };
}
