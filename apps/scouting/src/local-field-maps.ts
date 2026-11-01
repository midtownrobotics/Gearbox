// SPDX-License-Identifier: AGPL-3.0-only
export type LocalFieldMap = {
  id: string;
  name: string;
  eventName: string;
  notes: string;
  image: Blob;
  updatedAt: number;
};

const DATABASE = "g3-strategy";
const STORE = "field-maps";
const PRESET_STORE = "field-map-presets";
const DEFAULT_PRESET = "default";

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 2);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE, { keyPath: "id" });
      }
      if (!request.result.objectStoreNames.contains(PRESET_STORE)) {
        request.result.createObjectStore(PRESET_STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function getFieldMapPreset(): Promise<Blob | null> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = database
      .transaction(PRESET_STORE, "readonly")
      .objectStore(PRESET_STORE)
      .get(DEFAULT_PRESET);
    request.onsuccess = () => {
      database.close();
      resolve((request.result as { image?: Blob } | undefined)?.image ?? null);
    };
    request.onerror = () => {
      database.close();
      reject(request.error);
    };
  });
}

export async function saveFieldMapPreset(image: Blob): Promise<void> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(PRESET_STORE, "readwrite");
    transaction.objectStore(PRESET_STORE).put({ id: DEFAULT_PRESET, image });
    transaction.oncomplete = () => {
      database.close();
      resolve();
    };
    transaction.onerror = () => {
      database.close();
      reject(transaction.error);
    };
  });
}

export async function listLocalFieldMaps(): Promise<LocalFieldMap[]> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = database.transaction(STORE, "readonly").objectStore(STORE).getAll();
    request.onsuccess = () => {
      database.close();
      resolve((request.result as LocalFieldMap[]).sort((a, b) => b.updatedAt - a.updatedAt));
    };
    request.onerror = () => {
      database.close();
      reject(request.error);
    };
  });
}

export async function saveLocalFieldMap(map: LocalFieldMap): Promise<void> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE, "readwrite");
    transaction.objectStore(STORE).put(map);
    transaction.oncomplete = () => {
      database.close();
      resolve();
    };
    transaction.onerror = () => {
      database.close();
      reject(transaction.error);
    };
  });
}

export async function deleteLocalFieldMap(id: string): Promise<void> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE, "readwrite");
    transaction.objectStore(STORE).delete(id);
    transaction.oncomplete = () => {
      database.close();
      resolve();
    };
    transaction.onerror = () => {
      database.close();
      reject(transaction.error);
    };
  });
}
