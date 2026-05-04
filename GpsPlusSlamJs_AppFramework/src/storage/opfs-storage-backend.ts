/**
 * OpfsStorageBackend
 *
 * Production implementation of StorageBackend that delegates to the
 * existing file-system.ts facade (which in turn uses OPFS).
 *
 * Provides flat session layout: gps-plus-slam/sessions/{timestamp}/…
 */

import type { SessionMetadata } from './opfs-storage';
import type { StorageBackend, CreateSessionResult } from './storage-backend';
import {
  startSession as fsStartSession,
  listSessions as fsListSessions,
  writeAction as fsWriteAction,
  writeFrame as fsWriteFrame,
  writeSessionMetadata as fsWriteSessionMetadata,
} from './file-system';

export class OpfsStorageBackend implements StorageBackend {
  async createSession(
    _timestamp: Date,
    _contextTag?: string
  ): Promise<CreateSessionResult> {
    const result = await fsStartSession();
    return { sessionName: result.sessionPath };
  }

  async listSessions(): Promise<string[]> {
    return fsListSessions();
  }

  async writeAction(action: unknown, index: number): Promise<void> {
    await fsWriteAction(action, index);
  }

  async writeFrame(blob: Blob, index: number): Promise<void> {
    await fsWriteFrame(blob, index);
  }

  async writeSessionMetadata(metadata: SessionMetadata): Promise<void> {
    await fsWriteSessionMetadata(metadata);
  }
}
