// Typed view of window.storageLimits (web/storage-limits.js) and window.cloudAssets
// (web/cloud-assets.js) for the storage island.
import { useEffect, useState } from "react";

export type Level = "ok" | "warn" | "over";
export interface StorageProblem {
  level: "warn" | "over";
  scope: "document" | "page" | "asset";
  pageId?: string | null;
  bytes?: number;
  limit?: number;
  message: string;
}
export interface StorageReport {
  total: number;
  pages: { id: string; name: string; bytes: number }[];
  inline: { count: number; bytes: number };
  problems: StorageProblem[];
  measuredAt: number;
}
interface StorageLimitsApi {
  PAGE_LIMIT_BYTES: number;
  DOCUMENT_LIMIT_BYTES: number;
  ASSET_LIMIT_BYTES: number;
  WARN_RATIO: number;
  level(bytes: number, limit: number): Level;
  current(): StorageReport | null;
  refresh(): StorageReport | null;
  subscribe(fn: (report: StorageReport) => void): () => void;
}
export interface AssetStatus {
  uploading: number;
  uploaded: number;
  failed: number;
  lastError: string;
  creating: { done: number; total: number; error: string | null } | null;
}
declare global {
  interface Window {
    storageLimits?: StorageLimitsApi;
    cloudAssets?: { status(): AssetStatus };
  }
}

export const limits = () => window.storageLimits;

/** The measured open document (refreshed by web/storage-limits.js after edits settle). */
export function useStorageReport(): StorageReport | null {
  const [report, setReport] = useState<StorageReport | null>(() => limits()?.current() ?? null);
  useEffect(() => limits()?.subscribe(setReport), []);
  return report;
}

/** Upload progress of room assets (event `cloud-assets-changed`). */
export function useAssetStatus(): AssetStatus | null {
  const read = () => window.cloudAssets?.status() ?? null;
  const [status, setStatus] = useState<AssetStatus | null>(read);
  useEffect(() => {
    const update = () => setStatus(read());
    window.addEventListener("cloud-assets-changed", update);
    return () => window.removeEventListener("cloud-assets-changed", update);
  }, []);
  return status;
}

export function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  const value = bytes / 1024 / 1024;
  return `${Number.isInteger(value) ? value : value.toFixed(value >= 10 ? 0 : 1)} MB`;
}
