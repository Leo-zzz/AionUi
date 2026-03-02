/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the database module before importing StreamingMessageBuffer
const mockGetMessageByMsgId = vi.fn();
const mockInsertMessage = vi.fn();
const mockUpdateMessage = vi.fn();

vi.mock('@/process/database/index', () => ({
  getDatabase: () => ({
    getMessageByMsgId: mockGetMessageByMsgId,
    insertMessage: mockInsertMessage,
    updateMessage: mockUpdateMessage,
  }),
}));

import { StreamingMessageBuffer } from '@/process/database/StreamingMessageBuffer';

describe('StreamingMessageBuffer', () => {
  let buffer: StreamingMessageBuffer;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();

    // Default: message does not exist in DB (insert path)
    mockGetMessageByMsgId.mockReturnValue({ success: true, data: null });
    mockInsertMessage.mockReturnValue({ success: true });
    mockUpdateMessage.mockReturnValue({ success: true });

    buffer = new StreamingMessageBuffer();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('accumulate mode', () => {
    it('should concatenate chunks in accumulate mode', () => {
      buffer.append('id1', 'msg1', 'conv1', 'Hello ', 'accumulate');
      buffer.append('id1', 'msg1', 'conv1', 'World', 'accumulate');

      // Advance timer to trigger flush
      vi.advanceTimersByTime(300);

      expect(mockInsertMessage).toHaveBeenCalled();
      const insertedMessage = mockInsertMessage.mock.calls[0][0];
      expect(insertedMessage.content.content).toBe('Hello World');
    });
  });

  describe('replace mode', () => {
    it('should replace content in replace mode', () => {
      buffer.append('id1', 'msg1', 'conv1', 'First', 'replace');
      buffer.append('id1', 'msg1', 'conv1', 'Second', 'replace');

      vi.advanceTimersByTime(300);

      expect(mockInsertMessage).toHaveBeenCalled();
      const insertedMessage = mockInsertMessage.mock.calls[0][0];
      expect(insertedMessage.content.content).toBe('Second');
    });
  });

  describe('concurrent messages', () => {
    it('should not interfere between two messageIds with different modes', () => {
      buffer.append('id1', 'msg1', 'conv1', 'A', 'accumulate');
      buffer.append('id2', 'msg2', 'conv1', 'X', 'replace');
      buffer.append('id1', 'msg1', 'conv1', 'B', 'accumulate');
      buffer.append('id2', 'msg2', 'conv1', 'Y', 'replace');

      vi.advanceTimersByTime(300);

      // Both should flush
      expect(mockInsertMessage).toHaveBeenCalledTimes(2);
      const calls = mockInsertMessage.mock.calls.map((c: any) => c[0]);
      const msg1 = calls.find((m: any) => m.msg_id === 'msg1');
      const msg2 = calls.find((m: any) => m.msg_id === 'msg2');
      expect(msg1.content.content).toBe('AB');
      expect(msg2.content.content).toBe('Y');
    });
  });

  describe('batch flush', () => {
    it('should flush immediately at batch boundary (20th chunk)', () => {
      for (let i = 0; i < 20; i++) {
        buffer.append('id1', 'msg1', 'conv1', `chunk${i}`, 'accumulate');
      }

      // Should have flushed without needing timer advancement
      // The 20th chunk triggers immediate flush
      expect(mockInsertMessage).toHaveBeenCalled();
    });
  });

  describe('timer-based flush', () => {
    it('should flush after UPDATE_INTERVAL (300ms)', () => {
      buffer.append('id1', 'msg1', 'conv1', 'chunk', 'accumulate');

      // Not flushed yet
      expect(mockInsertMessage).not.toHaveBeenCalled();

      // Advance past interval
      vi.advanceTimersByTime(300);

      expect(mockInsertMessage).toHaveBeenCalledTimes(1);
    });

    it('should cancel timer on rapid appends', () => {
      buffer.append('id1', 'msg1', 'conv1', 'A', 'accumulate');
      vi.advanceTimersByTime(100);
      buffer.append('id1', 'msg1', 'conv1', 'B', 'accumulate');

      // First timer was cancelled, new timer set for another 300ms from t=100
      // Need to advance to t=400 (300ms after second append) to trigger flush
      vi.advanceTimersByTime(300);

      // Only 1 flush should have happened
      expect(mockInsertMessage).toHaveBeenCalledTimes(1);
      const msg = mockInsertMessage.mock.calls[0][0];
      expect(msg.content.content).toBe('AB');
    });
  });

  describe('flushBuffer paths', () => {
    it('should use insert path for new message', () => {
      mockGetMessageByMsgId.mockReturnValue({ success: true, data: null });
      buffer.append('id1', 'msg1', 'conv1', 'hello', 'accumulate');
      vi.advanceTimersByTime(300);

      expect(mockInsertMessage).toHaveBeenCalledTimes(1);
      expect(mockUpdateMessage).not.toHaveBeenCalled();
    });

    it('should use update path for existing message', () => {
      mockGetMessageByMsgId.mockReturnValue({
        success: true,
        data: { id: 'existing_id', msg_id: 'msg1', type: 'text' },
      });

      buffer.append('id1', 'msg1', 'conv1', 'updated content', 'accumulate');
      vi.advanceTimersByTime(300);

      expect(mockUpdateMessage).toHaveBeenCalledTimes(1);
      expect(mockInsertMessage).not.toHaveBeenCalled();
    });

    it('should not remove buffer on flush error (retry possible)', () => {
      mockGetMessageByMsgId.mockImplementation(() => {
        throw new Error('DB error');
      });

      buffer.append('id1', 'msg1', 'conv1', 'hello', 'accumulate');
      vi.advanceTimersByTime(300);

      // Error logged but buffer not removed - can retry
      // Append again and trigger another flush
      mockGetMessageByMsgId.mockReturnValue({ success: true, data: null });
      buffer.append('id1', 'msg1', 'conv1', ' world', 'accumulate');
      vi.advanceTimersByTime(300);

      expect(mockInsertMessage).toHaveBeenCalledTimes(1);
      expect(mockInsertMessage.mock.calls[0][0].content.content).toBe('hello world');
    });
  });

  describe('custom config', () => {
    it('should respect custom updateInterval', () => {
      const customBuffer = new StreamingMessageBuffer({ updateInterval: 100 });
      customBuffer.append('id1', 'msg1', 'conv1', 'hello', 'accumulate');

      vi.advanceTimersByTime(100);
      expect(mockInsertMessage).toHaveBeenCalledTimes(1);
    });

    it('should respect custom chunkBatchSize', () => {
      const customBuffer = new StreamingMessageBuffer({ chunkBatchSize: 5 });

      for (let i = 0; i < 5; i++) {
        customBuffer.append('id1', 'msg1', 'conv1', `c${i}`, 'accumulate');
      }

      // Should flush at 5th chunk
      expect(mockInsertMessage).toHaveBeenCalled();
    });
  });

  describe('message format', () => {
    it('should create TMessage with correct structure', () => {
      buffer.append('id1', 'msg1', 'conv1', 'test content', 'accumulate');
      vi.advanceTimersByTime(300);

      const msg = mockInsertMessage.mock.calls[0][0];
      expect(msg.id).toBe('id1');
      expect(msg.msg_id).toBe('msg1');
      expect(msg.conversation_id).toBe('conv1');
      expect(msg.type).toBe('text');
      expect(msg.content).toEqual({ content: 'test content' });
      expect(msg.status).toBe('pending');
      expect(msg.position).toBe('left');
      expect(msg.createdAt).toBeGreaterThan(0);
    });
  });
});
