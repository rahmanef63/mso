"use client";

import type { AppProps } from "@/features/appshell";
import { AppFrame } from "@/features/appshell";
import { OrganizationView } from "./components/organization-view";

export default function OrganizationApp(_props: AppProps) {
  return (
    <AppFrame safeArea={false} className="h-full bg-background" bodyClassName="overflow-hidden">
      <OrganizationView />
    </AppFrame>
  );
}
