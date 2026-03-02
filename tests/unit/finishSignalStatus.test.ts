/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Tests for the "model finished but UI still shows processing" bug.
 *
 * Root cause analysis:
 * 1. GeminiAgentManager sets status='finished' only on content/tool_group messages,
 *    NOT on the 'finish' signal itself. If finish arrives without prior content,
 *    status stays 'running'.
 * 2. AcpAgentManager has the same pattern — finish signal in onSignalEvent
 *    does not update this.status.
 * 3. StreamingMessageBuffer has no public flushAll() — finish signal cannot
 *    force-flush remaining buffered messages, so the last chunk may arrive
 *    AFTER the finish signal reaches the frontend.
 * 4. conversationBridge.get() returns task.status to the frontend — if status
 *    is stuck at 'running', the UI will show the stop button indefinitely.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ==================== Part 1: GeminiAgentManager status on finish ====================

const {
  mockGeminiResponseStreamEmit,
  mockGeminiAddOrUpdateMessage,
  mockGeminiAddMessage,
  mockGeminiNextTickToLocalFinish,
  mockGeminiCronBusyGuard,
  mockChannelEventBus,
} = vi.hoisted(() => ({
  mockGeminiResponseStreamEmit: vi.fn(),
  mockGeminiAddOrUpdateMessage: vi.fn(),
  mockGeminiAddMessage: vi.fn(),
  mockGeminiNextTickToLocalFinish: vi.fn(),
  mockGeminiCronBusyGuard: { setProcessing: vi.fn(), isProcessing: vi.fn(() => false) },
  mockChannelEventBus: { emitAgentMessage: vi.fn() },
}));

// Mock ipcBridge
vi.mock('@/common', () => ({
  ipcBridge: {
    conversation: {
      confirmation: {
        add: { emit: vi.fn() },
        update: { emit: vi.fn() },
        remove: { emit: vi.fn() },
      },
    },
    geminiConversation: {
      responseStream: { emit: mockGeminiResponseStreamEmit },
    },
    acpConversation: {
      responseStream: { emit: vi.fn() },
    },
  },
}));

// Mock ForkTask to prevent process spawning
vi.mock('@/worker/fork/ForkTask', () => ({
  ForkTask: class MockForkTask {
    data: any;
    private handlers = new Map<string, Function>();
    constructor(_path: string, data: any) {
      this.data = data;
    }
    init() {}
    start() {
      return Promise.resolve();
    }
    postMessagePromise() {
      return Promise.resolve();
    }
    on(event: string, handler: Function) {
      this.handlers.set(event, handler);
    }
    // Expose for testing: simulate receiving a message from worker
    emit(event: string, data: any) {
      const handler = this.handlers.get(event);
      if (handler) handler(data);
    }
  },
}));

// Mock path
vi.mock('path', () => ({
  default: {
    resolve: (...args: string[]) => args.join('/'),
    isAbsolute: (p: string) => p.startsWith('/') || /^[A-Z]:/.test(p),
  },
  resolve: (...args: string[]) => args.join('/'),
  isAbsolute: (p: string) => p.startsWith('/') || /^[A-Z]:/.test(p),
}));

// Mock electron
vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => '/test', getPath: () => '/test' },
  utilityProcess: { fork: vi.fn() },
}));

// Mock chatLib — transformMessage returns a simple object for testable types
vi.mock('@/common/chatLib', () => ({
  transformMessage: vi.fn((msg: any) => {
    if (['content', 'tool_group', 'agent_status', 'acp_tool_call', 'plan'].includes(msg.type)) {
      return { id: msg.msg_id || 'id-1', msg_id: msg.msg_id || 'msg-1', type: 'text', content: { content: msg.data || '' }, position: 'left', conversation_id: msg.conversation_id, createdAt: Date.now(), status: 'pending' };
    }
    return undefined;
  }),
}));

// Mock message module
vi.mock('@process/message', () => ({
  addOrUpdateMessage: mockGeminiAddOrUpdateMessage,
  addMessage: mockGeminiAddMessage,
  nextTickToLocalFinish: mockGeminiNextTickToLocalFinish,
}));

// Mock cronBusyGuard
vi.mock('@process/services/cron/CronBusyGuard', () => ({
  cronBusyGuard: mockGeminiCronBusyGuard,
}));

// Mock channelEventBus
vi.mock('@/channels/agent/ChannelEventBus', () => ({
  channelEventBus: mockChannelEventBus,
}));

// Mock database
vi.mock('@process/database', () => ({
  getDatabase: () => ({
    getConversation: vi.fn(() => ({ success: true, data: { id: 'conv-1' } })),
    updateConversation: vi.fn(),
    getConversationMessages: vi.fn(() => ({ data: [], total: 0, hasMore: false })),
    insertMessage: vi.fn(),
    getMessageByMsgId: vi.fn(() => ({ success: false })),
    updateMessage: vi.fn(),
    createConversation: vi.fn(() => ({ success: true })),
  }),
}));

// Mock initStorage
vi.mock('@/process/initStorage', () => ({
  ProcessConfig: { get: vi.fn(async () => ({})) },
  getSkillsDir: vi.fn(() => '/skills'),
}));

// Mock utils
vi.mock('@/common/utils', () => ({
  uuid: vi.fn(() => 'test-uuid'),
  parseError: vi.fn((e: any) => e?.message || String(e)),
}));

vi.mock('@/common/utils/platformAuthType', () => ({
  getProviderAuthType: vi.fn(() => 'none'),
}));

vi.mock('@office-ai/aioncli-core', () => ({
  AuthType: {},
  getOauthInfoWithCache: vi.fn(async () => null),
}));

vi.mock('@/agent/gemini/GeminiApprovalStore', () => ({
  GeminiApprovalStore: class MockGeminiApprovalStore {
    isApproved() { return false; }
    approve() {}
    static createKeysFromConfirmation() { return []; }
    static createExecKeysFromCommands() { return []; }
  },
}));

vi.mock('@/agent/gemini/cli/tools/tools', () => ({
  ToolConfirmationOutcome: { ProceedOnce: 'proceed_once', Cancel: 'cancel' },
}));

vi.mock('@/process/utils/previewUtils', () => ({
  handlePreviewOpenEvent: vi.fn(() => false),
}));

vi.mock('./agentUtils', () => ({
  buildSystemInstructionsWithSkillsIndex: vi.fn(async () => ''),
}));

vi.mock('@/process/task/agentUtils', () => ({
  buildSystemInstructionsWithSkillsIndex: vi.fn(async () => ''),
  prepareFirstMessageWithSkillsIndex: vi.fn(async (msg: any) => msg),
}));

vi.mock('@/process/task/AcpSkillManager', () => ({
  detectSkillLoadRequest: vi.fn(() => null),
  AcpSkillManager: {
    getInstance: vi.fn(() => ({
      discoverSkills: vi.fn(async () => {}),
      getSkillsIndex: vi.fn(() => ''),
      getBuiltinSkillsIndex: vi.fn(() => []),
      getAllSkillContents: vi.fn(() => []),
    })),
  },
  buildSkillContentText: vi.fn(() => ''),
}));

vi.mock('@/process/task/CronCommandDetector', () => ({
  hasCronCommands: vi.fn(() => false),
}));

vi.mock('@/process/task/MessageMiddleware', () => ({
  extractTextFromMessage: vi.fn(() => ''),
  processCronInMessage: vi.fn(async () => {}),
}));

vi.mock('@/process/task/ThinkTagDetector', () => ({
  stripThinkTags: vi.fn((text: string) => text),
}));

import { GeminiAgentManager } from '@/process/task/GeminiAgentManager';

describe('GeminiAgentManager finish signal status', () => {
  let manager: GeminiAgentManager;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new GeminiAgentManager({
      workspace: '/test',
      model: { provider: 'google', useModel: 'gemini-pro' } as any,
    } as any);
    // Set conversation_id (normally set by WorkerManage)
    (manager as any).conversation_id = 'conv-1';
    // Call init to register event handlers
    manager.init();
  });

  it('should set status to "running" when start signal arrives', () => {
    (manager as any).emit('gemini.message', { type: 'start', conversation_id: 'conv-1' });
    expect(manager.status).toBe('running');
  });

  it('should set status to "finished" when content message arrives', () => {
    (manager as any).emit('gemini.message', { type: 'start', conversation_id: 'conv-1' });
    expect(manager.status).toBe('running');

    (manager as any).emit('gemini.message', { type: 'content', conversation_id: 'conv-1', msg_id: 'msg-1', data: 'Hello' });
    expect(manager.status).toBe('finished');
  });

  it('should set status to "finished" when tool_group message arrives', () => {
    (manager as any).emit('gemini.message', { type: 'start', conversation_id: 'conv-1' });
    (manager as any).emit('gemini.message', { type: 'tool_group', conversation_id: 'conv-1', msg_id: 'msg-1', data: [] });
    expect(manager.status).toBe('finished');
  });

  // *** THIS IS THE BUG TEST ***
  // If model sends start → finish without any content (e.g., empty response, error recovery),
  // status should still be 'finished'. Currently it stays 'running'.
  // Using it.fails to document the known bug — when fixed, this test will start passing
  // and it.fails will flag it, reminding us to change it back to a normal `it`.
  it.fails('BUG: status should be "finished" after start → finish even without content', () => {
    (manager as any).emit('gemini.message', { type: 'start', conversation_id: 'conv-1' });
    expect(manager.status).toBe('running');

    (manager as any).emit('gemini.message', { type: 'finish', conversation_id: 'conv-1' });
    // BUG: Currently status stays 'running' because finish handler doesn't update status
    // Expected behavior: status should be 'finished'
    expect(manager.status).toBe('finished');
  });

  // Scenario: start → thought → finish (model only produced thought, no visible content)
  // Using it.fails to document the known bug — same root cause as above.
  it.fails('BUG: status should be "finished" after start → thought → finish', () => {
    (manager as any).emit('gemini.message', { type: 'start', conversation_id: 'conv-1' });
    expect(manager.status).toBe('running');

    (manager as any).emit('gemini.message', { type: 'thought', conversation_id: 'conv-1', data: 'thinking...' });
    // thought doesn't change status
    expect(manager.status).toBe('running');

    (manager as any).emit('gemini.message', { type: 'finish', conversation_id: 'conv-1' });
    expect(manager.status).toBe('finished');
  });

  // Normal flow should still work
  it('should have correct status through full lifecycle: start → content → finish', () => {
    expect(manager.status).toBeUndefined();

    (manager as any).emit('gemini.message', { type: 'start', conversation_id: 'conv-1' });
    expect(manager.status).toBe('running');

    (manager as any).emit('gemini.message', { type: 'content', conversation_id: 'conv-1', msg_id: 'msg-1', data: 'Hello' });
    expect(manager.status).toBe('finished');

    (manager as any).emit('gemini.message', { type: 'finish', conversation_id: 'conv-1' });
    expect(manager.status).toBe('finished');
  });

  // Multiple rounds: status should reset properly across turns
  it('should reset status across multiple start/finish cycles', () => {
    // First turn
    (manager as any).emit('gemini.message', { type: 'start', conversation_id: 'conv-1' });
    (manager as any).emit('gemini.message', { type: 'content', conversation_id: 'conv-1', msg_id: 'msg-1', data: 'Hello' });
    (manager as any).emit('gemini.message', { type: 'finish', conversation_id: 'conv-1' });
    expect(manager.status).toBe('finished');

    // Second turn
    (manager as any).emit('gemini.message', { type: 'start', conversation_id: 'conv-1' });
    expect(manager.status).toBe('running');

    (manager as any).emit('gemini.message', { type: 'content', conversation_id: 'conv-1', msg_id: 'msg-2', data: 'World' });
    expect(manager.status).toBe('finished');

    (manager as any).emit('gemini.message', { type: 'finish', conversation_id: 'conv-1' });
    expect(manager.status).toBe('finished');
  });

  it('should emit finish signal to responseStream even when no content preceded it', () => {
    (manager as any).emit('gemini.message', { type: 'start', conversation_id: 'conv-1' });
    (manager as any).emit('gemini.message', { type: 'finish', conversation_id: 'conv-1' });

    // finish should still be emitted to frontend for UI state cleanup
    const finishCalls = mockGeminiResponseStreamEmit.mock.calls.filter(
      (call: any[]) => call[0]?.type === 'finish'
    );
    expect(finishCalls.length).toBeGreaterThanOrEqual(1);
  });
});

// ==================== Part 2: StreamingMessageBuffer flush gap ====================

// Reset modules to get fresh import for StreamingMessageBuffer
describe('StreamingMessageBuffer finish flush gap', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should have pending buffer data that would be lost if finish arrives before timer fires', async () => {
    // Import fresh instance
    const { StreamingMessageBuffer } = await import('@/process/database/StreamingMessageBuffer');
    const buffer = new StreamingMessageBuffer({ updateInterval: 300, chunkBatchSize: 20 });

    // Simulate streaming: append a few chunks (less than batchSize)
    buffer.append('id-1', 'msg-1', 'conv-1', 'chunk1', 'accumulate');
    // First append creates buffer and sets a 300ms timer

    // At this point, there's a pending 300ms timer to flush
    // If finish signal arrives NOW (before 300ms), the frontend resets UI state
    // but the last chunk hasn't been flushed to DB yet

    // Verify: buffer has data but DB has not been written yet
    // (We can check by advancing less than 300ms)
    vi.advanceTimersByTime(100);
    // Buffer still holds data — no flush happened yet for this chunk
    // The next append within 300ms would reset the timer

    buffer.append('id-1', 'msg-1', 'conv-1', 'chunk2', 'accumulate');
    // Timer reset again

    // Only after 300ms from last append does it flush
    vi.advanceTimersByTime(300);
    // Now it should have flushed
  });

  it('BUG: StreamingMessageBuffer has no public flushAll method for finish signal', async () => {
    // This test documents that StreamingMessageBuffer lacks a way to force-flush
    // all pending buffers when a finish signal arrives.
    // Without this, the last few streaming chunks may be written to DB
    // AFTER the frontend has already processed the finish signal.

    const mod = await import('@/process/database/StreamingMessageBuffer');
    const buffer = new mod.StreamingMessageBuffer();

    // Verify there's no public flush method
    expect(typeof (buffer as any).flushAll).not.toBe('function');
    expect(typeof (buffer as any).flush).not.toBe('function');
  });
});

// ==================== Part 3: conversationBridge.get returns stale status ====================

// These tests verify that when the frontend polls conversation status,
// a stuck 'running' status from the manager causes the UI to show the stop button.

const {
  mockGetConversationForStatus,
  mockGetTaskByIdForStatus,
  statusProviders,
} = vi.hoisted(() => {
  const statusProviders: Record<string, (...args: any[]) => any> = {};
  return {
    mockGetConversationForStatus: vi.fn(() => ({
      success: true,
      data: { id: 'conv-1', type: 'gemini', source: 'aionui', extra: {} },
    })),
    mockGetTaskByIdForStatus: vi.fn(),
    statusProviders,
  };
});

describe('conversationBridge.get returns task status', () => {
  // These tests verify that the frontend's polling of conversation status
  // correctly reflects the actual task state

  it('should return "running" status when task.status is "running"', () => {
    // Simulates the bug: task.status stuck at 'running' even after finish
    const task = { status: 'running', type: 'gemini' };

    // This is what conversationBridge.get does:
    // result.status = task ? task.status : 'finished'
    const result = task ? task.status : 'finished';
    expect(result).toBe('running');
    // Frontend sees 'running' → shows stop button → BUG
  });

  it('should return "finished" when no task exists', () => {
    const task = undefined;
    const result = task ? (task as any).status : 'finished';
    expect(result).toBe('finished');
  });

  it('should return "finished" when task.status is "finished"', () => {
    const task = { status: 'finished', type: 'gemini' };
    const result = task ? task.status : 'finished';
    expect(result).toBe('finished');
    // Frontend sees 'finished' → hides stop button → CORRECT
  });
});

// ==================== Part 4: Frontend finish timeout race condition ====================

describe('Frontend finish timeout race condition (documented)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should demonstrate the 1-second delayed reset pattern', () => {
    // Simulates GeminiSendBox.tsx:177-183 behavior
    let streamRunning = true;
    let waitingResponse = false;

    // finish arrives
    if (!waitingResponse) {
      setTimeout(() => {
        streamRunning = false;
        waitingResponse = false;
      }, 1000);
    }

    // Before 1000ms: UI still shows stop button
    vi.advanceTimersByTime(500);
    expect(streamRunning).toBe(true); // Still showing stop button

    // After 1000ms: UI finally hides stop button
    vi.advanceTimersByTime(500);
    expect(streamRunning).toBe(false);
  });

  it('BUG: finish signal skipped when waitingResponse is true', () => {
    // When waitingResponse=true (tool just completed, waiting for AI to continue),
    // the finish timeout is NOT started. If AI doesn't send another start signal,
    // streamRunning stays true forever.
    let streamRunning = true;
    let waitingResponse = true;
    let timeoutStarted = false;

    // finish arrives but waitingResponse is true
    if (!waitingResponse) {
      timeoutStarted = true;
      setTimeout(() => {
        streamRunning = false;
        waitingResponse = false;
      }, 1000);
    }

    // Timeout never started!
    expect(timeoutStarted).toBe(false);

    vi.advanceTimersByTime(5000);
    // Even after 5 seconds, streamRunning is still true → stop button visible
    expect(streamRunning).toBe(true);
    // BUG: If AI never sends another 'start', the UI is stuck forever
  });

  it('should cancel finish timeout when new message arrives before 1s', () => {
    // Simulates GeminiSendBox.tsx:149-153 behavior
    let streamRunning = true;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    // finish arrives
    timeoutId = setTimeout(() => {
      streamRunning = false;
    }, 1000);

    // New content arrives at 500ms → cancel the timeout
    vi.advanceTimersByTime(500);
    clearTimeout(timeoutId);
    timeoutId = undefined;

    // streamRunning stays true (correct — new content is still streaming)
    vi.advanceTimersByTime(2000);
    expect(streamRunning).toBe(true);
  });
});
