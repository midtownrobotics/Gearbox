// SPDX-License-Identifier: AGPL-3.0-only
import {
  MAX_SHOP_FILE_BYTES,
  SHOP_STORAGE_LIMIT,
  StorageLimitError,
  withStorageLimit,
} from "@g3/auth";
import type { AppEnv } from "../types";
import { teamPrefix } from "./storage";

export async function putShopFile(
  env: AppEnv["Bindings"],
  teamId: string,
  key: string,
  body: File | ArrayBuffer | Uint8Array,
  contentType: string,
) {
  const bytes = body instanceof File ? body.size : body.byteLength;
  if (bytes > MAX_SHOP_FILE_BYTES) {
    throw new StorageLimitError("Files must be 100 MB or smaller.", "file_too_large", 413);
  }
  return withStorageLimit(
    env.SHOP_DB,
    env.DRAWINGS,
    teamId,
    teamPrefix(teamId),
    [{ key, bytes }],
    SHOP_STORAGE_LIMIT,
    () =>
      env.DRAWINGS.put(key, body instanceof File ? body.stream() : body, {
        httpMetadata: { contentType },
      }),
  );
}
