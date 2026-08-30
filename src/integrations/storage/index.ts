import { getEnv } from '@/lib/env';
import type { StorageProvider } from '@/integrations/storage/provider';
import { googleDriveProvider } from '@/integrations/storage/google-drive';
import { localDiskProvider } from '@/integrations/storage/local-disk';
import { supabaseStorageProvider } from '@/integrations/storage/supabase-storage';

export * from '@/integrations/storage/provider';

export function getStorageProvider(): StorageProvider {
  switch (getEnv().STORAGE_PROVIDER) {
    case 'supabase':
      return supabaseStorageProvider;
    case 'google_drive':
      return googleDriveProvider;
    default:
      return localDiskProvider;
  }
}
