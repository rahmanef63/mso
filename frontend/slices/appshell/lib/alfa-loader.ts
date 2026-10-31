"use client";

// Loader registration for lazy-loaded Alfa sources (skills, agent catalog).
let loader: (() => void | Promise<void>) | null = null;
let loaderStarted = false;

export function registerAlfaLoader(fn: () => void | Promise<void>): void {
  loader = fn;
}

export function triggerAlfaLoader(): void {
  if (loader && !loaderStarted) {
    loaderStarted = true;
    void Promise.resolve(loader()).catch(() => {
      loaderStarted = false;
    });
  }
}
