/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import BetterSqlite3 from 'better-sqlite3';
import { initSchema, getDatabaseVersion, setDatabaseVersion, CURRENT_DB_VERSION } from '@/process/database/schema';
import { ALL_MIGRATIONS, getMigrationsToRun, getMigrationsToRollback, runMigrations, rollbackMigrations, getMigrationHistory, isMigrationApplied } from '@/process/database/migrations';

describe('Database Migrations', () => {
  let db: BetterSqlite3.Database;

  beforeEach(() => {
    db = new BetterSqlite3(':memory:');
    initSchema(db);
  });

  afterEach(() => {
    db.close();
  });

  describe('ALL_MIGRATIONS', () => {
    it('should have 14 entries', () => {
      expect(ALL_MIGRATIONS).toHaveLength(14);
    });

    it('should have versions 1 through 14 with no gaps', () => {
      const versions = ALL_MIGRATIONS.map((m) => m.version);
      for (let i = 1; i <= 14; i++) {
        expect(versions).toContain(i);
      }
    });

    it('should have unique versions', () => {
      const versions = ALL_MIGRATIONS.map((m) => m.version);
      expect(new Set(versions).size).toBe(versions.length);
    });

    it('should have name and up/down functions for each migration', () => {
      for (const m of ALL_MIGRATIONS) {
        expect(m.name).toBeTruthy();
        expect(typeof m.up).toBe('function');
        expect(typeof m.down).toBe('function');
      }
    });
  });

  describe('getMigrationsToRun', () => {
    it('should return all 14 migrations for 0 to 14', () => {
      const migrations = getMigrationsToRun(0, 14);
      expect(migrations).toHaveLength(14);
      expect(migrations[0].version).toBe(1);
      expect(migrations[13].version).toBe(14);
    });

    it('should return 7 migrations for 7 to 14', () => {
      const migrations = getMigrationsToRun(7, 14);
      expect(migrations).toHaveLength(7);
      expect(migrations[0].version).toBe(8);
      expect(migrations[6].version).toBe(14);
    });

    it('should return empty array when from equals to', () => {
      const migrations = getMigrationsToRun(14, 14);
      expect(migrations).toHaveLength(0);
    });

    it('should return sorted by version ascending', () => {
      const migrations = getMigrationsToRun(0, 14);
      for (let i = 1; i < migrations.length; i++) {
        expect(migrations[i].version).toBeGreaterThan(migrations[i - 1].version);
      }
    });

    it('should return subset for partial range', () => {
      const migrations = getMigrationsToRun(3, 7);
      expect(migrations).toHaveLength(4);
      expect(migrations[0].version).toBe(4);
      expect(migrations[3].version).toBe(7);
    });
  });

  describe('getMigrationsToRollback', () => {
    it('should return migrations in reverse order', () => {
      const migrations = getMigrationsToRollback(14, 0);
      expect(migrations).toHaveLength(14);
      expect(migrations[0].version).toBe(14);
      expect(migrations[13].version).toBe(1);
    });

    it('should return empty when from equals to', () => {
      const migrations = getMigrationsToRollback(5, 5);
      expect(migrations).toHaveLength(0);
    });
  });

  describe('runMigrations', () => {
    it('should be a no-op when from equals to', () => {
      expect(() => runMigrations(db, 5, 5)).not.toThrow();
    });

    it('should throw on downgrade (from > to)', () => {
      expect(() => runMigrations(db, 10, 5)).toThrow('Downgrade not supported');
    });

    it('should successfully run full migration v0 to v14', () => {
      expect(() => runMigrations(db, 0, CURRENT_DB_VERSION)).not.toThrow();

      // Verify key tables exist after full migration
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
        .all()
        .map((r: any) => r.name);

      expect(tables).toContain('users');
      expect(tables).toContain('conversations');
      expect(tables).toContain('messages');
      expect(tables).toContain('assistant_plugins');
      expect(tables).toContain('assistant_users');
      expect(tables).toContain('assistant_sessions');
      expect(tables).toContain('assistant_pairing_codes');
      expect(tables).toContain('cron_jobs');
    });

    it('should preserve data during table-swap migrations', () => {
      // Run to v7 (creates assistant_plugins with telegram/slack/discord)
      runMigrations(db, 0, 7);

      // Insert a telegram plugin
      const now = Date.now();
      db.prepare('INSERT INTO assistant_plugins (id, type, name, enabled, config, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run('p1', 'telegram', 'My Bot', 1, '{}', 'stopped', now, now);

      // Run v10 which recreates assistant_plugins to add 'lark'
      runMigrations(db, 7, 10);

      // Verify data preserved
      const row = db.prepare('SELECT * FROM assistant_plugins WHERE id = ?').get('p1') as any;
      expect(row).toBeDefined();
      expect(row.type).toBe('telegram');
      expect(row.name).toBe('My Bot');
    });

    it('should be idempotent for v6 (jwt_secret already exists)', () => {
      runMigrations(db, 0, 6);
      // Running v6 again should not throw (it checks column existence)
      const migration_v6 = ALL_MIGRATIONS.find((m) => m.version === 6)!;
      expect(() => migration_v6.up(db)).not.toThrow();
    });

    it('should be idempotent for v14 (chat_id already exists)', () => {
      runMigrations(db, 0, 14);
      // Running v14 again should not throw (it checks column existence)
      // Need to disable FK for the table recreation parts
      db.pragma('foreign_keys = OFF');
      const migration_v14 = ALL_MIGRATIONS.find((m) => m.version === 14)!;
      expect(() => migration_v14.up(db)).not.toThrow();
      db.pragma('foreign_keys = ON');
    });

    it('should re-enable foreign keys after migration', () => {
      runMigrations(db, 0, CURRENT_DB_VERSION);
      const fk = db.pragma('foreign_keys', { simple: true });
      expect(fk).toBe(1);
    });
  });

  describe('rollbackMigrations', () => {
    it('should throw when from <= to (ascending)', () => {
      expect(() => rollbackMigrations(db, 5, 10)).toThrow('Cannot rollback to a higher or equal version');
    });

    it('should throw when from equals to', () => {
      expect(() => rollbackMigrations(db, 5, 5)).toThrow('Cannot rollback to a higher or equal version');
    });

    it('should successfully rollback', () => {
      runMigrations(db, 0, CURRENT_DB_VERSION);
      // Rollback from v14 to v6 should work
      expect(() => rollbackMigrations(db, CURRENT_DB_VERSION, 6)).not.toThrow();
    });
  });

  describe('getMigrationHistory', () => {
    it('should return array with current version', () => {
      setDatabaseVersion(db, 10);
      const history = getMigrationHistory(db);
      expect(history).toHaveLength(1);
      expect(history[0].version).toBe(10);
      expect(history[0].name).toBe('Current schema version');
      expect(history[0].timestamp).toBeGreaterThan(0);
    });
  });

  describe('isMigrationApplied', () => {
    it('should return true when version is at or above target', () => {
      setDatabaseVersion(db, 10);
      expect(isMigrationApplied(db, 10)).toBe(true);
      expect(isMigrationApplied(db, 5)).toBe(true);
    });

    it('should return false when version is below target', () => {
      setDatabaseVersion(db, 5);
      expect(isMigrationApplied(db, 10)).toBe(false);
    });
  });
});
