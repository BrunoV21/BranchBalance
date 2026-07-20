import { randomUUID } from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

import type { CapturedReceiptImage, PreparedReceiptImage } from './receipt-types';

const maxLongEdge = 1800;
const maxCacheEntries = 32;
const staleAfterMs = 24 * 60 * 60 * 1000;
const receiptCache = new Directory(Paths.cache, 'branchbalance-receipts');

function ensureReceiptCache(): void {
  receiptCache.create({ idempotent: true, intermediates: true });
}

export async function cleanReceiptCache(now = Date.now()): Promise<void> {
  ensureReceiptCache();
  const files = receiptCache.list().filter((entry): entry is File => entry instanceof File).sort((left, right) => (right.modificationTime ?? 0) - (left.modificationTime ?? 0));
  for (const [index, file] of files.entries()) {
    if (index >= maxCacheEntries || !file.modificationTime || now - file.modificationTime > staleAfterMs) file.delete();
  }
}

export async function prepareReceiptImage(image: PreparedReceiptImage): Promise<PreparedReceiptImage> {
  ensureReceiptCache();
  const context = ImageManipulator.manipulate(image.uri);
  const longEdge = Math.max(image.width, image.height);
  if (longEdge > maxLongEdge) {
    if (image.width >= image.height) context.resize({ width: maxLongEdge });
    else context.resize({ height: maxLongEdge });
  }
  const rendered = await context.renderAsync();
  const saved = await rendered.saveAsync({ compress: 0.9, format: SaveFormat.JPEG });
  const destination = new File(receiptCache, `${randomUUID()}.jpg`);
  await new File(saved.uri).move(destination);
  await cleanReceiptCache();
  return { uri: destination.uri, width: saved.width, height: saved.height };
}

export function deletePreparedReceipt(uri: string | null | undefined): void {
  if (!uri) return;
  const file = new File(uri);
  const root = receiptCache.uri.endsWith('/') ? receiptCache.uri : `${receiptCache.uri}/`;
  if (file.exists && file.uri.startsWith(root)) file.delete();
}

export function deleteCapturedReceipt(image: CapturedReceiptImage | null | undefined): void {
  if (!image || image.ownership !== 'app_cache') return;
  const file = new File(image.uri);
  if (file.exists) file.delete();
}
