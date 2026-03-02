/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Use vi.hoisted for all mock functions referenced in vi.mock factories
const { mockCronStoreInsert, mockCronStoreUpdate, mockCronStoreDelete, mockCronStoreGetById, mockCronStoreListEnabled, mockCronStoreListByConversation, mockWorkerGetTaskById, mockWorkerGetTaskByIdRollbackBuild, mockWorkerKill, mockIsProcessing, mockAddMessage, mockIpcEmit, mockResponseStreamEmit } = vi.hoisted(() => ({
  mockCronStoreInsert: vi.fn(),
  mockCronStoreUpdate: vi.fn(),
  mockCronStoreDelete: vi.fn(),
  mockCronStoreGetById: vi.fn(() => null),
  mockCronStoreListEnabled: vi.fn(() => []),
  mockCronStoreListByConversation: vi.fn(() => []),
  mockWorkerGetTaskById: vi.fn(),
  mockWorkerGetTaskByIdRollbackBuild: vi.fn(),
  mockWorkerKill: vi.fn(),
  mockIsProcessing: vi.fn(() => false),
  mockAddMessage: vi.fn(),
  mockIpcEmit: vi.fn(),
  mockResponseStreamEmit: vi.fn(),
}));

// Mock ipcBridge — CronService imports from '@/common'
vi.mock('@/common', () => ({
  ipcBridge: {
    cron: {
      onJobUpdated: { emit: mockIpcEmit },
      onJobRemoved: { emit: vi.fn() },
    },
    conversation: {
      responseStream: { emit: mockResponseStreamEmit },
    },
  },
}));

vi.mock('@/common/utils', () => ({
  uuid: vi.fn(() => 'test-uuid'),
}));

// Mock cronStore
vi.mock('@/process/services/cron/CronStore', () => ({
  cronStore: {
    insert: mockCronStoreInsert,
    update: mockCronStoreUpdate,
    delete: mockCronStoreDelete,
    getById: mockCronStoreGetById,
    listEnabled: mockCronStoreListEnabled,
    listAll: vi.fn(() => []),
    listByConversation: mockCronStoreListByConversation,
  },
}));

// Mock WorkerManage
vi.mock('@/process/WorkerManage', () => ({
  default: {
    getTaskById: mockWorkerGetTaskById,
    getTaskByIdRollbackBuild: mockWorkerGetTaskByIdRollbackBuild,
    kill: mockWorkerKill,
  },
}));

// Mock database
vi.mock('@process/database', () => ({
  getDatabase: () => ({
    updateConversation: vi.fn(),
  }),
}));

// Mock addMessage
vi.mock('@process/message', () => ({
  addMessage: mockAddMessage,
}));

// Mock cronBusyGuard
vi.mock('@/process/services/cron/CronBusyGuard', () => ({
  cronBusyGuard: {
    isProcessing: mockIsProcessing,
  },
}));

// Mock utils
vi.mock('@/process/utils', () => ({
  copyFilesToDirectory: vi.fn(async () => []),
}));

// Mock croner — must use a class so `new Cron(...)` works
vi.mock('croner', () => {
  class MockCron {
    _callback: () => void;
    constructor(_expr: string, _opts: any, callback: () => void) {
      this._callback = callback;
    }
    stop() {}
    nextRun() {
      return new Date(Date.now() + 60000);
    }
  }
  return { Cron: MockCron };
});

// Mock electron with proper app export
vi.mock('electron', () => ({
  powerSaveBlocker: {
    start: vi.fn(() => 1),
    stop: vi.fn(),
  },
  app: {
    isPackaged: false,
    getPath: () => '/test',
    getAppPath: () => '/test',
  },
}));

import type { CronJob } from '@/process/services/cron/CronStore';

// Helper to create test jobs
function createTestJob(overrides: Partial<CronJob> = {}): CronJob {
  const now = Date.now();
  return {
    id: 'job-1',
    name: 'Test Job',
    enabled: true,
    schedule: { kind: 'cron', expr: '0 9 * * *', description: 'Every day at 9am' },
    target: { payload: { kind: 'message', text: 'Hello from cron' } },
    metadata: {
      conversationId: 'conv-1',
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

describe('CronService', () => {
  let cronService: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockCronStoreListEnabled.mockReturnValue([]);
    mockCronStoreListByConversation.mockReturnValue([]);
    mockCronStoreGetById.mockReturnValue(null);

    // Re-import to get fresh singleton
    vi.resetModules();
    const mod = await import('@/process/services/cron/CronService');
    cronService = mod.cronService;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('addJob', () => {
    it('should create a job with correct structure and save to DB', async () => {
      const params = {
        name: 'Daily Report',
        schedule: { kind: 'cron' as const, expr: '0 9 * * *', description: 'Daily at 9am' },
        message: 'Generate report',
        conversationId: 'conv-1',
        agentType: 'gemini' as const,
        createdBy: 'user' as const,
      };

      const job = await cronService.addJob(params);
      expect(job.name).toBe('Daily Report');
      expect(job.enabled).toBe(true);
      expect(job.target.payload.text).toBe('Generate report');
      expect(mockCronStoreInsert).toHaveBeenCalledWith(expect.objectContaining({ name: 'Daily Report' }));
    });

    it('should throw if conversation already has a cron job', async () => {
      mockCronStoreListByConversation.mockReturnValue([createTestJob()]);

      await expect(
        cronService.addJob({
          name: 'Another Job',
          schedule: { kind: 'cron', expr: '0 10 * * *', description: 'test' },
          message: 'Hello',
          conversationId: 'conv-1',
          agentType: 'gemini',
          createdBy: 'user',
        })
      ).rejects.toThrow('already has a scheduled task');
    });
  });

  describe('executeJob', () => {
    it('should execute job successfully when not busy', async () => {
      mockIsProcessing.mockReturnValue(false);
      const mockSendMessage = vi.fn(async () => {});
      const mockTask = {
        type: 'gemini',
        workspace: '/workspace',
        sendMessage: mockSendMessage,
        ensureYoloMode: vi.fn(async () => true),
      };
      mockWorkerGetTaskById.mockReturnValue(mockTask);
      mockCronStoreGetById.mockReturnValue(createTestJob());

      const job = createTestJob();
      await (cronService as any).executeJob(job);

      expect(mockSendMessage).toHaveBeenCalled();
      expect(job.state.lastStatus).toBe('ok');
      expect(job.state.runCount).toBe(1);
      expect(job.state.retryCount).toBe(0);
    });

    it('should increment retryCount and schedule retry when busy', async () => {
      mockIsProcessing.mockReturnValue(true);
      const job = createTestJob();

      await (cronService as any).executeJob(job);

      expect(job.state.retryCount).toBe(1);
    });

    it('should skip execution after maxRetries exceeded', async () => {
      mockIsProcessing.mockReturnValue(true);
      const job = createTestJob({ state: { runCount: 5, retryCount: 3, maxRetries: 3 } });
      mockCronStoreGetById.mockReturnValue(job);

      await (cronService as any).executeJob(job);

      expect(job.state.lastStatus).toBe('skipped');
      expect(job.state.retryCount).toBe(0);
    });

    it('should set error state when task build fails', async () => {
      mockIsProcessing.mockReturnValue(false);
      mockWorkerGetTaskById.mockReturnValue(null);
      mockWorkerGetTaskByIdRollbackBuild.mockRejectedValue(new Error('Build failed'));
      mockCronStoreGetById.mockReturnValue(createTestJob());

      const job = createTestJob();
      await (cronService as any).executeJob(job);

      expect(job.state.lastStatus).toBe('error');
      expect(job.state.lastError).toContain('Build failed');
    });

    it('should set error state when task is null', async () => {
      mockIsProcessing.mockReturnValue(false);
      mockWorkerGetTaskById.mockReturnValue(null);
      mockWorkerGetTaskByIdRollbackBuild.mockResolvedValue(null);
      mockCronStoreGetById.mockReturnValue(createTestJob());

      const job = createTestJob();
      await (cronService as any).executeJob(job);

      expect(job.state.lastStatus).toBe('error');
      expect(job.state.lastError).toBe('Conversation not found');
    });

    it('should set error state when sendMessage throws', async () => {
      mockIsProcessing.mockReturnValue(false);
      const mockTask = {
        type: 'gemini',
        workspace: '/workspace',
        sendMessage: vi.fn(async () => {
          throw new Error('Send failed');
        }),
        ensureYoloMode: vi.fn(async () => true),
      };
      mockWorkerGetTaskById.mockReturnValue(mockTask);
      mockCronStoreGetById.mockReturnValue(createTestJob());

      const job = createTestJob();
      await (cronService as any).executeJob(job);

      expect(job.state.lastStatus).toBe('error');
      expect(job.state.lastError).toContain('Send failed');
    });

    it('should use content param for acp/codex tasks', async () => {
      mockIsProcessing.mockReturnValue(false);
      const mockSendMessage = vi.fn(async () => {});
      const mockTask = {
        type: 'acp',
        workspace: '/workspace',
        sendMessage: mockSendMessage,
        ensureYoloMode: vi.fn(async () => true),
      };
      mockWorkerGetTaskById.mockReturnValue(mockTask);
      mockCronStoreGetById.mockReturnValue(createTestJob());

      const job = createTestJob();
      await (cronService as any).executeJob(job);

      expect(mockSendMessage).toHaveBeenCalledWith(expect.objectContaining({ content: 'Hello from cron' }));
    });

    it('should use input param for gemini tasks', async () => {
      mockIsProcessing.mockReturnValue(false);
      const mockSendMessage = vi.fn(async () => {});
      const mockTask = {
        type: 'gemini',
        workspace: '/workspace',
        sendMessage: mockSendMessage,
        ensureYoloMode: vi.fn(async () => true),
      };
      mockWorkerGetTaskById.mockReturnValue(mockTask);
      mockCronStoreGetById.mockReturnValue(createTestJob());

      const job = createTestJob();
      await (cronService as any).executeJob(job);

      expect(mockSendMessage).toHaveBeenCalledWith(expect.objectContaining({ input: 'Hello from cron' }));
    });

    it('should reuse existing task when ensureYoloMode succeeds', async () => {
      mockIsProcessing.mockReturnValue(false);
      const mockSendMessage = vi.fn(async () => {});
      const mockTask = {
        type: 'gemini',
        workspace: '/workspace',
        sendMessage: mockSendMessage,
        ensureYoloMode: vi.fn(async () => true),
      };
      mockWorkerGetTaskById.mockReturnValue(mockTask);
      mockCronStoreGetById.mockReturnValue(createTestJob());

      const job = createTestJob();
      await (cronService as any).executeJob(job);

      expect(mockTask.ensureYoloMode).toHaveBeenCalled();
      expect(mockWorkerKill).not.toHaveBeenCalled();
      expect(mockSendMessage).toHaveBeenCalled();
    });

    it('should kill and recreate task when ensureYoloMode fails', async () => {
      mockIsProcessing.mockReturnValue(false);
      const mockSendMessage = vi.fn(async () => {});
      const existingTask = {
        type: 'gemini',
        workspace: '/workspace',
        sendMessage: vi.fn(),
        ensureYoloMode: vi.fn(async () => false),
      };
      const newTask = {
        type: 'gemini',
        workspace: '/workspace',
        sendMessage: mockSendMessage,
      };
      mockWorkerGetTaskById.mockReturnValue(existingTask);
      mockWorkerGetTaskByIdRollbackBuild.mockResolvedValue(newTask);
      mockCronStoreGetById.mockReturnValue(createTestJob());

      const job = createTestJob();
      await (cronService as any).executeJob(job);

      expect(mockWorkerKill).toHaveBeenCalledWith('conv-1');
      expect(mockWorkerGetTaskByIdRollbackBuild).toHaveBeenCalledWith('conv-1', { yoloMode: true });
    });

    it('should create new task with yoloMode when no existing task', async () => {
      mockIsProcessing.mockReturnValue(false);
      const mockSendMessage = vi.fn(async () => {});
      mockWorkerGetTaskById.mockReturnValue(null);
      mockWorkerGetTaskByIdRollbackBuild.mockResolvedValue({
        type: 'gemini',
        workspace: '/workspace',
        sendMessage: mockSendMessage,
      });
      mockCronStoreGetById.mockReturnValue(createTestJob());

      const job = createTestJob();
      await (cronService as any).executeJob(job);

      expect(mockWorkerGetTaskByIdRollbackBuild).toHaveBeenCalledWith('conv-1', { yoloMode: true });
      expect(mockSendMessage).toHaveBeenCalled();
    });
  });

  describe('handleSystemResume', () => {
    it('should detect missed jobs and insert notification message', async () => {
      // Initialize first
      mockCronStoreListEnabled.mockReturnValue([]);
      await cronService.init();

      const pastJob = createTestJob({
        state: { runCount: 5, retryCount: 0, maxRetries: 3, nextRunAtMs: Date.now() - 60000 },
      });
      mockCronStoreListEnabled.mockReturnValue([pastJob]);
      mockCronStoreGetById.mockReturnValue(pastJob);

      await cronService.handleSystemResume();

      expect(pastJob.state.lastStatus).toBe('missed');
      expect(mockCronStoreUpdate).toHaveBeenCalled();
      expect(mockAddMessage).toHaveBeenCalled();
    });

    it('should do nothing when not initialized', async () => {
      // Create fresh instance without calling init()
      vi.resetModules();
      const freshMod = await import('@/process/services/cron/CronService');
      const freshService = freshMod.cronService;

      await freshService.handleSystemResume();
      // Should not query store since not initialized
      expect(mockCronStoreListEnabled).not.toHaveBeenCalled();
    });
  });

  describe('timer management', () => {
    it('should stop timer and delete from DB on removeJob', async () => {
      await cronService.removeJob('job-1');
      expect(mockCronStoreDelete).toHaveBeenCalledWith('job-1');
    });

    it('should stop all timers and reset state on cleanup', async () => {
      cronService.cleanup();
      // After cleanup, handleSystemResume should be a no-op (not initialized)
      await cronService.handleSystemResume();
      // listEnabled should not be called because initialized was reset to false
    });
  });
});
