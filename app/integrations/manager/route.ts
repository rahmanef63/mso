import { integrationManagerResponse } from "@/lib/infra/setup-page";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = () => integrationManagerResponse();
