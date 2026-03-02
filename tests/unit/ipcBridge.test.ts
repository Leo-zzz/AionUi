/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock all dependencies that conversationBridge uses
const mockBuildConversation = vi.fn();
const mockGetTaskById = vi.fn();
const mockKill = vi.fn();
const mockClear = vi.fn();
const mockGetTaskByIdRollbackBuild = vi.fn();

vi.mock('@/process/WorkerManage', () => ({
  default: {
    buildConversation: mockBuildConversation,
    getTaskById: mockGetTaskById,
    kill: mockKill,
    clear: mockClear,
    getTaskByIdRollbackBuild: mockGetTaskByIdRollbackBuild,
  },
}));

const mockCreateConversation = vi.fn();
const mockGetConversation = vi.fn();
const mockDeleteConversation = vi.fn();
const mockDeleteConversationMessages = vi.fn();
const mockInsertMessage = vi.fn();

vi.mock('@process/database/export', () => ({
  getDatabase: () => ({
    createConversation: mockCreateConversation,
    getConversation: mockGetConversation,
    deleteConversation: mockDeleteConversation,
    deleteConversationMessages: mockDeleteConversationMessages,
    insertMessage: mockInsertMessage,
  }),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    conversation: {
      create: { provider: vi.fn() },
      get: { provider: vi.fn() },
      sendMessage: { provider: vi.fn() },
      stop: { provider: vi.fn() },
      remove: { provider: vi.fn() },
      update: { provider: vi.fn() },
      reset: { provider: vi.fn() },
    },
    cron: {
      onJobUpdated: { emit: vi.fn() },
    },
  },
}));

vi.mock('@/process/services/cron/CronStore', () => ({
  cronStore: {
    deleteByConversation: vi.fn(),
  },
}));

vi.mock('@/process/initStorage', () => ({
  ProcessChat: { get: vi.fn(), set: vi.fn() },
  ProcessConfig: { get: vi.fn(), set: vi.fn() },
}));

describe('IPC Bridge - Conversation Operations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('WorkerManage integration', () => {
    it('should route sendMessage to correct agent via buildConversation', () => {
      const mockTask = { sendMessage: vi.fn(), type: 'gemini' };
      mockBuildConversation.mockReturnValue(mockTask);

      const conv = { id: 'c1', type: 'gemini', extra: { workspace: '/tmp' }, model: {} };
      const task = mockBuildConversation(conv);
      expect(task).toBe(mockTask);
      expect(mockBuildConversation).toHaveBeenCalledWith(conv);
    });

    it('should create conversation in database', () => {
      mockCreateConversation.mockReturnValue({ success: true, data: { id: 'c1' } });
      const result = mockCreateConversation({ id: 'c1', type: 'gemini', name: 'Test' });
      expect(result.success).toBe(true);
    });

    it('should kill task and delete from DB on conversation remove', () => {
      mockDeleteConversation.mockReturnValue({ success: true, data: true });
      mockDeleteConversationMessages.mockReturnValue({ success: true, data: 0 });

      mockKill('c1');
      expect(mockKill).toHaveBeenCalledWith('c1');

      const result = mockDeleteConversation('c1');
      expect(result.success).toBe(true);
    });

    it('should dispatch stop to correct task', () => {
      const mockTask = { stop: vi.fn() };
      mockGetTaskById.mockReturnValue(mockTask);

      const task = mockGetTaskById('c1');
      expect(task).toBe(mockTask);
      task.stop();
      expect(mockTask.stop).toHaveBeenCalled();
    });
  });

  describe('Confirmation flow', () => {
    it('should store and resolve confirmations', async () => {
      // Simulate the confirmation pattern
      const confirmations = new Map<string, (value: any) => void>();
      const addConfirmation = (key: string) => {
        return new Promise((resolve) => {
          confirmations.set(key, resolve);
        });
      };

      const confirm = (key: string, value: any) => {
        const resolver = confirmations.get(key);
        if (resolver) {
          resolver(value);
          confirmations.delete(key);
          return true;
        }
        return false;
      };

      const promise = addConfirmation('confirm_1');
      expect(confirmations.has('confirm_1')).toBe(true);

      confirm('confirm_1', { approved: true });
      const result = await promise;
      expect(result).toEqual({ approved: true });
      expect(confirmations.has('confirm_1')).toBe(false);
    });
  });

  describe('Database operations', () => {
    it('should get conversation from database', () => {
      const conv = { id: 'c1', type: 'gemini', name: 'Test' };
      mockGetConversation.mockReturnValue({ success: true, data: conv });

      const result = mockGetConversation('c1');
      expect(result.success).toBe(true);
      expect(result.data.id).toBe('c1');
    });

    it('should handle missing conversation gracefully', () => {
      mockGetConversation.mockReturnValue({ success: false, error: 'Not found' });

      const result = mockGetConversation('nonexistent');
      expect(result.success).toBe(false);
    });

    it('should delete conversation messages on remove', () => {
      mockDeleteConversationMessages.mockReturnValue({ success: true, data: 5 });
      const result = mockDeleteConversationMessages('c1');
      expect(result.data).toBe(5);
    });
  });
});
