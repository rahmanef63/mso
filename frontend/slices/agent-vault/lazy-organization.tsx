"use client";
import dynamic from "next/dynamic";
export const OrganizationView = dynamic(()=>import("./organization/components/organization-view").then(module=>module.OrganizationView), {loading:()=> <p role="status" className="p-4">Loading organization…</p>});
