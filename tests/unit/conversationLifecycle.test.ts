/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Use vi.hoisted for all mock functions referenced in vi.mock factories
const { mockGetConversation, mockDeleteConversation, mockUpdateConversation, mockKill, mockClear, mockGetTaskById, mockGetTaskByIdRollbackBuild, mockListJobsByConversation, mockRemoveJob, mockIpcEmitters, providers } = vi.hoisted(() => {
  const providers: Record<string, (...args: any[]) => any> = {};
  const mockIpcEmitters: Record<string, vi.Mock> = {};

  return {
    mockGetConversation: vi.fn(() => ({ success: true, data: { id: 'conv-1', type: 'gemini', source: 'aionui', extra: {} } })),
    mockDeleteConversation: vi.fn(() => ({ success: true })),
    mockUpdateConversation: vi.fn(() => ({ success: true })),
    mockKill: vi.fn(),
    mockClear: vi.fn(),
    mockGetTaskById: vi.fn(),
    mockGetTaskByIdRollbackBuild: vi.fn(),
    mockListJobsByConversation: vi.fn(async () => []),
    mockRemoveJob: vi.fn(async () => {}),
    mockIpcEmitters,
    providers,
  };
});

// Helper to build IPC mock shapes
function buildEmitter(name: string) {
  const fn = vi.fn();
  mockIpcEmitters[name] = fn;
  return { emit: fn };
}

function buildProvider(name: string) {
  return {
    provider: (fn: any) => {
      providers[name] = fn;
    },
    invoke: vi.fn(),
  };
}

// Mock ipcBridge — conversationBridge imports from '../../common' which resolves to src/common
vi.mock('@/common', () => ({
  ipcBridge: {
    conversation: {
      create: buildProvider('conversation.create'),
      createWithConversation: buildProvider('conversation.createWithConversation'),
      get: buildProvider('conversation.get'),
      getAssociateConversation: buildProvider('conversation.getAssociateConversation'),
      remove: buildProvider('conversation.remove'),
      update: buildProvider('conversation.update'),
      reset: buildProvider('conversation.reset'),
      stop: buildProvider('conversation.stop'),
      sendMessage: buildProvider('conversation.sendMessage'),
      responseStream: buildEmitter('conversation.responseStream'),
      getWorkspace: buildProvider('conversation.getWorkspace'),
      responseSearchWorkSpace: buildProvider('conversation.responseSearchWorkSpace'),
      reloadContext: buildProvider('conversation.reloadContext'),
      confirmation: {
        add: buildEmitter('confirmation.add'),
        update: buildEmitter('confirmation.update'),
        confirm: buildProvider('confirmation.confirm'),
        list: buildProvider('confirmation.list'),
        remove: buildEmitter('confirmation.remove'),
      },
      approval: {
        check: buildProvider('approval.check'),
      },
    },
    cron: {
      onJobRemoved: buildEmitter('cron.onJobRemoved'),
      onJobUpdated: buildEmitter('cron.onJobUpdated'),
    },
    openclawConversation: {
      getRuntime: buildProvider('openclawConversation.getRuntime'),
    },
  },
}));

// Mock @/common/utils
vi.mock('@/common/utils', () => ({
  uuid: vi.fn(() => 'test-uuid'),
}));

// Mock database
vi.mock('@process/database', () => ({
  getDatabase: () => ({
    getConversation: mockGetConversation,
    deleteConversation: mockDeleteConversation,
    updateConversation: mockUpdateConversation,
    getConversationMessages: vi.fn(() => ({ data: [], total: 0, hasMore: false })),
    insertMessage: vi.fn(),
    createConversation: vi.fn(() => ({ success: true })),
  }),
}));

// Mock WorkerManage
vi.mock('@/process/WorkerManage', () => ({
  default: {
    kill: mockKill,
    clear: mockClear,
    getTaskById: mockGetTaskById,
    getTaskByIdRollbackBuild: mockGetTaskByIdRollbackBuild,
    buildConversation: vi.fn(),
  },
}));

// Mock cronService
vi.mock('@process/services/cron/CronService', () => ({
  cronService: {
    listJobsByConversation: mockListJobsByConversation,
    removeJob: mockRemoveJob,
  },
}));

// Mock ConversationService
vi.mock('@/process/services/conversationService', () => ({
  ConversationService: {
    createConversation: vi.fn(async () => ({ success: true, conversation: { id: 'new-conv', type: 'gemini' } })),
  },
}));

// Mock initStorage
vi.mock('@/process/initStorage', () => ({
  ProcessChat: {
    get: vi.fn(async () => []),
    set: vi.fn(),
  },
}));

// Mock migrationUtils
vi.mock('@/process/bridge/migrationUtils', () => ({
  migrateConversationToDatabase: vi.fn(),
}));

// Mock GeminiAgent
vi.mock('@/agent/gemini', () => ({
  GeminiAgent: { buildFileServer: vi.fn() },
  GeminiApprovalStore: { createKeysFromConfirmation: vi.fn(() => []) },
}));

// Mock utils
vi.mock('@/process/utils', () => ({
  copyFilesToDirectory: vi.fn(async () => []),
  readDirectoryRecursive: vi.fn(async () => null),
}));

vi.mock('@/process/utils/openclawUtils', () => ({
  computeOpenClawIdentityHash: vi.fn(async () => 'hash'),
}));

import { initConversationBridge } from '@/process/bridge/conversationBridge';

describe('conversationLifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetConversation.mockReturnValue({ success: true, data: { id: 'conv-1', type: 'gemini', source: 'aionui', extra: {} } });
    mockDeleteConversation.mockReturnValue({ success: true });
    mockUpdateConversation.mockReturnValue({ success: true });

    // Register all providers
    initConversationBridge();
  });

  describe('remove (deletion cascade)', () => {
    it('should kill running task on removal', async () => {
      await providers['conversation.remove']({ id: 'conv-1' });
      expect(mockKill).toHaveBeenCalledWith('conv-1');
    });

    it('should delete associated cron jobs and emit onJobRemoved', async () => {
      mockListJobsByConversation.mockResolvedValue([{ id: 'job-1' }, { id: 'job-2' }]);
      await providers['conversation.remove']({ id: 'conv-1' });
      expect(mockRemoveJob).toHaveBeenCalledTimes(2);
      expect(mockIpcEmitters['cron.onJobRemoved']).toHaveBeenCalledTimes(2);
    });

    it('should cleanup channel resources for non-aionui source', async () => {
      mockGetConversation.mockReturnValue({ success: true, data: { id: 'conv-1', type: 'gemini', source: 'telegram', extra: {} } });
      // Dynamic import of ChannelManager will fail in test env, but deletion should continue
      const result = await providers['conversation.remove']({ id: 'conv-1' });
      expect(result).toBe(true);
    });

    it('should skip channel cleanup for aionui source', async () => {
      const result = await providers['conversation.remove']({ id: 'conv-1' });
      expect(result).toBe(true);
    });

    it('should delete from database', async () => {
      await providers['conversation.remove']({ id: 'conv-1' });
      expect(mockDeleteConversation).toHaveBeenCalledWith('conv-1');
    });

    it('should continue deletion even if cron cleanup fails', async () => {
      mockListJobsByConversation.mockRejectedValue(new Error('Cron DB error'));
      const result = await providers['conversation.remove']({ id: 'conv-1' });
      expect(result).toBe(true);
      expect(mockDeleteConversation).toHaveBeenCalled();
    });

    it('should return false if DB delete fails', async () => {
      mockDeleteConversation.mockReturnValue({ success: false, error: 'FK constraint' });
      const result = await providers['conversation.remove']({ id: 'conv-1' });
      expect(result).toBe(false);
    });
  });

  describe('update', () => {
    it('should call db.updateConversation with updates', async () => {
      const result = await providers['conversation.update']({ id: 'conv-1', updates: { name: 'New Name' } });
      expect(result).toBe(true);
      expect(mockUpdateConversation).toHaveBeenCalledWith('conv-1', { name: 'New Name' });
    });

    it('should kill task when model changes', async () => {
      mockGetConversation.mockReturnValue({
        success: true,
        data: { id: 'conv-1', model: { useModel: 'old-model' }, extra: {} },
      });
      await providers['conversation.update']({
        id: 'conv-1',
        updates: { model: { useModel: 'new-model' } },
      });
      expect(mockKill).toHaveBeenCalledWith('conv-1');
    });

    it('should merge extra fields when mergeExtra is true', async () => {
      mockGetConversation.mockReturnValue({
        success: true,
        data: { id: 'conv-1', extra: { workspace: '/old', foo: 'bar' } },
      });
      await providers['conversation.update']({
        id: 'conv-1',
        updates: { extra: { workspace: '/new' } },
        mergeExtra: true,
      });
      expect(mockUpdateConversation).toHaveBeenCalledWith(
        'conv-1',
        expect.objectContaining({
          extra: expect.objectContaining({ workspace: '/new', foo: 'bar' }),
        })
      );
    });

    it('should not kill task when model does not change', async () => {
      mockGetConversation.mockReturnValue({
        success: true,
        data: { id: 'conv-1', model: { useModel: 'same-model' }, extra: {} },
      });
      await providers['conversation.update']({
        id: 'conv-1',
        updates: { name: 'Renamed' },
      });
      expect(mockKill).not.toHaveBeenCalled();
    });

    it('should return false on error', async () => {
      mockUpdateConversation.mockImplementation(() => {
        throw new Error('DB error');
      });
      const result = await providers['conversation.update']({ id: 'conv-1', updates: { name: 'test' } });
      expect(result).toBe(false);
    });
  });

  describe('reset', () => {
    it('should kill single task when id is provided', async () => {
      await providers['conversation.reset']({ id: 'conv-1' });
      expect(mockKill).toHaveBeenCalledWith('conv-1');
    });

    it('should clear all tasks when id is not provided', async () => {
      await providers['conversation.reset']({});
      expect(mockClear).toHaveBeenCalled();
    });
  });

  describe('get', () => {
    it('should return conversation from DB with task status', async () => {
      mockGetConversation.mockReturnValue({ success: true, data: { id: 'conv-1', type: 'gemini' } });
      mockGetTaskById.mockReturnValue({ status: 'running' });

      const result = await providers['conversation.get']({ id: 'conv-1' });
      expect(result.id).toBe('conv-1');
      expect(result.status).toBe('running');
    });

    it('should return "finished" status when no task is running', async () => {
      mockGetConversation.mockReturnValue({ success: true, data: { id: 'conv-1', type: 'gemini' } });
      mockGetTaskById.mockReturnValue(undefined);

      const result = await providers['conversation.get']({ id: 'conv-1' });
      expect(result.status).toBe('finished');
    });
  });

  describe('stop', () => {
    it('should call task.stop() for supported types', async () => {
      const mockStop = vi.fn(async () => {});
      mockGetTaskById.mockReturnValue({ type: 'gemini', stop: mockStop });

      const result = await providers['conversation.stop']({ conversation_id: 'conv-1' });
      expect(result.success).toBe(true);
      expect(mockStop).toHaveBeenCalled();
    });

    it('should return not support for unsupported task type', async () => {
      mockGetTaskById.mockReturnValue({ type: 'unknown_type' });

      const result = await providers['conversation.stop']({ conversation_id: 'conv-1' });
      expect(result.success).toBe(false);
      expect(result.msg).toBe('not support');
    });

    it('should return success if task is not found', async () => {
      mockGetTaskById.mockReturnValue(undefined);

      const result = await providers['conversation.stop']({ conversation_id: 'conv-1' });
      expect(result.success).toBe(true);
    });
  });

  describe('confirm', () => {
    it('should call task.confirm() with correct params', async () => {
      const mockConfirm = vi.fn();
      mockGetTaskById.mockReturnValue({ confirm: mockConfirm, getConfirmations: vi.fn(() => []) });

      const result = await providers['confirmation.confirm']({
        conversation_id: 'conv-1',
        msg_id: 'msg-1',
        callId: 'call-1',
        data: { value: 'allow' },
      });
      expect(result.success).toBe(true);
      expect(mockConfirm).toHaveBeenCalledWith('msg-1', 'call-1', { value: 'allow' });
    });

    it('should return failure if task is not found', async () => {
      mockGetTaskById.mockReturnValue(undefined);

      const result = await providers['confirmation.confirm']({
        conversation_id: 'conv-1',
        msg_id: 'msg-1',
        callId: 'call-1',
        data: {},
      });
      expect(result.success).toBe(false);
    });
  });

  describe('sendMessage', () => {
    it('should dispatch to gemini task with correct params', async () => {
      const mockSendMessage = vi.fn(async () => {});
      mockGetTaskByIdRollbackBuild.mockResolvedValue({
        type: 'gemini',
        workspace: '/workspace',
        sendMessage: mockSendMessage,
      });

      const result = await providers['conversation.sendMessage']({
        conversation_id: 'conv-1',
        input: 'Hello',
        msg_id: 'msg-1',
        files: [],
      });
      expect(result.success).toBe(true);
      expect(mockSendMessage).toHaveBeenCalled();
    });

    it('should dispatch to acp task with content param', async () => {
      const mockSendMessage = vi.fn(async () => {});
      mockGetTaskByIdRollbackBuild.mockResolvedValue({
        type: 'acp',
        workspace: '/workspace',
        sendMessage: mockSendMessage,
      });

      const result = await providers['conversation.sendMessage']({
        conversation_id: 'conv-1',
        input: 'Hello',
        msg_id: 'msg-1',
        files: [],
      });
      expect(result.success).toBe(true);
      expect(mockSendMessage).toHaveBeenCalledWith(expect.objectContaining({ content: 'Hello', msg_id: 'msg-1' }));
    });

    it('should return error when task not found', async () => {
      mockGetTaskByIdRollbackBuild.mockResolvedValue(undefined);

      const result = await providers['conversation.sendMessage']({
        conversation_id: 'conv-1',
        input: 'Hello',
        msg_id: 'msg-1',
      });
      expect(result.success).toBe(false);
      expect(result.msg).toBe('conversation not found');
    });

    it('should return error for unsupported task type', async () => {
      mockGetTaskByIdRollbackBuild.mockResolvedValue({
        type: 'unsupported_type',
        workspace: '/workspace',
      });

      const result = await providers['conversation.sendMessage']({
        conversation_id: 'conv-1',
        input: 'Hello',
        msg_id: 'msg-1',
        files: [],
      });
      expect(result.success).toBe(false);
    });
  });
});
