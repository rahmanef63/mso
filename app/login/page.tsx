import { redirect } from "next/navigation";
import { ServerLoginPage } from "@/features/auth";
import { getSessionContext } from "@/lib/auth/require-session";
import { safeReturnPath } from "@/lib/auth/return-path";
import { IS_DEMO } from "@/lib/demo";

export default async function LoginPage({ searchParams }: {
  searchParams: Promise<{ returnTo?: string | string[] }>;
}) {
  if (IS_DEMO) redirect("/");
  const returnTo = safeReturnPath((await searchParams).returnTo);
  if (await getSessionContext()) redirect(returnTo);
  return <ServerLoginPage returnTo={returnTo} />;
}
