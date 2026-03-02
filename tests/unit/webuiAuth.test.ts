/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock database layer for UserRepository
const mockGetDatabase = vi.fn();
vi.mock('@process/database/export', () => ({
  getDatabase: () => mockGetDatabase(),
}));

// Set a fixed JWT_SECRET for deterministic tests
process.env.JWT_SECRET = 'test-secret-key-for-unit-tests-must-be-long-enough';

import jwt from 'jsonwebtoken';
import { AuthService } from '@/webserver/auth/service/AuthService';
import { TokenMiddleware } from '@/webserver/auth/middleware/TokenMiddleware';

describe('AuthService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset the cached jwtSecret to force re-read from env
    (AuthService as any).jwtSecret = null;
    // Clear token blacklist to prevent cross-test contamination
    // (tokens with same payload generated in the same second have identical iat)
    (AuthService as any).tokenBlacklist = new Map();
  });

  describe('hashPassword / verifyPassword', () => {
    it('should hash and verify password', async () => {
      const hash = await AuthService.hashPassword('mypassword');
      expect(hash).toBeDefined();
      expect(hash).not.toBe('mypassword');

      const isValid = await AuthService.verifyPassword('mypassword', hash);
      expect(isValid).toBe(true);
    });

    it('should reject wrong password', async () => {
      const hash = await AuthService.hashPassword('correct');
      const isValid = await AuthService.verifyPassword('wrong', hash);
      expect(isValid).toBe(false);
    });
  });

  describe('generateToken / verifyToken', () => {
    it('should generate and verify a valid token', () => {
      const token = AuthService.generateToken({ id: 'u1', username: 'alice' });
      expect(token).toBeTruthy();

      const payload = AuthService.verifyToken(token);
      expect(payload).not.toBeNull();
      expect(payload!.userId).toBe('u1');
      expect(payload!.username).toBe('alice');
    });

    it('should return null for invalid token', () => {
      const payload = AuthService.verifyToken('invalid.token.here');
      expect(payload).toBeNull();
    });

    it('should return null for expired token', () => {
      // Create a token that's already expired
      const token = jwt.sign({ userId: 'u1', username: 'alice' }, process.env.JWT_SECRET!, { expiresIn: '0s', issuer: 'aionui', audience: 'aionui-webui' });
      const payload = AuthService.verifyToken(token);
      expect(payload).toBeNull();
    });
  });

  describe('blacklistToken / isTokenBlacklisted', () => {
    it('should blacklist a token', () => {
      const token = AuthService.generateToken({ id: 'u1', username: 'alice' });
      expect(AuthService.isTokenBlacklisted(token)).toBe(false);

      AuthService.blacklistToken(token);
      expect(AuthService.isTokenBlacklisted(token)).toBe(true);
    });

    it('should return null for blacklisted token on verify', () => {
      const token = AuthService.generateToken({ id: 'u1', username: 'alice' });
      AuthService.blacklistToken(token);

      const payload = AuthService.verifyToken(token);
      expect(payload).toBeNull();
    });
  });

  describe('refreshToken', () => {
    it('should return new token for valid input', () => {
      const original = AuthService.generateToken({ id: 'u1', username: 'alice' });
      const refreshed = AuthService.refreshToken(original);
      expect(refreshed).toBeTruthy();

      // Verify the refreshed token is valid and has correct payload
      const payload = AuthService.verifyToken(refreshed!);
      expect(payload).not.toBeNull();
      expect(payload!.userId).toBe('u1');
      expect(payload!.username).toBe('alice');
    });

    it('should return null for invalid token', () => {
      const refreshed = AuthService.refreshToken('invalid');
      expect(refreshed).toBeNull();
    });
  });

  describe('generateRandomPassword', () => {
    it('should generate password of valid length', () => {
      const pw = AuthService.generateRandomPassword();
      expect(pw.length).toBeGreaterThanOrEqual(12);
      expect(pw.length).toBeLessThanOrEqual(17);
    });

    it('should pass its own strength validation', () => {
      const pw = AuthService.generateRandomPassword();
      const result = AuthService.validatePasswordStrength(pw);
      expect(result.isValid).toBe(true);
    });
  });

  describe('validatePasswordStrength', () => {
    it('should reject too short password', () => {
      const result = AuthService.validatePasswordStrength('short');
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Password must be at least 8 characters long');
    });

    it('should reject too long password', () => {
      const result = AuthService.validatePasswordStrength('a'.repeat(129));
      expect(result.isValid).toBe(false);
    });

    it('should reject common passwords', () => {
      const result = AuthService.validatePasswordStrength('password');
      expect(result.isValid).toBe(false);
      expect(result.errors.some((e: string) => e.includes('too common'))).toBe(true);
    });

    it('should accept valid password', () => {
      const result = AuthService.validatePasswordStrength('MyStr0ng!Pass');
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('validateUsername', () => {
    it('should reject too short username', () => {
      const result = AuthService.validateUsername('ab');
      expect(result.isValid).toBe(false);
    });

    it('should reject invalid characters', () => {
      const result = AuthService.validateUsername('user@name');
      expect(result.isValid).toBe(false);
    });

    it('should reject username starting with hyphen', () => {
      const result = AuthService.validateUsername('-username');
      expect(result.isValid).toBe(false);
    });

    it('should reject username ending with underscore', () => {
      const result = AuthService.validateUsername('username_');
      expect(result.isValid).toBe(false);
    });

    it('should accept valid username', () => {
      const result = AuthService.validateUsername('alice-bob_123');
      expect(result.isValid).toBe(true);
    });
  });

  describe('verifyWebSocketToken', () => {
    it('should verify valid WebSocket token', () => {
      const token = AuthService.generateToken({ id: 'u1', username: 'alice' });
      const payload = AuthService.verifyWebSocketToken(token);
      expect(payload).not.toBeNull();
      expect(payload!.userId).toBe('u1');
    });

    it('should reject blacklisted token', () => {
      const token = AuthService.generateToken({ id: 'u1', username: 'alice' });
      AuthService.blacklistToken(token);
      const payload = AuthService.verifyWebSocketToken(token);
      expect(payload).toBeNull();
    });
  });

  describe('constantTimeVerify', () => {
    it('should return true for matching strings', async () => {
      const result = await AuthService.constantTimeVerify('hello', 'hello');
      expect(result).toBe(true);
    });

    it('should return false for mismatched strings', async () => {
      const result = await AuthService.constantTimeVerify('hello', 'world');
      expect(result).toBe(false);
    });
  });
});

describe('TokenMiddleware', () => {
  beforeEach(() => {
    (AuthService as any).jwtSecret = null;
  });

  describe('extractToken', () => {
    it('should extract token from Bearer header', () => {
      const req = {
        headers: { authorization: 'Bearer my-token' },
        cookies: {},
      } as any;
      const token = TokenMiddleware.extractToken(req);
      expect(token).toBe('my-token');
    });

    it('should extract token from cookie', () => {
      const req = {
        headers: {},
        cookies: { 'aionui-session': 'cookie-token' },
      } as any;
      const token = TokenMiddleware.extractToken(req);
      expect(token).toBe('cookie-token');
    });

    it('should return null for missing token', () => {
      const req = { headers: {}, cookies: {} } as any;
      const token = TokenMiddleware.extractToken(req);
      expect(token).toBeNull();
    });
  });

  describe('isTokenValid', () => {
    it('should return true for valid token', () => {
      const token = AuthService.generateToken({ id: 'u1', username: 'alice' });
      expect(TokenMiddleware.isTokenValid(token)).toBe(true);
    });

    it('should return false for null', () => {
      expect(TokenMiddleware.isTokenValid(null)).toBe(false);
    });

    it('should return false for invalid token', () => {
      expect(TokenMiddleware.isTokenValid('bad-token')).toBe(false);
    });
  });

  describe('extractWebSocketToken', () => {
    it('should extract from Authorization header', () => {
      const req = {
        headers: { authorization: 'Bearer ws-token' },
      } as any;
      const token = TokenMiddleware.extractWebSocketToken(req);
      expect(token).toBe('ws-token');
    });

    it('should extract from cookie header', () => {
      const req = {
        headers: { cookie: 'aionui-session=cookie-ws-token; other=val' },
      } as any;
      const token = TokenMiddleware.extractWebSocketToken(req);
      expect(token).toBe('cookie-ws-token');
    });

    it('should extract from sec-websocket-protocol', () => {
      const req = {
        headers: { 'sec-websocket-protocol': 'proto-token, other-proto' },
      } as any;
      const token = TokenMiddleware.extractWebSocketToken(req);
      expect(token).toBe('proto-token');
    });

    it('should return null when no token found', () => {
      const req = { headers: {} } as any;
      const token = TokenMiddleware.extractWebSocketToken(req);
      expect(token).toBeNull();
    });
  });

  describe('validateWebSocketToken', () => {
    it('should return true for valid token', () => {
      const token = AuthService.generateToken({ id: 'u1', username: 'alice' });
      expect(TokenMiddleware.validateWebSocketToken(token)).toBe(true);
    });

    it('should return false for null', () => {
      expect(TokenMiddleware.validateWebSocketToken(null)).toBe(false);
    });
  });
});
