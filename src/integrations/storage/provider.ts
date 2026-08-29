/**
 * The file storage boundary.
 *
 * Google Drive is the Phase 1 implementation. Supabase Storage or a plain disk
 * volume are alternates — swapping means writing one adapter, because nothing
 * above this interface knows what is underneath.
 *
 * The database, not the store, is the index. We never list a folder to discover
 * what exists: Drive permits duplicate names in one folder, and a listing is
 * not an access-control boundary. Every file has a `project_documents` row.
 */

export interface StoredFile {
  /** Provider-native id. For Drive, the file id. */
  fileId: string;
  /** Path or locator, for providers that have one. */
  storagePath: string;
  name: string;
  mimeType: string;
  sizeBytes: number | null;
  /** Provider-native view link. NEVER given to a browser — see the proxy route. */
  sourceUrl: string | null;
}

export interface UploadInput {
  folderId: string;
  name: string;
  mimeType: string;
  content: Buffer | Uint8Array;
}

/** The numbered folder tree every project gets. Order is the sort order. */
export const PROJECT_FOLDER_TREE = [
  '01 Contract',
  '02 Drawings',
  '03 Specifications',
  '04 BOQ',
  '05 Programme',
  '06 Correspondence',
  '07 Potential Changes',
  '08 Notices',
  '09 Variation Orders',
] as const;

export const PC_FOLDER_TREE = ['Evidence', 'Drafts'] as const;
export const PC_PARENT_FOLDER = '07 Potential Changes';

export interface StorageProvider {
  readonly name: string;

  /**
   * Returns the folder's id, creating it only if absent.
   *
   * MUST be idempotent. Two concurrent captures on a new project would
   * otherwise create two `Evidence` folders, because Drive happily allows
   * duplicate names. Callers serialise on the database row that stores the id.
   */
  ensureFolder(name: string, parentId: string): Promise<string>;

  upload(input: UploadInput): Promise<StoredFile>;

  /** Bytes for the authenticated proxy route. */
  download(fileId: string): Promise<{ content: Buffer; mimeType: string; name: string }>;

  delete(fileId: string): Promise<void>;
}
