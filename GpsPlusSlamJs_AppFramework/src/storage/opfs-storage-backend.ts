/**
 * OpfsStorageBackend
 *
 * Production implementation of StorageBackend that delegates directly to the
 * OPFS storage module. Provides the framework's default flat session layout:
 * `gps-plus-slam/sessions/{timestamp}/…`.
 *
 * Apps that need a different on-disk layout (e.g. a grouping layer that nests
 * sessions under a named bucket) ship their own StorageBackend rather than
 * extending this one.
 */

import type { SessionMetadata } from './opfs-storage';
import type { StorageBackend, CreateSessionResult } from './storage-backend';
import {
  createSession as opfsCreateSession,
  listSessions as opfsListSessions,
  writeAction as opfsWriteAction,
  writeFrame as opfsWriteFrame,
  writeSessionMetadata as opfsWriteSessionMetadata,
} from './opfs-storage';

export class OpfsStorageBackend implements StorageBackend {
  async createSession(
    timestamp: Date,
    _contextTag?: string
  ): Promise<CreateSessionResult> {
    const result = await opfsCreateSession(timestamp);
    return { sessionName: result.sessionName };
  }

  async listSessions(): Promise<string[]> {
    return opfsListSessions();
  }

  async writeAction(action: unknown, index: number): Promise<void> {
    await opfsWriteAction(action, index);
  }

  async writeFrame(blob: Blob, index: number): Promise<void> {
    await opfsWriteFrame(blob, index);
  }

  async writeSessionMetadata(metadata: SessionMetadata): Promise<void> {
    await opfsWriteSessionMetadata(metadata);
  }
}
