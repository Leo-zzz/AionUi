/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

let uuidCounter = 0;
vi.mock('@/common/utils', () => ({
  uuid: () => `uuid-${++uuidCounter}`,
}));

import { AcpAdapter } from '@/agent/acp/AcpAdapter';
import type { AcpSessionUpdate, ToolCallUpdate, ToolCallUpdateStatus, PlanUpdate } from '@/types/acpTypes';

function makeChunkUpdate(text: string): AcpSessionUpdate {
  return {
    sessionId: 'sess1',
    update: {
      sessionUpdate: 'agent_message_chunk',
      content: { text },
    },
  } as AcpSessionUpdate;
}

function makeThoughtUpdate(text: string): AcpSessionUpdate {
  return {
    sessionId: 'sess1',
    update: {
      sessionUpdate: 'agent_thought_chunk',
      content: { text },
    },
  } as AcpSessionUpdate;
}

function makeToolCallUpdate(toolCallId: string, title: string, status = 'in_progress'): ToolCallUpdate {
  return {
    sessionId: 'sess1',
    update: {
      sessionUpdate: 'tool_call',
      toolCallId,
      status,
      title,
      kind: 'execute',
    },
  } as ToolCallUpdate;
}

function makeToolCallStatusUpdate(toolCallId: string, status: string, content?: any[]): ToolCallUpdateStatus {
  return {
    sessionId: 'sess1',
    update: {
      sessionUpdate: 'tool_call_update',
      toolCallId,
      status,
      content,
    },
  } as ToolCallUpdateStatus;
}

function makePlanUpdate(entries: any[]): PlanUpdate {
  return {
    sessionId: 'sess1',
    update: {
      sessionUpdate: 'plan',
      entries,
    },
  } as PlanUpdate;
}

describe('AcpAdapter', () => {
  let adapter: AcpAdapter;

  beforeEach(() => {
    uuidCounter = 0;
    adapter = new AcpAdapter('conv1', 'claude');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('agent_message_chunk', () => {
    it('should convert to IMessageText with shared msg_id', () => {
      const messages = adapter.convertSessionUpdate(makeChunkUpdate('Hello'));
      expect(messages).toHaveLength(1);
      expect(messages[0].type).toBe('text');
      expect(messages[0].content).toEqual({ content: 'Hello' });
      expect(messages[0].msg_id).toBeDefined();
      expect(messages[0].conversation_id).toBe('conv1');
      expect(messages[0].position).toBe('left');
    });

    it('should share msg_id across multiple chunks', () => {
      const msg1 = adapter.convertSessionUpdate(makeChunkUpdate('Hello '));
      const msg2 = adapter.convertSessionUpdate(makeChunkUpdate('World'));

      expect(msg1[0].msg_id).toBe(msg2[0].msg_id);
    });

    it('should return empty array for empty content', () => {
      const update = {
        sessionId: 'sess1',
        update: { sessionUpdate: 'agent_message_chunk', content: null },
      } as any;
      const messages = adapter.convertSessionUpdate(update);
      expect(messages).toHaveLength(0);
    });

    it('should return null for content without text', () => {
      const update = {
        sessionId: 'sess1',
        update: { sessionUpdate: 'agent_message_chunk', content: { text: '' } },
      } as any;
      const messages = adapter.convertSessionUpdate(update);
      expect(messages).toHaveLength(0);
    });
  });

  describe('resetMessageTracking', () => {
    it('should assign new msg_id after reset', () => {
      const msg1 = adapter.convertSessionUpdate(makeChunkUpdate('A'));
      const firstMsgId = msg1[0].msg_id;

      adapter.resetMessageTracking();

      const msg2 = adapter.convertSessionUpdate(makeChunkUpdate('B'));
      expect(msg2[0].msg_id).not.toBe(firstMsgId);
    });
  });

  describe('agent_thought_chunk', () => {
    it('should convert to tips message with no msg_id', () => {
      const messages = adapter.convertSessionUpdate(makeThoughtUpdate('Thinking...'));
      expect(messages).toHaveLength(1);
      expect(messages[0].type).toBe('tips');
      expect(messages[0].content).toEqual({ content: 'Thinking...', type: 'warning' });
      expect(messages[0].msg_id).toBeUndefined();
      expect(messages[0].position).toBe('center');
    });

    it('should reset message tracking after thought chunk', () => {
      const chunk1 = adapter.convertSessionUpdate(makeChunkUpdate('Before'));
      const msgIdBefore = chunk1[0].msg_id;

      adapter.convertSessionUpdate(makeThoughtUpdate('Thinking'));

      const chunk2 = adapter.convertSessionUpdate(makeChunkUpdate('After'));
      expect(chunk2[0].msg_id).not.toBe(msgIdBefore);
    });

    it('should return empty for empty thought content', () => {
      const update = {
        sessionId: 'sess1',
        update: { sessionUpdate: 'agent_thought_chunk', content: null },
      } as any;
      const messages = adapter.convertSessionUpdate(update);
      expect(messages).toHaveLength(0);
    });
  });

  describe('tool_call', () => {
    it('should convert to IMessageAcpToolCall with toolCallId as msg_id', () => {
      const messages = adapter.convertSessionUpdate(makeToolCallUpdate('tc1', 'Read file'));
      expect(messages).toHaveLength(1);
      expect(messages[0].type).toBe('acp_tool_call');
      expect(messages[0].msg_id).toBe('tc1');
      expect(messages[0].position).toBe('left');
    });

    it('should reset message tracking after tool_call', () => {
      const chunk1 = adapter.convertSessionUpdate(makeChunkUpdate('Before'));
      const msgIdBefore = chunk1[0].msg_id;

      adapter.convertSessionUpdate(makeToolCallUpdate('tc1', 'Read'));

      const chunk2 = adapter.convertSessionUpdate(makeChunkUpdate('After'));
      expect(chunk2[0].msg_id).not.toBe(msgIdBefore);
    });
  });

  describe('tool_call_update', () => {
    it('should merge update with existing tool call', () => {
      adapter.convertSessionUpdate(makeToolCallUpdate('tc1', 'Read file'));
      const messages = adapter.convertSessionUpdate(makeToolCallStatusUpdate('tc1', 'completed'));

      expect(messages).toHaveLength(1);
      expect(messages[0].type).toBe('acp_tool_call');
      expect(messages[0].msg_id).toBe('tc1');
      expect((messages[0].content as any).update.status).toBe('completed');
    });

    it('should return empty + console.warn for unknown toolCallId', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const messages = adapter.convertSessionUpdate(makeToolCallStatusUpdate('unknown_tc', 'completed'));

      expect(messages).toHaveLength(0);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('unknown_tc'));
    });

    it('should schedule cleanup for completed tool calls after 60s', () => {
      vi.useFakeTimers();

      adapter.convertSessionUpdate(makeToolCallUpdate('tc1', 'Read'));
      adapter.convertSessionUpdate(makeToolCallStatusUpdate('tc1', 'completed'));

      // Tool call still active immediately after
      const msg = adapter.convertSessionUpdate(makeToolCallStatusUpdate('tc1', 'completed'));
      expect(msg).toHaveLength(1); // still exists

      // After 60s, should be cleaned up
      vi.advanceTimersByTime(60000);

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const msg2 = adapter.convertSessionUpdate(makeToolCallStatusUpdate('tc1', 'completed'));
      expect(msg2).toHaveLength(0); // cleaned up

      vi.useRealTimers();
    });

    it('should schedule cleanup for failed tool calls after 60s', () => {
      vi.useFakeTimers();

      adapter.convertSessionUpdate(makeToolCallUpdate('tc1', 'Execute'));
      adapter.convertSessionUpdate(makeToolCallStatusUpdate('tc1', 'failed'));

      vi.advanceTimersByTime(60000);

      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const msg = adapter.convertSessionUpdate(makeToolCallStatusUpdate('tc1', 'failed'));
      expect(msg).toHaveLength(0);

      vi.useRealTimers();
    });
  });

  describe('plan', () => {
    it('should convert to IMessagePlan with fresh msg_id', () => {
      const entries = [{ title: 'Step 1', status: 'pending' }];
      const messages = adapter.convertSessionUpdate(makePlanUpdate(entries));

      expect(messages).toHaveLength(1);
      expect(messages[0].type).toBe('plan');
      expect(messages[0].msg_id).toBeDefined();
      expect((messages[0].content as any).sessionId).toBe('sess1');
      expect((messages[0].content as any).entries).toEqual(entries);
    });

    it('should return null for empty entries', () => {
      const messages = adapter.convertSessionUpdate(makePlanUpdate([]));
      expect(messages).toHaveLength(0);
    });

    it('should reset message tracking after plan', () => {
      const chunk1 = adapter.convertSessionUpdate(makeChunkUpdate('Before'));
      const msgIdBefore = chunk1[0].msg_id;

      adapter.convertSessionUpdate(makePlanUpdate([{ title: 'Step 1' }]));

      const chunk2 = adapter.convertSessionUpdate(makeChunkUpdate('After'));
      expect(chunk2[0].msg_id).not.toBe(msgIdBefore);
    });
  });

  describe('config_option_update', () => {
    it('should return empty array', () => {
      const update = {
        sessionId: 'sess1',
        update: { sessionUpdate: 'config_option_update', options: [] },
      } as any;
      const messages = adapter.convertSessionUpdate(update);
      expect(messages).toHaveLength(0);
    });
  });

  describe('available_commands_update', () => {
    it('should return empty array and reset message tracking', () => {
      const chunk1 = adapter.convertSessionUpdate(makeChunkUpdate('Before'));
      const msgIdBefore = chunk1[0].msg_id;

      const update = {
        sessionId: 'sess1',
        update: { sessionUpdate: 'available_commands_update', commands: [] },
      } as any;
      const messages = adapter.convertSessionUpdate(update);
      expect(messages).toHaveLength(0);

      const chunk2 = adapter.convertSessionUpdate(makeChunkUpdate('After'));
      expect(chunk2[0].msg_id).not.toBe(msgIdBefore);
    });
  });

  describe('unknown session update type', () => {
    it('should return empty array and console.warn', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const update = {
        sessionId: 'sess1',
        update: { sessionUpdate: 'totally_unknown_type' },
      } as any;
      const messages = adapter.convertSessionUpdate(update);
      expect(messages).toHaveLength(0);
      expect(warnSpy).toHaveBeenCalledWith('Unknown session update type:', 'totally_unknown_type');
    });
  });

  describe('getCurrentMessageId', () => {
    it('should return consistent id across calls', () => {
      const id1 = adapter.getCurrentMessageId();
      const id2 = adapter.getCurrentMessageId();
      expect(id1).toBe(id2);
    });
  });
});
