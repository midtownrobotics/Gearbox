import type { InferResponseType } from "hono/client";
import type { api } from "./api";

export type OrderRequest = InferResponseType<typeof api.requests.$get, 200>[number];
export type RequestDetail = InferResponseType<(typeof api.requests)[":id"]["$get"], 200>;
export type Category = InferResponseType<typeof api.categories.$get, 200>[number];
export type RequestStatus = OrderRequest["status"];
export type Priority = OrderRequest["priority"];
export type Vendor = InferResponseType<typeof api.vendors.$get, 200>[number];
/** A vendor as mentors see it (with payment, account, notes and credits). */
export type VendorProfile = Extract<Vendor, { credits: unknown }>;
export type CatalogItem = InferResponseType<typeof api.catalog.items.$get, 200>[number];
export type CatalogData = InferResponseType<typeof api.catalog.$get, 200>;
export type CatalogFamily = CatalogData["families"][number];
export type PartList = InferResponseType<typeof api.lists.$get, 200>[number];
export type PartListDetail = InferResponseType<(typeof api.lists)[":id"]["$get"], 200>;
export type ListProgress = PartList["progress"];
