/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import BetterSqlite3 from 'better-sqlite3';
import { initSchema, getDatabaseVersion, setDatabaseVersion, CURRENT_DB_VERSION } from '@/process/database/schema';
import { runMigrations } from '@/process/database/migrations';
import { conversationToRow, rowToConversation, messageToRow, rowToMessage } from '@/process/database/types';
import type { IConversationRow, IMessageRow } from '@/process/database/types';

// We test the database layer by using a real in-memory SQLite database
// and calling schema/migration functions directly, then testing CRUD via raw SQL + type converters.

function createTestDb() {
  const db = new BetterSqlite3(':memory:');
  initSchema(db);
  // Run all migrations to get to latest version
  runMigrations(db, 0, CURRENT_DB_VERSION);
  setDatabaseVersion(db, CURRENT_DB_VERSION);
  return db;
}

function insertUser(db: BetterSqlite3.Database, id: string, username: string, passwordHash = 'hash123') {
  const now = Date.now();
  db.prepare('INSERT INTO users (id, username, email, password_hash, avatar_path, created_at, updated_at, last_login) VALUES (?, ?, NULL, ?, NULL, ?, ?, NULL)').run(id, username, passwordHash, now, now);
}

describe('Database Schema & CRUD', () => {
  let db: BetterSqlite3.Database;

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => {
    db.close();
  });

  describe('initSchema', () => {
    it('should be idempotent (call twice without error)', () => {
      // initSchema was already called in createTestDb, call again
      expect(() => initSchema(db)).not.toThrow();
    });

    it('should create users table', () => {
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='users'").all();
      expect(tables).toHaveLength(1);
    });

    it('should create conversations table', () => {
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='conversations'").all();
      expect(tables).toHaveLength(1);
    });

    it('should create messages table', () => {
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='messages'").all();
      expect(tables).toHaveLength(1);
    });

    it('should enable foreign keys', () => {
      const fk = db.pragma('foreign_keys', { simple: true });
      expect(fk).toBe(1);
    });
  });

  describe('getDatabaseVersion / setDatabaseVersion', () => {
    it('should round-trip version', () => {
      setDatabaseVersion(db, 42);
      expect(getDatabaseVersion(db)).toBe(42);
    });

    it('should return current version after migrations', () => {
      expect(getDatabaseVersion(db)).toBe(CURRENT_DB_VERSION);
    });
  });

  describe('User CRUD', () => {
    it('should insert and retrieve a user', () => {
      insertUser(db, 'u1', 'alice');
      const row = db.prepare('SELECT * FROM users WHERE id = ?').get('u1') as any;
      expect(row).toBeDefined();
      expect(row.username).toBe('alice');
    });

    it('should enforce unique username', () => {
      insertUser(db, 'u1', 'alice');
      expect(() => insertUser(db, 'u2', 'alice')).toThrow();
    });

    it('should return null for missing user', () => {
      const row = db.prepare('SELECT * FROM users WHERE id = ?').get('nonexistent');
      expect(row).toBeUndefined();
    });

    it('should count users with non-empty password (hasUsers logic)', () => {
      // Insert system user with empty password
      const now = Date.now();
      db.prepare('INSERT INTO users (id, username, email, password_hash, created_at, updated_at) VALUES (?, ?, NULL, ?, ?, ?)').run('system', 'system', '', now, now);

      const countResult = db.prepare("SELECT COUNT(*) as count FROM users WHERE password_hash IS NOT NULL AND TRIM(password_hash) != ''").get() as { count: number };
      expect(countResult.count).toBe(0);

      // Insert real user with password
      insertUser(db, 'u1', 'alice', 'bcrypt_hash');
      const countResult2 = db.prepare("SELECT COUNT(*) as count FROM users WHERE password_hash IS NOT NULL AND TRIM(password_hash) != ''").get() as { count: number };
      expect(countResult2.count).toBe(1);
    });

    it('should update user password', () => {
      insertUser(db, 'u1', 'alice', 'old_hash');
      const now = Date.now();
      db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').run('new_hash', now, 'u1');
      const row = db.prepare('SELECT * FROM users WHERE id = ?').get('u1') as any;
      expect(row.password_hash).toBe('new_hash');
    });

    it('should update jwt_secret', () => {
      insertUser(db, 'u1', 'alice');
      db.prepare('UPDATE users SET jwt_secret = ? WHERE id = ?').run('secret123', 'u1');
      const row = db.prepare('SELECT * FROM users WHERE id = ?').get('u1') as any;
      expect(row.jwt_secret).toBe('secret123');
    });
  });

  describe('Conversation CRUD', () => {
    const userId = 'u1';

    beforeEach(() => {
      insertUser(db, userId, 'alice');
    });

    it('should insert and retrieve a gemini conversation', () => {
      const now = Date.now();
      db.prepare('INSERT INTO conversations (id, user_id, name, type, extra, model, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run('c1', userId, 'Test Chat', 'gemini', '{"workspace":"/tmp"}', '{"provider":"gemini","model":"pro"}', 'pending', now, now);

      const row = db.prepare('SELECT * FROM conversations WHERE id = ?').get('c1') as IConversationRow;
      expect(row).toBeDefined();
      expect(row.type).toBe('gemini');
      expect(row.name).toBe('Test Chat');
    });

    it('should insert an acp conversation', () => {
      const now = Date.now();
      db.prepare('INSERT INTO conversations (id, user_id, name, type, extra, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run('c2', userId, 'ACP Chat', 'acp', '{"backend":"claude"}', 'pending', now, now);

      const row = db.prepare('SELECT * FROM conversations WHERE id = ?').get('c2') as IConversationRow;
      expect(row.type).toBe('acp');
    });

    it('should reject invalid conversation type', () => {
      const now = Date.now();
      expect(() => {
        db.prepare('INSERT INTO conversations (id, user_id, name, type, extra, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run('c3', userId, 'Bad', 'invalid_type', '{}', 'pending', now, now);
      }).toThrow();
    });

    it('should enforce foreign key on user_id', () => {
      const now = Date.now();
      expect(() => {
        db.prepare('INSERT INTO conversations (id, user_id, name, type, extra, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run('c4', 'nonexistent_user', 'Bad', 'gemini', '{}', 'pending', now, now);
      }).toThrow();
    });

    it('should cascade delete conversations when user is deleted', () => {
      const now = Date.now();
      db.prepare('INSERT INTO conversations (id, user_id, name, type, extra, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run('c1', userId, 'Chat', 'gemini', '{}', 'pending', now, now);

      db.prepare('DELETE FROM users WHERE id = ?').run(userId);
      const row = db.prepare('SELECT * FROM conversations WHERE id = ?').get('c1');
      expect(row).toBeUndefined();
    });

    it('should paginate conversations ordered by updated_at DESC', () => {
      const now = Date.now();
      for (let i = 0; i < 5; i++) {
        db.prepare('INSERT INTO conversations (id, user_id, name, type, extra, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(`c${i}`, userId, `Chat ${i}`, 'gemini', '{}', 'pending', now, now + i);
      }

      const rows = db.prepare('SELECT * FROM conversations WHERE user_id = ? ORDER BY updated_at DESC LIMIT ? OFFSET ?').all(userId, 2, 0) as IConversationRow[];
      expect(rows).toHaveLength(2);
      expect(rows[0].id).toBe('c4'); // most recent
      expect(rows[1].id).toBe('c3');
    });

    it('should find channel conversation by source and chat ID', () => {
      const now = Date.now();
      db.prepare('INSERT INTO conversations (id, user_id, name, type, extra, status, source, channel_chat_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run('c1', userId, 'TG Chat', 'acp', '{"backend":"claude"}', 'pending', 'telegram', 'user:123', now, now);

      const row = db.prepare('SELECT * FROM conversations WHERE user_id = ? AND source = ? AND channel_chat_id = ? AND type = ? ORDER BY updated_at DESC LIMIT 1').get(userId, 'telegram', 'user:123', 'acp') as IConversationRow;
      expect(row).toBeDefined();
      expect(row.id).toBe('c1');
    });

    it('should find channel conversation filtered by backend', () => {
      const now = Date.now();
      db.prepare('INSERT INTO conversations (id, user_id, name, type, extra, status, source, channel_chat_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run('c1', userId, 'Claude', 'acp', '{"backend":"claude"}', 'pending', 'telegram', 'user:1', now, now);
      db.prepare('INSERT INTO conversations (id, user_id, name, type, extra, status, source, channel_chat_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run('c2', userId, 'Iflow', 'acp', '{"backend":"iflow"}', 'pending', 'telegram', 'user:1', now, now + 1);

      const row = db.prepare("SELECT * FROM conversations WHERE user_id = ? AND source = ? AND channel_chat_id = ? AND type = ? AND json_extract(extra, '$.backend') = ? ORDER BY updated_at DESC LIMIT 1").get(userId, 'telegram', 'user:1', 'acp', 'claude') as IConversationRow;
      expect(row).toBeDefined();
      expect(row.id).toBe('c1');
    });

    it('should delete conversation and return changes count', () => {
      const now = Date.now();
      db.prepare('INSERT INTO conversations (id, user_id, name, type, extra, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run('c1', userId, 'Chat', 'gemini', '{}', 'pending', now, now);

      const result = db.prepare('DELETE FROM conversations WHERE id = ?').run('c1');
      expect(result.changes).toBe(1);
    });

    it('should return 0 changes when deleting nonexistent conversation', () => {
      const result = db.prepare('DELETE FROM conversations WHERE id = ?').run('nonexistent');
      expect(result.changes).toBe(0);
    });
  });

  describe('Message CRUD', () => {
    const userId = 'u1';
    const convId = 'c1';

    beforeEach(() => {
      insertUser(db, userId, 'alice');
      const now = Date.now();
      db.prepare('INSERT INTO conversations (id, user_id, name, type, extra, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(convId, userId, 'Chat', 'gemini', '{}', 'pending', now, now);
    });

    it('should insert and retrieve a message', () => {
      const now = Date.now();
      db.prepare('INSERT INTO messages (id, conversation_id, msg_id, type, content, position, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run('m1', convId, 'msg_1', 'text', '{"content":"hello"}', 'left', 'finish', now);

      const row = db.prepare('SELECT * FROM messages WHERE id = ?').get('m1') as IMessageRow;
      expect(row).toBeDefined();
      expect(row.type).toBe('text');
      expect(JSON.parse(row.content)).toEqual({ content: 'hello' });
    });

    it('should enforce foreign key on conversation_id', () => {
      const now = Date.now();
      expect(() => {
        db.prepare('INSERT INTO messages (id, conversation_id, msg_id, type, content, position, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run('m1', 'bad_conv', 'msg_1', 'text', '{"content":"hello"}', 'left', 'finish', now);
      }).toThrow();
    });

    it('should cascade delete messages when conversation is deleted', () => {
      const now = Date.now();
      db.prepare('INSERT INTO messages (id, conversation_id, msg_id, type, content, position, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run('m1', convId, 'msg_1', 'text', '{"content":"hello"}', 'left', 'finish', now);

      db.prepare('DELETE FROM conversations WHERE id = ?').run(convId);
      const row = db.prepare('SELECT * FROM messages WHERE id = ?').get('m1');
      expect(row).toBeUndefined();
    });

    it('should find message by msg_id, conversation_id, and type', () => {
      const now = Date.now();
      db.prepare('INSERT INTO messages (id, conversation_id, msg_id, type, content, position, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run('m1', convId, 'shared_msg', 'text', '{"content":"hello"}', 'left', 'finish', now);
      db.prepare('INSERT INTO messages (id, conversation_id, msg_id, type, content, position, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run('m2', convId, 'shared_msg', 'tips', '{"content":"tip"}', 'center', 'finish', now + 1);

      const row = db.prepare('SELECT * FROM messages WHERE conversation_id = ? AND msg_id = ? AND type = ? ORDER BY created_at DESC LIMIT 1').get(convId, 'shared_msg', 'text') as IMessageRow;
      expect(row).toBeDefined();
      expect(row.id).toBe('m1');
    });

    it('should update message content', () => {
      const now = Date.now();
      db.prepare('INSERT INTO messages (id, conversation_id, msg_id, type, content, position, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run('m1', convId, 'msg_1', 'text', '{"content":"hello"}', 'left', 'pending', now);

      db.prepare('UPDATE messages SET content = ?, status = ? WHERE id = ?').run('{"content":"hello world"}', 'finish', 'm1');
      const row = db.prepare('SELECT * FROM messages WHERE id = ?').get('m1') as IMessageRow;
      expect(JSON.parse(row.content)).toEqual({ content: 'hello world' });
      expect(row.status).toBe('finish');
    });

    it('should paginate messages ordered by created_at', () => {
      const now = Date.now();
      for (let i = 0; i < 5; i++) {
        db.prepare('INSERT INTO messages (id, conversation_id, msg_id, type, content, position, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(`m${i}`, convId, `msg_${i}`, 'text', `{"content":"msg ${i}"}`, 'left', 'finish', now + i);
      }

      const rows = db.prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC LIMIT ? OFFSET ?').all(convId, 2, 0) as IMessageRow[];
      expect(rows).toHaveLength(2);
      expect(rows[0].id).toBe('m0');
      expect(rows[1].id).toBe('m1');
    });
  });

  describe('Channel Plugin CRUD', () => {
    it('should upsert and retrieve a plugin', () => {
      const now = Date.now();
      db.prepare('INSERT INTO assistant_plugins (id, type, name, enabled, config, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run('p1', 'telegram', 'My Bot', 1, '{"credentials":{"token":"secret"},"config":{}}', 'stopped', now, now);

      const row = db.prepare('SELECT * FROM assistant_plugins WHERE id = ?').get('p1') as any;
      expect(row).toBeDefined();
      expect(row.type).toBe('telegram');
      expect(row.enabled).toBe(1);
    });

    it('should return null for missing plugin', () => {
      const row = db.prepare('SELECT * FROM assistant_plugins WHERE id = ?').get('nonexistent');
      expect(row).toBeUndefined();
    });

    it('should update plugin status', () => {
      const now = Date.now();
      db.prepare('INSERT INTO assistant_plugins (id, type, name, enabled, config, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run('p1', 'telegram', 'Bot', 1, '{}', 'stopped', now, now);

      db.prepare('UPDATE assistant_plugins SET status = ? WHERE id = ?').run('running', 'p1');
      const row = db.prepare('SELECT * FROM assistant_plugins WHERE id = ?').get('p1') as any;
      expect(row.status).toBe('running');
    });

    it('should delete plugin', () => {
      const now = Date.now();
      db.prepare('INSERT INTO assistant_plugins (id, type, name, enabled, config, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run('p1', 'telegram', 'Bot', 1, '{}', 'stopped', now, now);

      const result = db.prepare('DELETE FROM assistant_plugins WHERE id = ?').run('p1');
      expect(result.changes).toBe(1);
    });
  });

  describe('Channel User & Session CRUD', () => {
    it('should create and retrieve channel user by platform', () => {
      const now = Date.now();
      db.prepare('INSERT INTO assistant_users (id, platform_user_id, platform_type, display_name, authorized_at, last_active) VALUES (?, ?, ?, ?, ?, ?)').run('au1', 'tg_user_123', 'telegram', 'Alice', now, now);

      const row = db.prepare('SELECT * FROM assistant_users WHERE platform_user_id = ? AND platform_type = ?').get('tg_user_123', 'telegram') as any;
      expect(row).toBeDefined();
      expect(row.display_name).toBe('Alice');
    });

    it('should enforce unique platform_user_id + platform_type', () => {
      const now = Date.now();
      db.prepare('INSERT INTO assistant_users (id, platform_user_id, platform_type, display_name, authorized_at) VALUES (?, ?, ?, ?, ?)').run('au1', 'tg_123', 'telegram', 'Alice', now);

      expect(() => {
        db.prepare('INSERT INTO assistant_users (id, platform_user_id, platform_type, display_name, authorized_at) VALUES (?, ?, ?, ?, ?)').run('au2', 'tg_123', 'telegram', 'Bob', now);
      }).toThrow();
    });

    it('should create and retrieve channel session', () => {
      const now = Date.now();
      // Need a user first
      db.prepare('INSERT INTO assistant_users (id, platform_user_id, platform_type, authorized_at) VALUES (?, ?, ?, ?)').run('au1', 'tg_123', 'telegram', now);

      db.prepare('INSERT INTO assistant_sessions (id, user_id, agent_type, conversation_id, workspace, chat_id, created_at, last_activity) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run('s1', 'au1', 'acp', null, '/workspace', 'chat:1', now, now);

      const row = db.prepare('SELECT * FROM assistant_sessions WHERE user_id = ?').get('au1') as any;
      expect(row).toBeDefined();
      expect(row.agent_type).toBe('acp');
      expect(row.chat_id).toBe('chat:1');
    });
  });

  describe('Pairing Code CRUD', () => {
    it('should create and retrieve pairing request', () => {
      const now = Date.now();
      db.prepare('INSERT INTO assistant_pairing_codes (code, platform_user_id, platform_type, display_name, requested_at, expires_at, status) VALUES (?, ?, ?, ?, ?, ?, ?)').run('123456', 'tg_user', 'telegram', 'Alice', now, now + 600000, 'pending');

      const row = db.prepare('SELECT * FROM assistant_pairing_codes WHERE code = ?').get('123456') as any;
      expect(row).toBeDefined();
      expect(row.status).toBe('pending');
    });

    it('should filter pending non-expired requests', () => {
      const now = Date.now();
      // Pending and not expired
      db.prepare('INSERT INTO assistant_pairing_codes (code, platform_user_id, platform_type, requested_at, expires_at, status) VALUES (?, ?, ?, ?, ?, ?)').run('111111', 'u1', 'telegram', now, now + 600000, 'pending');
      // Expired
      db.prepare('INSERT INTO assistant_pairing_codes (code, platform_user_id, platform_type, requested_at, expires_at, status) VALUES (?, ?, ?, ?, ?, ?)').run('222222', 'u2', 'telegram', now, now - 1, 'pending');
      // Approved (not pending)
      db.prepare('INSERT INTO assistant_pairing_codes (code, platform_user_id, platform_type, requested_at, expires_at, status) VALUES (?, ?, ?, ?, ?, ?)').run('333333', 'u3', 'telegram', now, now + 600000, 'approved');

      const rows = db.prepare("SELECT * FROM assistant_pairing_codes WHERE status = 'pending' AND expires_at > ?").all(now) as any[];
      expect(rows).toHaveLength(1);
      expect(rows[0].code).toBe('111111');
    });

    it('should cleanup expired and non-pending codes', () => {
      const now = Date.now();
      db.prepare('INSERT INTO assistant_pairing_codes (code, platform_user_id, platform_type, requested_at, expires_at, status) VALUES (?, ?, ?, ?, ?, ?)').run('111111', 'u1', 'telegram', now, now - 1, 'pending'); // expired
      db.prepare('INSERT INTO assistant_pairing_codes (code, platform_user_id, platform_type, requested_at, expires_at, status) VALUES (?, ?, ?, ?, ?, ?)').run('222222', 'u2', 'telegram', now, now + 600000, 'approved'); // not pending
      db.prepare('INSERT INTO assistant_pairing_codes (code, platform_user_id, platform_type, requested_at, expires_at, status) VALUES (?, ?, ?, ?, ?, ?)').run('333333', 'u3', 'telegram', now, now + 600000, 'pending'); // valid

      const result = db.prepare("DELETE FROM assistant_pairing_codes WHERE expires_at < ? OR status != 'pending'").run(now);
      expect(result.changes).toBe(2);

      const remaining = db.prepare('SELECT * FROM assistant_pairing_codes').all();
      expect(remaining).toHaveLength(1);
    });
  });

  describe('Type Conversion Functions', () => {
    it('should round-trip gemini conversation', () => {
      const conversation = {
        id: 'c1',
        name: 'Test Chat',
        type: 'gemini' as const,
        extra: { workspace: '/tmp', history: [] },
        model: { provider: 'gemini', model: 'pro' },
        status: 'pending' as const,
        createTime: 1000,
        modifyTime: 2000,
      };

      const row = conversationToRow(conversation as any, 'u1');
      expect(row.type).toBe('gemini');
      expect(row.model).toBe(JSON.stringify(conversation.model));
      expect(row.extra).toBe(JSON.stringify(conversation.extra));

      const restored = rowToConversation(row);
      expect(restored.type).toBe('gemini');
      expect(restored.name).toBe('Test Chat');
      expect(restored.id).toBe('c1');
    });

    it('should round-trip acp conversation', () => {
      const conversation = {
        id: 'c2',
        name: 'ACP Chat',
        type: 'acp' as const,
        extra: { backend: 'claude', workspace: '/home' },
        status: 'running' as const,
        createTime: 1000,
        modifyTime: 2000,
      };

      const row = conversationToRow(conversation as any, 'u1');
      expect(row.type).toBe('acp');
      expect(row.model).toBeUndefined();

      const restored = rowToConversation(row);
      expect(restored.type).toBe('acp');
    });

    it('should round-trip codex conversation', () => {
      const conversation = {
        id: 'c3',
        name: 'Codex Chat',
        type: 'codex' as const,
        extra: { workspace: '/code' },
        status: 'finished' as const,
        createTime: 1000,
        modifyTime: 2000,
      };

      const row = conversationToRow(conversation as any, 'u1');
      const restored = rowToConversation(row);
      expect(restored.type).toBe('codex');
    });

    it('should round-trip openclaw-gateway conversation', () => {
      const conversation = {
        id: 'c4',
        name: 'OpenClaw Chat',
        type: 'openclaw-gateway' as const,
        extra: { workspace: '/work' },
        createTime: 1000,
        modifyTime: 2000,
      };

      const row = conversationToRow(conversation as any, 'u1');
      const restored = rowToConversation(row);
      expect(restored.type).toBe('openclaw-gateway');
    });

    it('should round-trip nanobot conversation', () => {
      const conversation = {
        id: 'c5',
        name: 'Nanobot Chat',
        type: 'nanobot' as const,
        extra: { workspace: '/nano' },
        createTime: 1000,
        modifyTime: 2000,
      };

      const row = conversationToRow(conversation as any, 'u1');
      const restored = rowToConversation(row);
      expect(restored.type).toBe('nanobot');
    });

    it('should throw for unknown conversation type', () => {
      const badRow: IConversationRow = {
        id: 'c99',
        user_id: 'u1',
        name: 'Bad',
        type: 'unknown' as any,
        extra: '{}',
        created_at: 1000,
        updated_at: 2000,
      };
      expect(() => rowToConversation(badRow)).toThrow('Unknown conversation type');
    });

    it('should round-trip message with text content', () => {
      const message = {
        id: 'm1',
        conversation_id: 'c1',
        msg_id: 'msg_1',
        type: 'text' as const,
        content: { content: 'Hello world' },
        position: 'left' as const,
        status: 'finish' as const,
        createdAt: 1000,
      };

      const row = messageToRow(message as any);
      expect(row.content).toBe(JSON.stringify(message.content));
      expect(row.msg_id).toBe('msg_1');

      const restored = rowToMessage(row);
      expect(restored.type).toBe('text');
      expect(restored.content).toEqual({ content: 'Hello world' });
      expect(restored.msg_id).toBe('msg_1');
    });

    it('should preserve source and channelChatId in conversation row', () => {
      const conversation = {
        id: 'c1',
        name: 'TG Chat',
        type: 'acp' as const,
        extra: { backend: 'claude' },
        source: 'telegram' as const,
        channelChatId: 'user:123',
        createTime: 1000,
        modifyTime: 2000,
      };

      const row = conversationToRow(conversation as any, 'u1');
      expect(row.source).toBe('telegram');
      expect(row.channel_chat_id).toBe('user:123');

      const restored = rowToConversation(row);
      expect(restored.source).toBe('telegram');
      expect(restored.channelChatId).toBe('user:123');
    });
  });

  describe('Cron Jobs table', () => {
    it('should exist after migrations', () => {
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='cron_jobs'").all();
      expect(tables).toHaveLength(1);
    });

    it('should insert and retrieve a cron job', () => {
      const now = Date.now();
      insertUser(db, 'u1', 'alice');
      db.prepare('INSERT INTO conversations (id, user_id, name, type, extra, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run('c1', 'u1', 'Chat', 'gemini', '{}', 'pending', now, now);

      db.prepare(
        `
        INSERT INTO cron_jobs (id, name, enabled, schedule_kind, schedule_value, schedule_description, payload_message, conversation_id, agent_type, created_by, created_at, updated_at, run_count, retry_count, max_retries)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
      ).run('j1', 'Daily Report', 1, 'cron', '0 9 * * *', 'Every day at 9am', 'Generate report', 'c1', 'gemini', 'user', now, now, 0, 0, 3);

      const row = db.prepare('SELECT * FROM cron_jobs WHERE id = ?').get('j1') as any;
      expect(row).toBeDefined();
      expect(row.name).toBe('Daily Report');
      expect(row.schedule_kind).toBe('cron');
    });
  });
});
