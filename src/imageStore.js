const DB_NAME = 'SidekickImages';
const DB_VERSION = 1;
const STORE_NAME = 'images';

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function generateImageId() {
  return 'img_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

// Store an image blob and return its unique ID
export async function saveImage(blob) {
  const db = await openDB();
  const id = generateImageId();
  const record = {
    id,
    blob,
    type: blob.type,
    size: blob.size,
    createdAt: Date.now(),
  };
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(record);
    tx.oncomplete = () => resolve(id);
    tx.onerror = () => reject(tx.error);
  });
}

// Retrieve an image blob by ID
export async function getImage(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const request = tx.objectStore(STORE_NAME).get(id);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

// Delete an image by ID
export async function deleteImage(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// Convert a File/Blob to a stored image, return { id, blobUrl }
export async function storeImageFile(file) {
  const blob = file instanceof Blob ? file : new Blob([file], { type: file.type });
  const id = await saveImage(blob);
  const blobUrl = URL.createObjectURL(blob);
  return { id, blobUrl };
}

// Blob URL <-> sbn: reference tracking
const blobUrlToId = new Map();
const idToBlobUrl = new Map();

export function trackBlobUrl(id, blobUrl) {
  blobUrlToId.set(blobUrl, id);
  idToBlobUrl.set(id, blobUrl);
}

export function getBlobUrlForId(id) {
  return idToBlobUrl.get(id) || null;
}

export function getIdForBlobUrl(blobUrl) {
  return blobUrlToId.get(blobUrl) || null;
}

// Replace sbn:{id} references in markdown with blob URLs
export async function resolveImageRefs(markdown) {
  const regex = /!\[([^\]]*)\]\(sbn:([a-z0-9_]+)\)/g;
  const matches = [...markdown.matchAll(regex)];
  let result = markdown;

  for (const match of matches) {
    const [full, alt, id] = match;
    let blobUrl = getBlobUrlForId(id);
    if (!blobUrl) {
      const record = await getImage(id);
      if (record) {
        blobUrl = URL.createObjectURL(record.blob);
        trackBlobUrl(id, blobUrl);
      }
    }
    if (blobUrl) {
      result = result.replace(full, `![${alt}](${blobUrl})`);
    }
  }
  return result;
}

// Replace blob URLs in markdown with sbn:{id} references for storage
export function derefImageUrls(markdown) {
  let result = markdown;
  for (const [blobUrl, id] of blobUrlToId.entries()) {
    result = result.replaceAll(blobUrl, `sbn:${id}`);
  }
  // Also catch any base64 images and store them
  return result;
}

// Process base64 images in markdown: extract, store in IndexedDB, replace with sbn: refs
export async function extractAndStoreBase64Images(markdown) {
  const regex = /!\[([^\]]*)\]\((data:image\/[^;]+;base64,[A-Za-z0-9+/=]+)\)/g;
  const matches = [...markdown.matchAll(regex)];
  let result = markdown;

  for (const match of matches) {
    const [full, alt, dataUrl] = match;
    try {
      const response = await fetch(dataUrl);
      const blob = await response.blob();
      const id = await saveImage(blob);
      const blobUrl = URL.createObjectURL(blob);
      trackBlobUrl(id, blobUrl);
      result = result.replace(full, `![${alt}](sbn:${id})`);
    } catch (e) {
      console.warn('Failed to extract base64 image:', e);
    }
  }
  return result;
}

// Cleanup: revoke all tracked blob URLs
export function revokeAllBlobUrls() {
  for (const blobUrl of blobUrlToId.keys()) {
    URL.revokeObjectURL(blobUrl);
  }
  blobUrlToId.clear();
  idToBlobUrl.clear();
}
