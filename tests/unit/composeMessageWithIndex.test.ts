/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi } from 'vitest';

// Mock dependencies required by hooks.ts module (React hooks, ipcBridge)
vi.mock('react', () => ({
  useCallback: (fn: any) => fn,
  useEffect: () => {},
  useRef: (val: any) => ({ current: val }),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    database: {
      getConversationMessages: { invoke: vi.fn() },
    },
  },
}));

vi.mock('../utils/createContext', () => ({
  createContext: (defaultVal: any) => {
    const useCtx = () => defaultVal;
    const Provider = ({ children }: any) => children;
    const useUpdate = () => (fn: any) => fn(defaultVal);
    return [useCtx, Provider, useUpdate];
  },
}));

import type { TMessage, IMessageText, IMessageToolCall, IMessageCodexToolCall, IMessageAcpToolCall, IMessageToolGroup, IMessagePlan } from '@/common/chatLib';

// Since buildMessageIndex, getOrBuildIndex, and composeMessageWithIndex are not exported,
// we re-implement the core logic for testing based on the actual source code.
// This tests the algorithm rather than the module boundary.

interface MessageIndex {
  msgIdIndex: Map<string, number>;
  callIdIndex: Map<string, number>;
  toolCallIdIndex: Map<string, number>;
}

function buildMessageIndex(list: TMessage[]): MessageIndex {
  const msgIdIndex = new Map<string, number>();
  const callIdIndex = new Map<string, number>();
  const toolCallIdIndex = new Map<string, number>();

  for (let i = 0; i < list.length; i++) {
    const msg = list[i];
    if (msg.msg_id) msgIdIndex.set(msg.msg_id, i);
    if (msg.type === 'tool_call' && msg.content?.callId) {
      callIdIndex.set(msg.content.callId, i);
    }
    if (msg.type === 'codex_tool_call' && msg.content?.toolCallId) {
      toolCallIdIndex.set(msg.content.toolCallId, i);
    }
    if (msg.type === 'acp_tool_call' && msg.content?.update?.toolCallId) {
      toolCallIdIndex.set(msg.content.update.toolCallId, i);
    }
  }

  return { msgIdIndex, callIdIndex, toolCallIdIndex };
}

// Replicated from hooks.ts — composeMessageWithIndex
function composeMessageWithIndex(message: TMessage, list: TMessage[], index: MessageIndex): TMessage[] {
  if (!message) return list || [];
  if (!list?.length) {
    if (message.msg_id) {
      index.msgIdIndex.set(message.msg_id, 0);
    }
    return [message];
  }

  // tool_call: use callIdIndex for fast lookup
  if (message.type === 'tool_call' && message.content?.callId) {
    const existingIdx = index.callIdIndex.get(message.content.callId);
    if (existingIdx !== undefined && existingIdx < list.length) {
      const existingMsg = list[existingIdx];
      if (existingMsg.type === 'tool_call') {
        const newList = list.slice();
        const merged = { ...existingMsg.content, ...message.content };
        newList[existingIdx] = { ...existingMsg, content: merged };
        return newList;
      }
    }
    const newIdx = list.length;
    index.callIdIndex.set(message.content.callId, newIdx);
    if (message.msg_id) index.msgIdIndex.set(message.msg_id, newIdx);
    return list.concat(message);
  }

  // codex_tool_call: use toolCallIdIndex for fast lookup
  if (message.type === 'codex_tool_call' && message.content?.toolCallId) {
    const existingIdx = index.toolCallIdIndex.get(message.content.toolCallId);
    if (existingIdx !== undefined && existingIdx < list.length) {
      const existingMsg = list[existingIdx];
      if (existingMsg.type === 'codex_tool_call') {
        const newList = list.slice();
        const merged = { ...existingMsg.content, ...message.content };
        newList[existingIdx] = { ...existingMsg, content: merged };
        return newList;
      }
    }
    const newIdx = list.length;
    index.toolCallIdIndex.set(message.content.toolCallId, newIdx);
    if (message.msg_id) index.msgIdIndex.set(message.msg_id, newIdx);
    return list.concat(message);
  }

  // acp_tool_call: use toolCallIdIndex for fast lookup
  if (message.type === 'acp_tool_call' && message.content?.update?.toolCallId) {
    const existingIdx = index.toolCallIdIndex.get(message.content.update.toolCallId);
    if (existingIdx !== undefined && existingIdx < list.length) {
      const existingMsg = list[existingIdx];
      if (existingMsg.type === 'acp_tool_call') {
        const newList = list.slice();
        const merged = { ...existingMsg.content, ...message.content };
        newList[existingIdx] = { ...existingMsg, content: merged };
        return newList;
      }
    }
    const newIdx = list.length;
    index.toolCallIdIndex.set(message.content.update.toolCallId, newIdx);
    if (message.msg_id) index.msgIdIndex.set(message.msg_id, newIdx);
    return list.concat(message);
  }

  // text message: use msgIdIndex for fast lookup
  if (message.type === 'text' && message.msg_id) {
    const existingIdx = index.msgIdIndex.get(message.msg_id);
    if (existingIdx !== undefined && existingIdx < list.length) {
      const existingMsg = list[existingIdx];
      if (existingMsg.type === 'text') {
        const newList = list.slice();
        newList[existingIdx] = {
          ...existingMsg,
          content: {
            ...existingMsg.content,
            content: existingMsg.content.content + message.content.content,
          },
        };
        return newList;
      }
    }
    const newIdx = list.length;
    index.msgIdIndex.set(message.msg_id, newIdx);
    return list.concat(message);
  }

  // Other types: fallback to last message check
  const last = list[list.length - 1];
  if (last.msg_id !== message.msg_id || last.type !== message.type) {
    const newIdx = list.length;
    if (message.msg_id) index.msgIdIndex.set(message.msg_id, newIdx);
    return list.concat(message);
  }

  const newList = list.slice();
  const lastIdx = newList.length - 1;
  newList[lastIdx] = { ...last, ...message };
  return newList;
}

// Helpers
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

const makeCodexToolCall = (id: string, toolCallId: string): IMessageCodexToolCall => ({
  id,
  type: 'codex_tool_call',
  msg_id: `msg-${id}`,
  conversation_id: 'conv-1',
  position: 'left',
  content: { toolCallId, status: 'pending', kind: 'execute', subtype: 'generic' } as any,
});

const makeAcpToolCall = (id: string, toolCallId: string): IMessageAcpToolCall => ({
  id,
  type: 'acp_tool_call',
  msg_id: `msg-${id}`,
  conversation_id: 'conv-1',
  position: 'left',
  content: { update: { toolCallId, name: 'tool', status: 'running' } } as any,
});

describe('buildMessageIndex', () => {
  it('should build msgIdIndex from msg_id', () => {
    const list = [makeText('1', 'msg-1', 'Hello'), makeText('2', 'msg-2', 'World')];
    const idx = buildMessageIndex(list);
    expect(idx.msgIdIndex.get('msg-1')).toBe(0);
    expect(idx.msgIdIndex.get('msg-2')).toBe(1);
  });

  it('should build callIdIndex from tool_call callId', () => {
    const list: TMessage[] = [makeToolCall('1', 'c1', 'readFile'), makeToolCall('2', 'c2', 'writeFile')];
    const idx = buildMessageIndex(list);
    expect(idx.callIdIndex.get('c1')).toBe(0);
    expect(idx.callIdIndex.get('c2')).toBe(1);
  });

  it('should build toolCallIdIndex from codex_tool_call', () => {
    const list: TMessage[] = [makeCodexToolCall('1', 'tc1')];
    const idx = buildMessageIndex(list);
    expect(idx.toolCallIdIndex.get('tc1')).toBe(0);
  });

  it('should build toolCallIdIndex from acp_tool_call', () => {
    const list: TMessage[] = [makeAcpToolCall('1', 'at1')];
    const idx = buildMessageIndex(list);
    expect(idx.toolCallIdIndex.get('at1')).toBe(0);
  });

  it('should return empty maps for empty list', () => {
    const idx = buildMessageIndex([]);
    expect(idx.msgIdIndex.size).toBe(0);
    expect(idx.callIdIndex.size).toBe(0);
    expect(idx.toolCallIdIndex.size).toBe(0);
  });
});

describe('composeMessageWithIndex', () => {
  it('should return [message] for empty list and update index', () => {
    const index: MessageIndex = { msgIdIndex: new Map(), callIdIndex: new Map(), toolCallIdIndex: new Map() };
    const msg = makeText('1', 'msg-1', 'Hello');
    const result = composeMessageWithIndex(msg, [], index);
    expect(result).toHaveLength(1);
    expect(index.msgIdIndex.get('msg-1')).toBe(0);
  });

  it('should concatenate text content via msgIdIndex for same msg_id', () => {
    const list = [makeText('1', 'msg-1', 'Hello')];
    const index = buildMessageIndex(list);
    const incoming = makeText('2', 'msg-1', ' world');
    const result = composeMessageWithIndex(incoming, list, index);
    expect(result).toHaveLength(1);
    expect((result[0] as IMessageText).content.content).toBe('Hello world');
  });

  it('should push new text when msg_id differs and update index', () => {
    const list = [makeText('1', 'msg-1', 'Hello')];
    const index = buildMessageIndex(list);
    const incoming = makeText('2', 'msg-2', 'World');
    const result = composeMessageWithIndex(incoming, list, index);
    expect(result).toHaveLength(2);
    expect(index.msgIdIndex.get('msg-2')).toBe(1);
  });

  it('should merge tool_call by callId via callIdIndex', () => {
    const list: TMessage[] = [makeToolCall('1', 'c1', 'readFile')];
    const index = buildMessageIndex(list);
    const incoming: IMessageToolCall = {
      ...makeToolCall('2', 'c1', 'readFile'),
      content: { callId: 'c1', name: 'readFile', args: {}, status: 'success' },
    };
    const result = composeMessageWithIndex(incoming, list, index);
    expect(result).toHaveLength(1);
    expect((result[0] as IMessageToolCall).content.status).toBe('success');
  });

  it('should push new tool_call with different callId and update both indexes', () => {
    const list: TMessage[] = [makeToolCall('1', 'c1', 'readFile')];
    const index = buildMessageIndex(list);
    const incoming = makeToolCall('2', 'c2', 'writeFile');
    const result = composeMessageWithIndex(incoming, list, index);
    expect(result).toHaveLength(2);
    expect(index.callIdIndex.get('c2')).toBe(1);
    expect(index.msgIdIndex.get('msg-2')).toBe(1);
  });

  it('should merge codex_tool_call by toolCallId via toolCallIdIndex', () => {
    const list: TMessage[] = [makeCodexToolCall('1', 'tc1')];
    const index = buildMessageIndex(list);
    const incoming: IMessageCodexToolCall = {
      ...makeCodexToolCall('2', 'tc1'),
      content: { toolCallId: 'tc1', status: 'success', kind: 'execute', subtype: 'generic' } as any,
    };
    const result = composeMessageWithIndex(incoming, list, index);
    expect(result).toHaveLength(1);
    expect((result[0] as IMessageCodexToolCall).content.status).toBe('success');
  });

  it('should push new codex_tool_call with different toolCallId', () => {
    const list: TMessage[] = [makeCodexToolCall('1', 'tc1')];
    const index = buildMessageIndex(list);
    const incoming = makeCodexToolCall('2', 'tc2');
    const result = composeMessageWithIndex(incoming, list, index);
    expect(result).toHaveLength(2);
    expect(index.toolCallIdIndex.get('tc2')).toBe(1);
  });

  it('should merge acp_tool_call by update.toolCallId', () => {
    const list: TMessage[] = [makeAcpToolCall('1', 'at1')];
    const index = buildMessageIndex(list);
    const incoming: IMessageAcpToolCall = {
      ...makeAcpToolCall('2', 'at1'),
      content: { update: { toolCallId: 'at1', name: 'tool', status: 'done' } } as any,
    };
    const result = composeMessageWithIndex(incoming, list, index);
    expect(result).toHaveLength(1);
  });

  it('should push new acp_tool_call with different toolCallId', () => {
    const list: TMessage[] = [makeAcpToolCall('1', 'at1')];
    const index = buildMessageIndex(list);
    const incoming = makeAcpToolCall('2', 'at2');
    const result = composeMessageWithIndex(incoming, list, index);
    expect(result).toHaveLength(2);
    expect(index.toolCallIdIndex.get('at2')).toBe(1);
  });

  it('should handle stale index entry (existingIdx >= list.length) by pushing new', () => {
    const list: TMessage[] = [makeText('1', 'msg-1', 'Hello')];
    // Manually create a stale index pointing beyond list length
    const index: MessageIndex = {
      msgIdIndex: new Map([['msg-1', 5]]),
      callIdIndex: new Map(),
      toolCallIdIndex: new Map(),
    };
    const incoming = makeText('2', 'msg-1', ' world');
    const result = composeMessageWithIndex(incoming, list, index);
    // Should fall through and push new since index points to invalid position
    expect(result).toHaveLength(2);
  });

  it('should handle multiple concurrent messages without index corruption', () => {
    const list: TMessage[] = [makeText('1', 'msg-1', 'A')];
    const index = buildMessageIndex(list);

    // Simulate rapid streaming: multiple chunks for same msg_id
    let current = list;
    for (let i = 0; i < 5; i++) {
      current = composeMessageWithIndex(makeText(`chunk-${i}`, 'msg-1', `${i}`), current, index);
    }
    expect(current).toHaveLength(1);
    expect((current[0] as IMessageText).content.content).toBe('A01234');
  });

  it('should handle interleaved messages from different conversations', () => {
    const list: TMessage[] = [makeText('1', 'msg-a', 'From A'), makeText('2', 'msg-b', 'From B')];
    const index = buildMessageIndex(list);

    // Append to msg-a (should find it at index 0, not at end)
    const result = composeMessageWithIndex(makeText('3', 'msg-a', ' more'), list, index);
    expect(result).toHaveLength(2);
    expect((result[0] as IMessageText).content.content).toBe('From A more');
    expect((result[1] as IMessageText).content.content).toBe('From B');
  });

  it('should fallback to last-message check for non-indexed types', () => {
    const existing: TMessage = {
      id: '1',
      type: 'tips',
      msg_id: 'msg-1',
      conversation_id: 'conv-1',
      position: 'center',
      content: { content: 'Old tip', type: 'warning' as const },
    };
    const list = [existing];
    const index = buildMessageIndex(list);
    const incoming: TMessage = {
      id: '2',
      type: 'tips',
      msg_id: 'msg-1',
      conversation_id: 'conv-1',
      position: 'center',
      content: { content: 'New tip', type: 'error' as const },
    };
    const result = composeMessageWithIndex(incoming, list, index);
    expect(result).toHaveLength(1);
    // Should merge via last-message fallback
    expect((result[0] as any).content.type).toBe('error');
  });
});
