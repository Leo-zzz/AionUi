/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock uuid to return predictable values
vi.mock('@/common/utils', () => ({
  uuid: vi.fn(() => 'test-uuid'),
}));

import { transformMessage, composeMessage, joinPath } from '@/common/chatLib';
import type { TMessage, IMessageText, IMessageToolCall, IMessageToolGroup, IMessageCodexToolCall, IMessageAcpToolCall, IMessagePlan } from '@/common/chatLib';
import type { IResponseMessage } from '@/common/ipcBridge';

describe('chatLib', () => {
  // ==================== transformMessage ====================
  describe('transformMessage', () => {
    const baseMsg: IResponseMessage = {
      type: 'content',
      data: 'Hello world',
      msg_id: 'msg-1',
      conversation_id: 'conv-1',
    };

    it('should transform "content" type to IMessageText with position "left"', () => {
      const result = transformMessage(baseMsg);
      expect(result).toBeDefined();
      expect(result!.type).toBe('text');
      expect(result!.position).toBe('left');
      expect((result as IMessageText).content.content).toBe('Hello world');
    });

    it('should transform "user_content" type to IMessageText with position "right"', () => {
      const result = transformMessage({ ...baseMsg, type: 'user_content' });
      expect(result).toBeDefined();
      expect(result!.type).toBe('text');
      expect(result!.position).toBe('right');
      expect((result as IMessageText).content.content).toBe('Hello world');
    });

    it('should transform "error" type to IMessageTips with type "error"', () => {
      const result = transformMessage({ ...baseMsg, type: 'error', data: 'Something failed' });
      expect(result).toBeDefined();
      expect(result!.type).toBe('tips');
      expect(result!.position).toBe('center');
      expect((result as any).content.type).toBe('error');
      expect((result as any).content.content).toBe('Something failed');
    });

    it('should transform "tool_call" type to IMessageToolCall', () => {
      const data = { callId: 'c1', name: 'readFile', args: { path: '/foo' } };
      const result = transformMessage({ ...baseMsg, type: 'tool_call', data });
      expect(result).toBeDefined();
      expect(result!.type).toBe('tool_call');
      expect(result!.position).toBe('left');
      expect((result as any).content.callId).toBe('c1');
    });

    it('should transform "tool_group" type to IMessageToolGroup', () => {
      const data = [{ callId: 'c1', description: 'desc', name: 'tool1', renderOutputAsMarkdown: false, status: 'Success' }];
      const result = transformMessage({ ...baseMsg, type: 'tool_group', data });
      expect(result).toBeDefined();
      expect(result!.type).toBe('tool_group');
    });

    it('should transform "agent_status" type to IMessageAgentStatus', () => {
      const data = { backend: 'claude', status: 'connected' };
      const result = transformMessage({ ...baseMsg, type: 'agent_status', data });
      expect(result).toBeDefined();
      expect(result!.type).toBe('agent_status');
      expect(result!.position).toBe('center');
    });

    it('should transform "acp_permission" type', () => {
      const data = { action: 'exec', description: 'run ls' };
      const result = transformMessage({ ...baseMsg, type: 'acp_permission', data });
      expect(result).toBeDefined();
      expect(result!.type).toBe('acp_permission');
      expect(result!.position).toBe('left');
    });

    it('should transform "acp_tool_call" type', () => {
      const data = { update: { toolCallId: 'tc1' } };
      const result = transformMessage({ ...baseMsg, type: 'acp_tool_call', data });
      expect(result).toBeDefined();
      expect(result!.type).toBe('acp_tool_call');
    });

    it('should transform "codex_permission" type', () => {
      const data = { action: 'exec', description: 'run npm' };
      const result = transformMessage({ ...baseMsg, type: 'codex_permission', data });
      expect(result).toBeDefined();
      expect(result!.type).toBe('codex_permission');
    });

    it('should transform "codex_tool_call" type', () => {
      const data = { toolCallId: 'tc2', status: 'pending', kind: 'execute', subtype: 'generic' };
      const result = transformMessage({ ...baseMsg, type: 'codex_tool_call', data });
      expect(result).toBeDefined();
      expect(result!.type).toBe('codex_tool_call');
    });

    it('should transform "plan" type', () => {
      const data = { sessionId: 's1', entries: [] };
      const result = transformMessage({ ...baseMsg, type: 'plan', data });
      expect(result).toBeDefined();
      expect(result!.type).toBe('plan');
    });

    it('should preserve cronMeta in rich content data', () => {
      const cronMeta = { source: 'cron' as const, cronJobId: 'j1', cronJobName: 'Daily', triggeredAt: 1000 };
      const data = { content: 'Scheduled message', cronMeta };
      const result = transformMessage({ ...baseMsg, type: 'content', data });
      expect(result).toBeDefined();
      expect((result as IMessageText).content.cronMeta).toEqual(cronMeta);
      expect((result as IMessageText).content.content).toBe('Scheduled message');
    });

    it('should return undefined for "start" type', () => {
      const result = transformMessage({ ...baseMsg, type: 'start' });
      expect(result).toBeUndefined();
    });

    it('should return undefined for "finish" type', () => {
      const result = transformMessage({ ...baseMsg, type: 'finish' });
      expect(result).toBeUndefined();
    });

    it('should return undefined for "thought" type', () => {
      const result = transformMessage({ ...baseMsg, type: 'thought' });
      expect(result).toBeUndefined();
    });

    it('should return undefined for "system" type', () => {
      const result = transformMessage({ ...baseMsg, type: 'system' });
      expect(result).toBeUndefined();
    });

    it('should return undefined for "available_commands" type', () => {
      const result = transformMessage({ ...baseMsg, type: 'available_commands' });
      expect(result).toBeUndefined();
    });

    it('should throw for unknown message type', () => {
      expect(() => transformMessage({ ...baseMsg, type: 'totally_unknown_type' })).toThrow('Unsupported message type');
    });
  });

  // ==================== composeMessage ====================
  describe('composeMessage', () => {
    const makeText = (id: string, msgId: string, text: string): IMessageText => ({
      id,
      type: 'text',
      msg_id: msgId,
      conversation_id: 'conv-1',
      position: 'left',
      content: { content: text },
    });

    const makeToolCall = (id: string, callId: string, name: string): IMessageToolCall => ({
      id,
      type: 'tool_call',
      msg_id: `msg-${id}`,
      conversation_id: 'conv-1',
      position: 'left',
      content: { callId, name, args: {} },
    });

    it('should return [message] when list is empty', () => {
      const msg = makeText('1', 'msg-1', 'Hello');
      const result = composeMessage(msg, []);
      expect(result).toHaveLength(1);
      expect((result[0] as IMessageText).content.content).toBe('Hello');
    });

    it('should return empty array when message is undefined and list is empty', () => {
      const result = composeMessage(undefined, undefined);
      expect(result).toEqual([]);
    });

    it('should return existing list when message is undefined', () => {
      const list = [makeText('1', 'msg-1', 'Hello')];
      const result = composeMessage(undefined, list);
      expect(result).toEqual(list);
    });

    it('should concatenate text content when msg_id matches last message', () => {
      const existing = makeText('1', 'msg-1', 'Hello');
      const incoming = makeText('2', 'msg-1', ' world');
      const result = composeMessage(incoming, [existing]);
      expect(result).toHaveLength(1);
      expect((result[0] as IMessageText).content.content).toBe('Hello world');
    });

    it('should push new message when msg_id differs', () => {
      const existing = makeText('1', 'msg-1', 'Hello');
      const incoming = makeText('2', 'msg-2', 'New message');
      const result = composeMessage(incoming, [existing]);
      expect(result).toHaveLength(2);
    });

    it('should push new message when type differs even with same msg_id', () => {
      const existing = makeText('1', 'msg-1', 'Hello');
      const incoming = makeToolCall('2', 'c1', 'readFile');
      incoming.msg_id = 'msg-1';
      const result = composeMessage(incoming, [existing]);
      expect(result).toHaveLength(2);
    });

    // tool_call merge
    it('should merge tool_call with same callId', () => {
      const existing = makeToolCall('1', 'call-1', 'readFile');
      const incoming: IMessageToolCall = {
        ...makeToolCall('2', 'call-1', 'readFile'),
        content: { callId: 'call-1', name: 'readFile', args: {}, status: 'success' },
      };
      const result = composeMessage(incoming, [existing]);
      expect(result).toHaveLength(1);
      expect((result[0] as IMessageToolCall).content.status).toBe('success');
    });

    it('should push new tool_call with different callId', () => {
      const existing = makeToolCall('1', 'call-1', 'readFile');
      const incoming = makeToolCall('2', 'call-2', 'writeFile');
      const result = composeMessage(incoming, [existing]);
      expect(result).toHaveLength(2);
    });

    // tool_group merge
    it('should merge tool_group with matching callId into existing group', () => {
      const existingGroup: IMessageToolGroup = {
        id: '1',
        type: 'tool_group',
        msg_id: 'msg-1',
        conversation_id: 'conv-1',
        content: [{ callId: 'c1', description: 'old', name: 'tool1', renderOutputAsMarkdown: false, status: 'Executing' }],
      };
      const incoming: IMessageToolGroup = {
        id: '2',
        type: 'tool_group',
        msg_id: 'msg-2',
        conversation_id: 'conv-1',
        content: [{ callId: 'c1', description: 'updated', name: 'tool1', renderOutputAsMarkdown: false, status: 'Success' }],
      };
      const result = composeMessage(incoming, [existingGroup]);
      expect(result).toHaveLength(1);
      expect((result[0] as IMessageToolGroup).content[0].status).toBe('Success');
    });

    it('should append new tool_group when callId does not match', () => {
      const existingGroup: IMessageToolGroup = {
        id: '1',
        type: 'tool_group',
        msg_id: 'msg-1',
        conversation_id: 'conv-1',
        content: [{ callId: 'c1', description: 'old', name: 'tool1', renderOutputAsMarkdown: false, status: 'Success' }],
      };
      const incoming: IMessageToolGroup = {
        id: '2',
        type: 'tool_group',
        msg_id: 'msg-2',
        conversation_id: 'conv-1',
        content: [{ callId: 'c2', description: 'new', name: 'tool2', renderOutputAsMarkdown: false, status: 'Executing' }],
      };
      const result = composeMessage(incoming, [existingGroup]);
      expect(result).toHaveLength(2);
    });

    it('should return unchanged list when tool_group has empty content', () => {
      const existing = [makeText('1', 'msg-1', 'Hello')];
      const incoming: IMessageToolGroup = {
        id: '2',
        type: 'tool_group',
        msg_id: 'msg-2',
        conversation_id: 'conv-1',
        content: [],
      };
      const result = composeMessage(incoming, existing);
      expect(result).toBe(existing);
    });

    // codex_tool_call merge
    it('should merge codex_tool_call with same toolCallId', () => {
      const existing: IMessageCodexToolCall = {
        id: '1',
        type: 'codex_tool_call',
        msg_id: 'msg-1',
        conversation_id: 'conv-1',
        position: 'left',
        content: { toolCallId: 'tc1', status: 'pending', kind: 'execute', subtype: 'generic' } as any,
      };
      const incoming: IMessageCodexToolCall = {
        id: '2',
        type: 'codex_tool_call',
        msg_id: 'msg-1',
        conversation_id: 'conv-1',
        position: 'left',
        content: { toolCallId: 'tc1', status: 'success', kind: 'execute', subtype: 'generic' } as any,
      };
      const result = composeMessage(incoming, [existing]);
      expect(result).toHaveLength(1);
      expect((result[0] as IMessageCodexToolCall).content.status).toBe('success');
    });

    it('should push new codex_tool_call with different toolCallId', () => {
      const existing: IMessageCodexToolCall = {
        id: '1',
        type: 'codex_tool_call',
        msg_id: 'msg-1',
        conversation_id: 'conv-1',
        position: 'left',
        content: { toolCallId: 'tc1', status: 'pending', kind: 'execute', subtype: 'generic' } as any,
      };
      const incoming: IMessageCodexToolCall = {
        id: '2',
        type: 'codex_tool_call',
        msg_id: 'msg-2',
        conversation_id: 'conv-1',
        position: 'left',
        content: { toolCallId: 'tc2', status: 'pending', kind: 'execute', subtype: 'generic' } as any,
      };
      const result = composeMessage(incoming, [existing]);
      expect(result).toHaveLength(2);
    });

    // acp_tool_call merge
    it('should merge acp_tool_call with same update.toolCallId', () => {
      const existing: IMessageAcpToolCall = {
        id: '1',
        type: 'acp_tool_call',
        msg_id: 'msg-1',
        conversation_id: 'conv-1',
        position: 'left',
        content: { update: { toolCallId: 'at1', name: 'tool1', status: 'running' } } as any,
      };
      const incoming: IMessageAcpToolCall = {
        id: '2',
        type: 'acp_tool_call',
        msg_id: 'msg-1',
        conversation_id: 'conv-1',
        position: 'left',
        content: { update: { toolCallId: 'at1', name: 'tool1', status: 'done' } } as any,
      };
      const result = composeMessage(incoming, [existing]);
      expect(result).toHaveLength(1);
    });

    it('should push new acp_tool_call with different update.toolCallId', () => {
      const existing: IMessageAcpToolCall = {
        id: '1',
        type: 'acp_tool_call',
        msg_id: 'msg-1',
        conversation_id: 'conv-1',
        position: 'left',
        content: { update: { toolCallId: 'at1', name: 'tool1', status: 'running' } } as any,
      };
      const incoming: IMessageAcpToolCall = {
        id: '2',
        type: 'acp_tool_call',
        msg_id: 'msg-2',
        conversation_id: 'conv-1',
        position: 'left',
        content: { update: { toolCallId: 'at2', name: 'tool2', status: 'running' } } as any,
      };
      const result = composeMessage(incoming, [existing]);
      expect(result).toHaveLength(2);
    });

    // plan merge
    it('should merge plan with same sessionId', () => {
      const existing: IMessagePlan = {
        id: '1',
        type: 'plan',
        msg_id: 'msg-1',
        conversation_id: 'conv-1',
        position: 'left',
        content: { sessionId: 's1', entries: [{ title: 'step1' }] } as any,
      };
      const incoming: IMessagePlan = {
        id: '2',
        type: 'plan',
        msg_id: 'msg-1',
        conversation_id: 'conv-1',
        position: 'left',
        content: { sessionId: 's1', entries: [{ title: 'step1' }, { title: 'step2' }] } as any,
      };
      const result = composeMessage(incoming, [existing]);
      expect(result).toHaveLength(1);
      expect((result[0] as IMessagePlan).content.entries).toHaveLength(2);
    });

    it('should push new plan with different sessionId', () => {
      const existing: IMessagePlan = {
        id: '1',
        type: 'plan',
        msg_id: 'msg-1',
        conversation_id: 'conv-1',
        position: 'left',
        content: { sessionId: 's1', entries: [] } as any,
      };
      const incoming: IMessagePlan = {
        id: '2',
        type: 'plan',
        msg_id: 'msg-2',
        conversation_id: 'conv-1',
        position: 'left',
        content: { sessionId: 's2', entries: [] } as any,
      };
      const result = composeMessage(incoming, [existing]);
      expect(result).toHaveLength(2);
    });

    // messageHandler callback
    it('should call messageHandler with "insert" for new messages', () => {
      const handler = vi.fn();
      const msg = makeText('1', 'msg-1', 'Hello');
      composeMessage(msg, [], handler);
      expect(handler).toHaveBeenCalledWith('insert', msg);
    });

    it('should call messageHandler with "update" for merged messages', () => {
      const handler = vi.fn();
      const existing = makeText('1', 'msg-1', 'Hello');
      const incoming = makeText('2', 'msg-1', ' world');
      composeMessage(incoming, [existing], handler);
      expect(handler).toHaveBeenCalledWith('update', expect.objectContaining({ type: 'text' }));
    });
  });

  // ==================== joinPath ====================
  describe('joinPath', () => {
    it('should join basic paths', () => {
      expect(joinPath('/home/user', 'docs/file.txt')).toBe('/home/user/docs/file.txt');
    });

    it('should resolve ../ within relative path segments', () => {
      // joinPath only resolves .. within the relative path, not against the base
      expect(joinPath('/home/user', 'subdir/../file.txt')).toBe('/home/user/file.txt');
    });

    it('should resolve multiple ../ within relative path segments', () => {
      expect(joinPath('/home/user', 'a/b/../../file.txt')).toBe('/home/user/file.txt');
    });

    it('should normalize Windows backslashes to forward slashes', () => {
      expect(joinPath('C:\\Users\\user', 'docs\\file.txt')).toBe('C:/Users/user/docs/file.txt');
    });

    it('should handle trailing slash on base path', () => {
      expect(joinPath('/home/user/', 'file.txt')).toBe('/home/user/file.txt');
    });

    it('should skip . segments in relative path', () => {
      expect(joinPath('/home/user', './docs/file.txt')).toBe('/home/user/docs/file.txt');
    });

    it('should handle empty relative path parts', () => {
      expect(joinPath('/home/user', 'docs//file.txt')).toBe('/home/user/docs/file.txt');
    });

    it('should handle ../ that exceeds relative parts depth', () => {
      // When .. appears with no relative parts to pop, it becomes a no-op
      expect(joinPath('/home/user', '../file.txt')).toBe('/home/user/file.txt');
    });
  });
});
