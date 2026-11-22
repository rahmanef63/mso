"use client";

import { createContext, useContext } from "react";

export const SettingsWindowContext = createContext<{ winId?: string; setSensitiveDirty: (dirty: boolean) => void }>({ setSensitiveDirty: () => {} });
export const useSettingsWindow = () => useContext(SettingsWindowContext);
