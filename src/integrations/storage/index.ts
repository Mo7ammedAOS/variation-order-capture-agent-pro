import { getEnv } from '@/lib/env';
import type { StorageProvider } from '@/integrations/storage/provider';
import { googleDriveProvider } from '@/integrations/storage/google-drive';
import { localDiskProvider } from '@/integrations/storage/local-disk';

export * from '@/integrations/storage/provider';

export function getStorageProvider(): StorageProvider {
  return getEnv().STORAGE_PROVIDER === 'google_drive' ? googleDriveProvider : localDiskProvider;
}
