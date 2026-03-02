/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockKill = vi.fn();

// Use class-based mocks to work correctly with `new` keyword
vi.mock('@/process/task/GeminiAgentManager', () => ({
  GeminiAgentManager: vi.fn().mockImplementation(function () {
    return { type: 'gemini', kill: mockKill };
  }),
}));
vi.mock('@/process/task/AcpAgentManager', () => ({
  default: vi.fn().mockImplementation(function () {
    return { type: 'acp', kill: mockKill };
  }),
}));
vi.mock('@/agent/codex', () => ({
  CodexAgentManager: vi.fn().mockImplementation(function () {
    return { type: 'codex', kill: mockKill };
  }),
}));
vi.mock('@/process/task/OpenClawAgentManager', () => ({
  default: vi.fn().mockImplementation(function () {
    return { type: 'openclaw-gateway', kill: mockKill };
  }),
}));
vi.mock('@/process/task/NanoBotAgentManager', () => ({
  default: vi.fn().mockImplementation(function () {
    return { type: 'nanobot', kill: mockKill };
  }),
}));

const mockGetConversation = vi.fn();
vi.mock('@/process/database/export', () => ({
  getDatabase: () => ({
    getConversation: mockGetConversation,
  }),
}));

const mockProcessChatGet = vi.fn();
vi.mock('@/process/initStorage', () => ({
  ProcessChat: {
    get: mockProcessChatGet,
  },
}));

describe('WorkerManage', () => {
  let WorkerManage: typeof import('@/process/WorkerManage').default;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    const mod = await import('@/process/WorkerManage');
    WorkerManage = mod.default;
  });

  describe('buildConversation', () => {
    it('should create GeminiAgentManager for gemini type', async () => {
      const { GeminiAgentManager } = await import('@/process/task/GeminiAgentManager');
      const conv = { id: 'c1', type: 'gemini', extra: { workspace: '/tmp' }, model: { provider: 'gemini' } } as any;
      const task = WorkerManage.buildConversation(conv);
      expect(task).toBeDefined();
      expect(GeminiAgentManager).toHaveBeenCalled();
    });

    it('should create AcpAgentManager for acp type', async () => {
      const mod = await import('@/process/task/AcpAgentManager');
      const conv = { id: 'c2', type: 'acp', extra: { backend: 'claude' } } as any;
      const task = WorkerManage.buildConversation(conv);
      expect(task).toBeDefined();
      expect(mod.default).toHaveBeenCalled();
    });

    it('should create CodexAgentManager for codex type', async () => {
      const { CodexAgentManager } = await import('@/agent/codex');
      const conv = { id: 'c3', type: 'codex', extra: { workspace: '/tmp' } } as any;
      const task = WorkerManage.buildConversation(conv);
      expect(task).toBeDefined();
      expect(CodexAgentManager).toHaveBeenCalled();
    });

    it('should create OpenClawAgentManager for openclaw-gateway type', async () => {
      const mod = await import('@/process/task/OpenClawAgentManager');
      const conv = { id: 'c4', type: 'openclaw-gateway', extra: {} } as any;
      const task = WorkerManage.buildConversation(conv);
      expect(task).toBeDefined();
      expect(mod.default).toHaveBeenCalled();
    });

    it('should create NanoBotAgentManager for nanobot type', async () => {
      const mod = await import('@/process/task/NanoBotAgentManager');
      const conv = { id: 'c5', type: 'nanobot', extra: {} } as any;
      const task = WorkerManage.buildConversation(conv);
      expect(task).toBeDefined();
      expect(mod.default).toHaveBeenCalled();
    });

    it('should return null for unknown type', () => {
      const conv = { id: 'c6', type: 'unknown', extra: {} } as any;
      const task = WorkerManage.buildConversation(conv);
      expect(task).toBeNull();
    });

    it('should return cached task on second call (same id, no skipCache)', () => {
      const conv = { id: 'c1', type: 'gemini', extra: { workspace: '/tmp' }, model: {} } as any;
      const task1 = WorkerManage.buildConversation(conv);
      const task2 = WorkerManage.buildConversation(conv);
      expect(task1).toBe(task2);
    });

    it('should create new instance with skipCache: true', () => {
      const conv = { id: 'c1', type: 'gemini', extra: { workspace: '/tmp' }, model: {} } as any;
      const first = WorkerManage.buildConversation(conv);
      const second = WorkerManage.buildConversation(conv, { skipCache: true });
      expect(second).toBeDefined();
      expect(second).not.toBe(first);
    });
  });

  describe('addTask / listTasks', () => {
    it('should add task and list it', () => {
      const mockTask = { type: 'gemini', kill: vi.fn() } as any;
      WorkerManage.addTask('t1', mockTask);
      const list = WorkerManage.listTasks();
      expect(list).toEqual([{ id: 't1', type: 'gemini' }]);
    });

    it('should replace task with existing id', () => {
      const task1 = { type: 'gemini', kill: vi.fn() } as any;
      const task2 = { type: 'acp', kill: vi.fn() } as any;
      WorkerManage.addTask('t1', task1);
      WorkerManage.addTask('t1', task2);
      const list = WorkerManage.listTasks();
      expect(list).toHaveLength(1);
      expect(list[0].type).toBe('acp');
    });
  });

  describe('kill', () => {
    it('should remove task and call kill()', () => {
      const killFn = vi.fn();
      const mockTask = { type: 'gemini', kill: killFn } as any;
      WorkerManage.addTask('c1', mockTask);
      WorkerManage.kill('c1');
      expect(killFn).toHaveBeenCalled();
      expect(WorkerManage.listTasks()).toHaveLength(0);
    });

    it('should be no-op for nonexistent id', () => {
      expect(() => WorkerManage.kill('nonexistent')).not.toThrow();
    });
  });

  describe('clear', () => {
    it('should kill all tasks and empty list', () => {
      const kill1 = vi.fn();
      const kill2 = vi.fn();
      WorkerManage.addTask('c1', { type: 'gemini', kill: kill1 } as any);
      WorkerManage.addTask('c2', { type: 'acp', kill: kill2 } as any);
      WorkerManage.clear();
      expect(WorkerManage.listTasks()).toHaveLength(0);
      expect(kill1).toHaveBeenCalled();
      expect(kill2).toHaveBeenCalled();
    });
  });

  describe('getTaskByIdRollbackBuild', () => {
    it('should return memory-cached task', async () => {
      const mockTask = { type: 'gemini', kill: vi.fn() } as any;
      WorkerManage.addTask('c1', mockTask);

      const task = await WorkerManage.getTaskByIdRollbackBuild('c1');
      expect(task).toBeDefined();
      expect(task).toBe(mockTask);
      expect(mockGetConversation).not.toHaveBeenCalled();
    });

    it('should fall back to database', async () => {
      const conv = { id: 'c1', type: 'gemini', extra: { workspace: '/tmp' }, model: {} };
      mockGetConversation.mockReturnValue({ success: true, data: conv });

      const task = await WorkerManage.getTaskByIdRollbackBuild('c1');
      expect(task).toBeDefined();
      expect(mockGetConversation).toHaveBeenCalledWith('c1');
    });

    it('should fall back to file storage', async () => {
      mockGetConversation.mockReturnValue({ success: false });
      const conv = { id: 'c1', type: 'acp', extra: { backend: 'claude' } };
      mockProcessChatGet.mockResolvedValue([conv]);

      const task = await WorkerManage.getTaskByIdRollbackBuild('c1');
      expect(task).toBeDefined();
      expect(mockProcessChatGet).toHaveBeenCalledWith('chat.history');
    });

    it('should reject when all sources fail', async () => {
      mockGetConversation.mockReturnValue({ success: false });
      mockProcessChatGet.mockResolvedValue([]);

      await expect(WorkerManage.getTaskByIdRollbackBuild('c1')).rejects.toThrow('Conversation not found');
    });
  });
});
