import { proxyManagedApp } from "@/lib/managed-apps/proxy-handler";

export const dynamic = "force-dynamic";

export const GET = proxyManagedApp;
export const HEAD = proxyManagedApp;
export const POST = proxyManagedApp;
export const PUT = proxyManagedApp;
export const PATCH = proxyManagedApp;
export const DELETE = proxyManagedApp;
