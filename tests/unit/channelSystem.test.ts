/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { isEncryptionAvailable, encryptString, decryptString, encryptCredentials, decryptCredentials } from '@/channels/utils/credentialCrypto';

describe('credentialCrypto', () => {
  describe('isEncryptionAvailable', () => {
    it('should always return true', () => {
      expect(isEncryptionAvailable()).toBe(true);
    });
  });

  describe('encryptString / decryptString', () => {
    it('should round-trip a string', () => {
      const original = 'my-secret-token-12345';
      const encrypted = encryptString(original);
      const decrypted = decryptString(encrypted);
      expect(decrypted).toBe(original);
    });

    it('should produce b64: prefix', () => {
      const encrypted = encryptString('hello');
      expect(encrypted.startsWith('b64:')).toBe(true);
    });

    it('should return empty string for empty input (encrypt)', () => {
      expect(encryptString('')).toBe('');
    });

    it('should return empty string for empty input (decrypt)', () => {
      expect(decryptString('')).toBe('');
    });

    it('should decode plain: prefix', () => {
      expect(decryptString('plain:mytoken')).toBe('mytoken');
    });

    it('should decode enc: prefix as base64 (legacy)', () => {
      const base64 = Buffer.from('legacy-token', 'utf-8').toString('base64');
      const result = decryptString(`enc:${base64}`);
      expect(result).toBe('legacy-token');
    });

    it('should pass through unencoded values (no prefix, legacy)', () => {
      const result = decryptString('raw-unencoded-value');
      expect(result).toBe('raw-unencoded-value');
    });

    it('should handle unicode text', () => {
      const original = 'Unicode: ';
      const encrypted = encryptString(original);
      const decrypted = decryptString(encrypted);
      expect(decrypted).toBe(original);
    });
  });

  describe('encryptCredentials / decryptCredentials', () => {
    it('should round-trip credentials with token', () => {
      const creds = { token: 'bot123:secret' };
      const encrypted = encryptCredentials(creds);
      expect(encrypted).toBeDefined();
      expect(encrypted!.token).not.toBe('bot123:secret');
      expect(encrypted!.token!.startsWith('b64:')).toBe(true);

      const decrypted = decryptCredentials(encrypted);
      expect(decrypted!.token).toBe('bot123:secret');
    });

    it('should only touch the token field', () => {
      const creds = { token: 'secret', webhookUrl: 'https://example.com' } as any;
      const encrypted = encryptCredentials(creds);
      expect((encrypted as any).webhookUrl).toBe('https://example.com');
    });

    it('should return undefined for undefined input', () => {
      expect(encryptCredentials(undefined)).toBeUndefined();
      expect(decryptCredentials(undefined)).toBeUndefined();
    });

    it('should handle credentials without token', () => {
      const creds = { other: 'value' } as any;
      const encrypted = encryptCredentials(creds);
      expect(encrypted!.token).toBeUndefined();
    });
  });
});

// CronBusyGuard tests - imported separately since it's a different module
// We create fresh instances for isolation instead of using the singleton
describe('CronBusyGuard', () => {
  // Import the module to get the class behavior via the singleton
  // We'll use clear() for isolation between tests
  let guard: (typeof import('@/process/services/cron/CronBusyGuard'))['cronBusyGuard'];

  beforeEach(async () => {
    const mod = await import('@/process/services/cron/CronBusyGuard');
    guard = mod.cronBusyGuard;
    guard.clear();
  });

  afterEach(() => {
    guard.clear();
  });

  describe('isProcessing', () => {
    it('should return false by default', () => {
      expect(guard.isProcessing('conv1')).toBe(false);
    });
  });

  describe('setProcessing / isProcessing', () => {
    it('should round-trip processing state', () => {
      guard.setProcessing('conv1', true);
      expect(guard.isProcessing('conv1')).toBe(true);

      guard.setProcessing('conv1', false);
      expect(guard.isProcessing('conv1')).toBe(false);
    });

    it('should update lastActiveAt when setting to true', () => {
      guard.setProcessing('conv1', true);
      const lastActive = guard.getLastActiveAt('conv1');
      expect(lastActive).toBeGreaterThan(0);
    });
  });

  describe('getLastActiveAt', () => {
    it('should return undefined for unknown conversation', () => {
      expect(guard.getLastActiveAt('unknown')).toBeUndefined();
    });
  });

  describe('waitForIdle', () => {
    it('should resolve immediately when not processing', async () => {
      await expect(guard.waitForIdle('conv1')).resolves.toBeUndefined();
    });

    it('should throw on timeout when stuck processing', async () => {
      vi.useFakeTimers();
      guard.setProcessing('conv1', true);

      const promise = guard.waitForIdle('conv1', 3000);
      // Attach a no-op catch to prevent unhandled rejection warning
      promise.catch(() => {});

      // Advance past timeout using async version to properly resolve pending promises
      await vi.advanceTimersByTimeAsync(4000);

      await expect(promise).rejects.toThrow('Timeout waiting for conversation conv1 to be idle');
      vi.useRealTimers();
    });
  });

  describe('getAllStates', () => {
    it('should return a copy of states', () => {
      guard.setProcessing('conv1', true);
      const states = guard.getAllStates();
      expect(states.size).toBe(1);
      expect(states.get('conv1')?.isProcessing).toBe(true);

      // Modifying the copy should not affect the guard
      states.delete('conv1');
      expect(guard.isProcessing('conv1')).toBe(true);
    });
  });

  describe('cleanup', () => {
    it('should remove stale idle entries', () => {
      vi.useFakeTimers();
      guard.setProcessing('conv1', true);
      guard.setProcessing('conv1', false);

      // Advance time by 1ms so lastActiveAt is strictly in the past
      vi.advanceTimersByTime(1);

      // Cleanup with 0ms threshold should remove it
      guard.cleanup(0);
      expect(guard.getAllStates().size).toBe(0);
      vi.useRealTimers();
    });

    it('should not remove processing entries', () => {
      guard.setProcessing('conv1', true);
      guard.cleanup(0);
      expect(guard.isProcessing('conv1')).toBe(true);
    });
  });

  describe('remove', () => {
    it('should remove specific conversation', () => {
      guard.setProcessing('conv1', true);
      guard.setProcessing('conv2', true);
      guard.remove('conv1');
      expect(guard.isProcessing('conv1')).toBe(false);
      expect(guard.isProcessing('conv2')).toBe(true);
    });
  });

  describe('clear', () => {
    it('should empty all states', () => {
      guard.setProcessing('conv1', true);
      guard.setProcessing('conv2', true);
      guard.clear();
      expect(guard.getAllStates().size).toBe(0);
    });
  });
});
