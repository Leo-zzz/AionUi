/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Use vi.hoisted for mock functions referenced in vi.mock factories
const { mockCreateConversation, mockUpdateConversation, mockFindChannelConversation, mockCreateGeminiAgent, mockCreateAcpAgent, mockCreateCodexAgent, mockCreateOpenClawAgent, mockCreateNanobotAgent, mockBuildConversation } = vi.hoisted(() => ({
  mockCreateConversation: vi.fn(() => ({ success: true })),
  mockUpdateConversation: vi.fn(() => ({ success: true })),
  mockFindChannelConversation: vi.fn(() => ({ success: false, data: null })),
  mockCreateGeminiAgent: vi.fn(async () => ({ id: 'conv-test', name: 'Test', type: 'gemini', createTime: Date.now(), modifyTime: Date.now(), extra: {} })),
  mockCreateAcpAgent: vi.fn(async () => ({ id: 'conv-test', name: 'Test', type: 'acp', createTime: Date.now(), modifyTime: Date.now(), extra: {} })),
  mockCreateCodexAgent: vi.fn(async () => ({ id: 'conv-test', name: 'Test', type: 'codex', createTime: Date.now(), modifyTime: Date.now(), extra: {} })),
  mockCreateOpenClawAgent: vi.fn(async () => ({ id: 'conv-test', name: 'Test', type: 'openclaw-gateway', createTime: Date.now(), modifyTime: Date.now(), extra: {} })),
  mockCreateNanobotAgent: vi.fn(async () => ({ id: 'conv-test', name: 'Test', type: 'nanobot', createTime: Date.now(), modifyTime: Date.now(), extra: {} })),
  mockBuildConversation: vi.fn(),
}));

// Mock path module
vi.mock('path', () => ({
  default: {
    isAbsolute: (p: string) => p.startsWith('/') || /^[A-Z]:/.test(p),
    resolve: (...args: string[]) => args.join('/'),
  },
  isAbsolute: (p: string) => p.startsWith('/') || /^[A-Z]:/.test(p),
  resolve: (...args: string[]) => args.join('/'),
}));

// Mock database
vi.mock('@process/database', () => ({
  getDatabase: () => ({
    createConversation: mockCreateConversation,
    updateConversation: mockUpdateConversation,
    findChannelConversation: mockFindChannelConversation,
  }),
}));

// Mock initAgent functions — this is the key mock that prevents electron imports
vi.mock('@/process/initAgent', () => ({
  createGeminiAgent: mockCreateGeminiAgent,
  createAcpAgent: mockCreateAcpAgent,
  createCodexAgent: mockCreateCodexAgent,
  createOpenClawAgent: mockCreateOpenClawAgent,
  createNanobotAgent: mockCreateNanobotAgent,
}));

// Mock WorkerManage
vi.mock('@/process/WorkerManage', () => ({
  default: {
    buildConversation: mockBuildConversation,
  },
}));

// Mock channel types
vi.mock('@/channels/types', () => ({
  getChannelConversationName: (source: string, type: string) => `${source} ${type} Chat`,
  isChannelPlatform: (source: string) => source !== 'aionui',
}));

import { ConversationService } from '@/process/services/conversationService';

describe('ConversationService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateConversation.mockReturnValue({ success: true });
  });

  describe('createConversation', () => {
    const baseParams = {
      type: 'gemini' as const,
      model: { provider: 'google', useModel: 'gemini-pro' } as any,
      extra: { workspace: '/workspace' },
    };

    it('should create gemini conversation via createGeminiAgent', async () => {
      const result = await ConversationService.createConversation(baseParams);
      expect(result.success).toBe(true);
      expect(result.conversation).toBeDefined();
      expect(mockCreateGeminiAgent).toHaveBeenCalled();
      expect(mockBuildConversation).toHaveBeenCalled();
    });

    it('should create acp conversation via createAcpAgent', async () => {
      const result = await ConversationService.createConversation({ ...baseParams, type: 'acp' });
      expect(result.success).toBe(true);
      expect(mockCreateAcpAgent).toHaveBeenCalled();
    });

    it('should create codex conversation via createCodexAgent', async () => {
      const result = await ConversationService.createConversation({ ...baseParams, type: 'codex' });
      expect(result.success).toBe(true);
      expect(mockCreateCodexAgent).toHaveBeenCalled();
    });

    it('should create openclaw-gateway conversation via createOpenClawAgent', async () => {
      const result = await ConversationService.createConversation({ ...baseParams, type: 'openclaw-gateway' });
      expect(result.success).toBe(true);
      expect(mockCreateOpenClawAgent).toHaveBeenCalled();
    });

    it('should create nanobot conversation via createNanobotAgent', async () => {
      const result = await ConversationService.createConversation({ ...baseParams, type: 'nanobot' });
      expect(result.success).toBe(true);
      expect(mockCreateNanobotAgent).toHaveBeenCalled();
    });

    it('should return error for unknown conversation type', async () => {
      const result = await ConversationService.createConversation({ ...baseParams, type: 'unknown' as any });
      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid conversation type');
    });

    it('should apply custom id and name', async () => {
      const result = await ConversationService.createConversation({
        ...baseParams,
        id: 'custom-id',
        name: 'Custom Name',
      });
      expect(result.success).toBe(true);
      expect(result.conversation?.id).toBe('custom-id');
      expect(result.conversation?.name).toBe('Custom Name');
    });

    it('should apply source to conversation', async () => {
      const result = await ConversationService.createConversation({
        ...baseParams,
        source: 'telegram' as any,
      });
      expect(result.success).toBe(true);
      expect(result.conversation?.source).toBe('telegram');
    });

    it('should return error when DB save fails', async () => {
      mockCreateConversation.mockReturnValue({ success: false, error: 'DB write error' });
      const result = await ConversationService.createConversation(baseParams);
      expect(result.success).toBe(false);
      expect(result.error).toBe('DB write error');
      expect(mockBuildConversation).not.toHaveBeenCalled();
    });

    it('should return error when agent creator throws', async () => {
      mockCreateGeminiAgent.mockRejectedValueOnce(new Error('Agent init failed'));
      const result = await ConversationService.createConversation(baseParams);
      expect(result.success).toBe(false);
      expect(result.error).toContain('Agent init failed');
    });
  });

  describe('getOrCreateChannelConversation', () => {
    const channelParams = {
      model: { provider: 'google', useModel: 'gemini-pro' } as any,
      source: 'telegram' as any,
      workspace: '/workspace',
      channelChatId: 'user:12345',
    };

    it('should reuse existing conversation when found by source+channelChatId', async () => {
      const existingConv = { id: 'existing-conv', name: 'Old Chat', type: 'gemini' };
      mockFindChannelConversation.mockReturnValue({ success: true, data: existingConv });

      const result = await ConversationService.getOrCreateChannelConversation(channelParams);
      expect(result.success).toBe(true);
      expect(result.conversation?.id).toBe('existing-conv');
      expect(mockCreateGeminiAgent).not.toHaveBeenCalled();
    });

    it('should create new conversation when none exists', async () => {
      mockFindChannelConversation.mockReturnValue({ success: false, data: null });

      const result = await ConversationService.getOrCreateChannelConversation(channelParams);
      expect(result.success).toBe(true);
      expect(mockCreateGeminiAgent).toHaveBeenCalled();
    });

    it('should always create new when no channelChatId provided', async () => {
      const paramsNoChat = { ...channelParams, channelChatId: undefined as any };
      const result = await ConversationService.getOrCreateChannelConversation(paramsNoChat);
      expect(result.success).toBe(true);
      expect(mockCreateGeminiAgent).toHaveBeenCalled();
      expect(mockFindChannelConversation).not.toHaveBeenCalled();
    });
  });
});
