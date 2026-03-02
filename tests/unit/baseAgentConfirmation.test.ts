/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ==================== BaseAgentManager Mocks ====================

// Use vi.hoisted to define mock functions that are referenced in vi.mock factories
const { mockConfirmationAdd, mockConfirmationUpdate, mockConfirmationRemove } = vi.hoisted(() => ({
  mockConfirmationAdd: vi.fn(),
  mockConfirmationUpdate: vi.fn(),
  mockConfirmationRemove: vi.fn(),
}));

// Mock ipcBridge — BaseAgentManager imports from '../../common' which resolves to src/common
vi.mock('@/common', () => ({
  ipcBridge: {
    conversation: {
      confirmation: {
        add: { emit: mockConfirmationAdd },
        update: { emit: mockConfirmationUpdate },
        remove: { emit: mockConfirmationRemove },
      },
    },
  },
}));

// Mock ForkTask so we don't spawn real processes
vi.mock('@/worker/fork/ForkTask', () => ({
  ForkTask: class MockForkTask {
    data: any;
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
  },
}));

// Mock path
vi.mock('path', () => ({
  default: { resolve: (...args: string[]) => args.join('/') },
  resolve: (...args: string[]) => args.join('/'),
}));

// Mock electron (ForkTask imports from electron)
vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => '/test', getPath: () => '/test' },
  utilityProcess: { fork: vi.fn() },
}));

import BaseAgentManager from '@/process/task/BaseAgentManager';
import type { IConfirmation } from '@/common/chatLib';

// Create a concrete test subclass since BaseAgentManager is abstract-like
class TestAgentManager extends BaseAgentManager<{ workspace?: string; yoloMode?: boolean }> {
  constructor(yoloMode = false) {
    super('gemini', { workspace: '/test', yoloMode });
    this.conversation_id = 'conv-test';
  }

  // Expose protected methods for testing
  public testAddConfirmation(data: IConfirmation) {
    this.addConfirmation(data);
  }

  public testGetConfirmations() {
    return this.getConfirmations();
  }
}

describe('BaseAgentManager', () => {
  let agent: TestAgentManager;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    agent = new TestAgentManager(false);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('addConfirmation (normal mode)', () => {
    it('should add new confirmation to list and emit confirmation.add', () => {
      const confirmation: IConfirmation = {
        id: 'conf-1',
        callId: 'call-1',
        description: 'Allow read?',
        options: [{ label: 'Allow', value: 'allow' }],
      };

      agent.testAddConfirmation(confirmation);

      expect(agent.testGetConfirmations()).toHaveLength(1);
      expect(agent.testGetConfirmations()[0].id).toBe('conf-1');
      expect(mockConfirmationAdd).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'conf-1',
          conversation_id: 'conv-test',
        })
      );
    });

    it('should update existing confirmation with same id and emit confirmation.update', () => {
      const original: IConfirmation = {
        id: 'conf-1',
        callId: 'call-1',
        description: 'Allow read?',
        options: [{ label: 'Allow', value: 'allow' }],
      };
      agent.testAddConfirmation(original);

      const updated: IConfirmation = {
        id: 'conf-1',
        callId: 'call-1',
        description: 'Updated description',
        options: [
          { label: 'Allow', value: 'allow' },
          { label: 'Deny', value: 'deny' },
        ],
      };
      agent.testAddConfirmation(updated);

      expect(agent.testGetConfirmations()).toHaveLength(1);
      expect(agent.testGetConfirmations()[0].description).toBe('Updated description');
      expect(mockConfirmationUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'conf-1',
          description: 'Updated description',
        })
      );
    });
  });

  describe('addConfirmation (yoloMode)', () => {
    let yoloAgent: TestAgentManager;

    beforeEach(() => {
      yoloAgent = new TestAgentManager(true);
    });

    it('should auto-confirm first option after 50ms delay when options exist', () => {
      const confirmSpy = vi.spyOn(yoloAgent, 'confirm');
      const confirmation: IConfirmation = {
        id: 'conf-1',
        callId: 'call-1',
        description: 'Allow exec?',
        options: [
          { label: 'Allow once', value: 'proceed_once' },
          { label: 'Deny', value: 'deny' },
        ],
      };

      yoloAgent.testAddConfirmation(confirmation);

      // Should NOT be in the confirmations list (auto-confirmed path, no add)
      expect(yoloAgent.testGetConfirmations()).toHaveLength(0);
      // Should NOT have emitted add
      expect(mockConfirmationAdd).not.toHaveBeenCalled();

      // Advance timer to trigger auto-confirm
      vi.advanceTimersByTime(50);

      expect(confirmSpy).toHaveBeenCalledWith('conf-1', 'call-1', 'proceed_once');
    });

    it('should add confirmation normally when no options are available', () => {
      const confirmation: IConfirmation = {
        id: 'conf-1',
        callId: 'call-1',
        description: 'Manual confirmation needed',
        options: [],
      };

      yoloAgent.testAddConfirmation(confirmation);

      expect(yoloAgent.testGetConfirmations()).toHaveLength(1);
      expect(mockConfirmationAdd).toHaveBeenCalled();
    });
  });

  describe('confirm', () => {
    it('should remove matching confirmation by callId and emit confirmation.remove', () => {
      const confirmation: IConfirmation = {
        id: 'conf-1',
        callId: 'call-1',
        description: 'Allow?',
        options: [{ label: 'Allow', value: 'allow' }],
      };
      agent.testAddConfirmation(confirmation);
      expect(agent.testGetConfirmations()).toHaveLength(1);

      agent.confirm('msg-1', 'call-1', 'allow');

      expect(agent.testGetConfirmations()).toHaveLength(0);
      expect(mockConfirmationRemove).toHaveBeenCalledWith({
        conversation_id: 'conv-test',
        id: 'conf-1',
      });
    });

    it('should not error when callId does not match any confirmation', () => {
      agent.confirm('msg-1', 'nonexistent-call', 'allow');
      expect(agent.testGetConfirmations()).toHaveLength(0);
      expect(mockConfirmationRemove).not.toHaveBeenCalled();
    });

    it('should only remove the matching confirmation, not others', () => {
      agent.testAddConfirmation({
        id: 'conf-1',
        callId: 'call-1',
        description: 'First',
        options: [{ label: 'Ok', value: 'ok' }],
      });
      agent.testAddConfirmation({
        id: 'conf-2',
        callId: 'call-2',
        description: 'Second',
        options: [{ label: 'Ok', value: 'ok' }],
      });

      agent.confirm('msg-1', 'call-1', 'ok');

      expect(agent.testGetConfirmations()).toHaveLength(1);
      expect(agent.testGetConfirmations()[0].callId).toBe('call-2');
    });
  });

  describe('getConfirmations', () => {
    it('should return current confirmations list', () => {
      expect(agent.testGetConfirmations()).toEqual([]);

      agent.testAddConfirmation({
        id: 'conf-1',
        callId: 'call-1',
        description: 'Test',
        options: [],
      });

      expect(agent.testGetConfirmations()).toHaveLength(1);
    });
  });
});

// ==================== BasePlugin ====================

import { BasePlugin } from '@/channels/plugins/BasePlugin';
import type { IChannelPluginConfig, PluginStatus } from '@/channels/types';

// Create a concrete test subclass implementing abstract methods
class TestPlugin extends BasePlugin {
  readonly type = 'telegram' as any;
  public onInitializeFn = vi.fn(async () => {});
  public onStartFn = vi.fn(async () => {});
  public onStopFn = vi.fn(async () => {});

  protected async onInitialize(config: IChannelPluginConfig): Promise<void> {
    await this.onInitializeFn(config);
  }

  protected async onStart(): Promise<void> {
    await this.onStartFn();
  }

  protected async onStop(): Promise<void> {
    await this.onStopFn();
  }

  async sendMessage(_chatId: string, _message: any): Promise<string> {
    return 'msg-id';
  }

  async editMessage(): Promise<void> {}
  getActiveUserCount(): number {
    return 0;
  }
  getBotInfo() {
    return null;
  }

  // Expose protected methods for testing
  public testEmitMessage(message: any) {
    return this.emitMessage(message);
  }

  public getStatus(): PluginStatus {
    return this._status;
  }
}

describe('BasePlugin state machine', () => {
  let plugin: TestPlugin;
  const testConfig: IChannelPluginConfig = {
    id: 'plugin-1',
    type: 'telegram',
    name: 'Test Plugin',
    enabled: true,
    status: 'created',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    plugin = new TestPlugin();
  });

  it('should start in "created" status', () => {
    expect(plugin.status).toBe('created');
  });

  it('should transition created → initializing → ready on initialize()', async () => {
    await plugin.initialize(testConfig);
    expect(plugin.status).toBe('ready');
  });

  it('should transition ready → starting → running on start()', async () => {
    await plugin.initialize(testConfig);
    await plugin.start();
    expect(plugin.status).toBe('running');
  });

  it('should transition running → stopping → stopped on stop()', async () => {
    await plugin.initialize(testConfig);
    await plugin.start();
    await plugin.stop();
    expect(plugin.status).toBe('stopped');
  });

  it('should allow restart: stopped → starting → running', async () => {
    await plugin.initialize(testConfig);
    await plugin.start();
    await plugin.stop();
    expect(plugin.status).toBe('stopped');

    await plugin.start();
    expect(plugin.status).toBe('running');
  });

  it('should throw when start() called from "created" status', async () => {
    await expect(plugin.start()).rejects.toThrow('Cannot start plugin in status: created');
  });

  it('should throw when start() called from "initializing" status', async () => {
    // Manually force initializing state by making onInitialize hang
    plugin.onInitializeFn.mockImplementation(() => new Promise(() => {}));
    plugin.initialize(testConfig);

    await expect(plugin.start()).rejects.toThrow('Cannot start plugin in status: initializing');
  });

  it('should be a no-op when stop() called from "ready" status', async () => {
    await plugin.initialize(testConfig);
    await plugin.stop(); // Should not throw
    expect(plugin.status).toBe('ready'); // Status unchanged
  });

  it('should set status to "error" when onStart throws', async () => {
    plugin.onStartFn.mockRejectedValueOnce(new Error('Connection failed'));
    await plugin.initialize(testConfig);

    await expect(plugin.start()).rejects.toThrow('Connection failed');
    expect(plugin.status).toBe('error');
    expect(plugin.error).toBe('Connection failed');
  });

  it('should set status to "error" when onStop throws', async () => {
    plugin.onStopFn.mockRejectedValueOnce(new Error('Disconnect failed'));
    await plugin.initialize(testConfig);
    await plugin.start();

    await expect(plugin.stop()).rejects.toThrow('Disconnect failed');
    expect(plugin.status).toBe('error');
  });

  it('should set status to "error" when onInitialize throws', async () => {
    plugin.onInitializeFn.mockRejectedValueOnce(new Error('Config invalid'));

    await expect(plugin.initialize(testConfig)).rejects.toThrow('Config invalid');
    expect(plugin.status).toBe('error');
    expect(plugin.error).toBe('Config invalid');
  });

  describe('emitMessage', () => {
    it('should call messageHandler when registered', async () => {
      const handler = vi.fn(async () => {});
      plugin.onMessage(handler);

      const message = { platform: 'telegram', chatId: '123', text: 'Hello' };
      await plugin.testEmitMessage(message);

      expect(handler).toHaveBeenCalledWith(message);
    });

    it('should warn but not error when no handler registered', async () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const message = { platform: 'telegram', chatId: '123', text: 'Hello' };
      await plugin.testEmitMessage(message);

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('No message handler'));
      consoleSpy.mockRestore();
    });
  });

  describe('onConfirm handler', () => {
    it('should register confirm handler via onConfirm()', () => {
      const handler = vi.fn(async () => {});
      plugin.onConfirm(handler);
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('stop from error state', () => {
    it('should allow stop() from "error" state', async () => {
      plugin.onStartFn.mockRejectedValueOnce(new Error('fail'));
      await plugin.initialize(testConfig);
      await plugin.start().catch(() => {});
      expect(plugin.status).toBe('error');

      plugin.onStopFn.mockResolvedValueOnce(undefined);
      await plugin.stop();
      expect(plugin.status).toBe('stopped');
    });
  });
});
