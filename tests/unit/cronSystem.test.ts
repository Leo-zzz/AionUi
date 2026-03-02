/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import BetterSqlite3 from 'better-sqlite3';
import { initSchema, CURRENT_DB_VERSION } from '@/process/database/schema';
import { runMigrations } from '@/process/database/migrations';

// Create a shared in-memory database for CronStore tests
let rawDb: BetterSqlite3.Database;

vi.mock('@process/database', () => ({
  getDatabase: () => ({
    db: rawDb,
  }),
}));

vi.mock('@process/database/export', () => ({
  getDatabase: () => ({
    db: rawDb,
  }),
}));

import type { CronJob } from '@/process/services/cron/CronStore';

function createTestJob(overrides: Partial<CronJob> = {}): CronJob {
  const now = Date.now();
  return {
    id: `job_${now}_${Math.random().toString(36).slice(2, 6)}`,
    name: 'Test Job',
    enabled: true,
    schedule: { kind: 'cron', expr: '0 9 * * *', description: 'Every day at 9am' },
    target: { payload: { kind: 'message', text: 'Hello' } },
    metadata: {
      conversationId: 'conv1',
      conversationTitle: 'Test Chat',
      agentType: 'gemini',
      createdBy: 'user',
      createdAt: now,
      updatedAt: now,
    },
    state: {
      runCount: 0,
      retryCount: 0,
      maxRetries: 3,
    },
    ...overrides,
  } as CronJob;
}

describe('CronStore', () => {
  let cronStore: (typeof import('@/process/services/cron/CronStore'))['cronStore'];

  beforeEach(async () => {
    rawDb = new BetterSqlite3(':memory:');
    initSchema(rawDb);
    runMigrations(rawDb, 0, CURRENT_DB_VERSION);

    // Insert a user for foreign key constraints
    const now = Date.now();
    rawDb.prepare('INSERT INTO users (id, username, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run('system_default_user', 'system', '', now, now);

    vi.resetModules();
    const mod = await import('@/process/services/cron/CronStore');
    cronStore = mod.cronStore;
  });

  afterEach(() => {
    rawDb.close();
  });

  describe('insert / getById', () => {
    it('should round-trip a cron job with cron schedule', () => {
      const job = createTestJob({ id: 'j1' });
      cronStore.insert(job);

      const retrieved = cronStore.getById('j1');
      expect(retrieved).not.toBeNull();
      expect(retrieved!.id).toBe('j1');
      expect(retrieved!.name).toBe('Test Job');
      expect(retrieved!.enabled).toBe(true);
      expect(retrieved!.schedule).toEqual({
        kind: 'cron',
        expr: '0 9 * * *',
        description: 'Every day at 9am',
      });
      expect(retrieved!.target.payload.text).toBe('Hello');
      expect(retrieved!.metadata.conversationId).toBe('conv1');
      expect(retrieved!.state.runCount).toBe(0);
      expect(retrieved!.state.maxRetries).toBe(3);
    });

    it('should round-trip a job with at schedule', () => {
      const ts = Date.now() + 60000;
      const job = createTestJob({
        id: 'j2',
        schedule: { kind: 'at', atMs: ts, description: 'Run once' },
      });
      cronStore.insert(job);

      const retrieved = cronStore.getById('j2');
      expect(retrieved!.schedule).toEqual({ kind: 'at', atMs: ts, description: 'Run once' });
    });

    it('should round-trip a job with every schedule', () => {
      const job = createTestJob({
        id: 'j3',
        schedule: { kind: 'every', everyMs: 300000, description: 'Every 5 minutes' },
      });
      cronStore.insert(job);

      const retrieved = cronStore.getById('j3');
      expect(retrieved!.schedule).toEqual({
        kind: 'every',
        everyMs: 300000,
        description: 'Every 5 minutes',
      });
    });

    it('should return null for missing job', () => {
      expect(cronStore.getById('nonexistent')).toBeNull();
    });

    it('should preserve cron timezone', () => {
      const job = createTestJob({
        id: 'j4',
        schedule: {
          kind: 'cron',
          expr: '0 9 * * *',
          tz: 'America/New_York',
          description: 'Daily at 9am ET',
        },
      });
      cronStore.insert(job);

      const retrieved = cronStore.getById('j4');
      expect((retrieved!.schedule as any).tz).toBe('America/New_York');
    });
  });

  describe('update', () => {
    it('should merge updates and stamp updatedAt', () => {
      const job = createTestJob({ id: 'j1' });
      cronStore.insert(job);

      const before = cronStore.getById('j1')!;
      cronStore.update('j1', { name: 'Updated Job' });

      const after = cronStore.getById('j1')!;
      expect(after.name).toBe('Updated Job');
      expect(after.metadata.updatedAt).toBeGreaterThanOrEqual(before.metadata.updatedAt);
    });

    it('should throw for nonexistent job', () => {
      expect(() => cronStore.update('nonexistent', { name: 'X' })).toThrow('Cron job not found');
    });

    it('should update state fields', () => {
      const job = createTestJob({ id: 'j1' });
      cronStore.insert(job);

      cronStore.update('j1', {
        state: { runCount: 5, lastStatus: 'ok', retryCount: 0, maxRetries: 3 },
      } as any);

      const updated = cronStore.getById('j1')!;
      expect(updated.state.runCount).toBe(5);
      expect(updated.state.lastStatus).toBe('ok');
    });

    it('should update schedule', () => {
      const job = createTestJob({ id: 'j1' });
      cronStore.insert(job);

      cronStore.update('j1', {
        schedule: { kind: 'every', everyMs: 60000, description: 'Every minute' },
      } as any);

      const updated = cronStore.getById('j1')!;
      expect(updated.schedule).toEqual({
        kind: 'every',
        everyMs: 60000,
        description: 'Every minute',
      });
    });
  });

  describe('delete', () => {
    it('should remove a job', () => {
      const job = createTestJob({ id: 'j1' });
      cronStore.insert(job);
      cronStore.delete('j1');
      expect(cronStore.getById('j1')).toBeNull();
    });

    it('should not throw for nonexistent job', () => {
      expect(() => cronStore.delete('nonexistent')).not.toThrow();
    });
  });

  describe('listAll', () => {
    it('should return all jobs ordered by created_at DESC', () => {
      const now = Date.now();
      cronStore.insert(
        createTestJob({
          id: 'j1',
          metadata: {
            conversationId: 'c1',
            agentType: 'gemini',
            createdBy: 'user',
            createdAt: now,
            updatedAt: now,
          } as any,
        })
      );
      cronStore.insert(
        createTestJob({
          id: 'j2',
          metadata: {
            conversationId: 'c1',
            agentType: 'gemini',
            createdBy: 'user',
            createdAt: now + 1000,
            updatedAt: now + 1000,
          } as any,
        })
      );

      const all = cronStore.listAll();
      expect(all).toHaveLength(2);
      expect(all[0].id).toBe('j2');
      expect(all[1].id).toBe('j1');
    });

    it('should return empty array when no jobs exist', () => {
      expect(cronStore.listAll()).toHaveLength(0);
    });
  });

  describe('listEnabled', () => {
    it('should return only enabled jobs', () => {
      cronStore.insert(createTestJob({ id: 'j1', enabled: true }));
      cronStore.insert(createTestJob({ id: 'j2', enabled: false }));

      const enabled = cronStore.listEnabled();
      expect(enabled).toHaveLength(1);
      expect(enabled[0].id).toBe('j1');
    });
  });

  describe('listByConversation', () => {
    it('should filter by conversation ID', () => {
      cronStore.insert(
        createTestJob({
          id: 'j1',
          metadata: {
            conversationId: 'c1',
            agentType: 'gemini',
            createdBy: 'user',
            createdAt: Date.now(),
            updatedAt: Date.now(),
          } as any,
        })
      );
      cronStore.insert(
        createTestJob({
          id: 'j2',
          metadata: {
            conversationId: 'c2',
            agentType: 'gemini',
            createdBy: 'user',
            createdAt: Date.now(),
            updatedAt: Date.now(),
          } as any,
        })
      );

      const result = cronStore.listByConversation('c1');
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('j1');
    });

    it('should return empty for no matching conversation', () => {
      expect(cronStore.listByConversation('nonexistent')).toHaveLength(0);
    });
  });

  describe('deleteByConversation', () => {
    it('should delete all jobs for a conversation and return count', () => {
      cronStore.insert(
        createTestJob({
          id: 'j1',
          metadata: {
            conversationId: 'c1',
            agentType: 'gemini',
            createdBy: 'user',
            createdAt: Date.now(),
            updatedAt: Date.now(),
          } as any,
        })
      );
      cronStore.insert(
        createTestJob({
          id: 'j2',
          metadata: {
            conversationId: 'c1',
            agentType: 'gemini',
            createdBy: 'user',
            createdAt: Date.now(),
            updatedAt: Date.now(),
          } as any,
        })
      );
      cronStore.insert(
        createTestJob({
          id: 'j3',
          metadata: {
            conversationId: 'c2',
            agentType: 'gemini',
            createdBy: 'user',
            createdAt: Date.now(),
            updatedAt: Date.now(),
          } as any,
        })
      );

      const deleted = cronStore.deleteByConversation('c1');
      expect(deleted).toBe(2);
      expect(cronStore.listAll()).toHaveLength(1);
    });

    it('should return 0 when no jobs match', () => {
      expect(cronStore.deleteByConversation('nonexistent')).toBe(0);
    });
  });
});
