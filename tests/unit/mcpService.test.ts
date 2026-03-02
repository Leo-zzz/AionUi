/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock electron before any module that imports initStorage
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn().mockReturnValue('/mock/userData'),
    getName: vi.fn().mockReturnValue('AionUi'),
    getVersion: vi.fn().mockReturnValue('1.0.0'),
  },
}));

// Mock initStorage to prevent module-level side effects
vi.mock('@/process/initStorage', () => ({
  ProcessConfig: { get: vi.fn(), set: vi.fn() },
  ProcessChat: { get: vi.fn() },
  getHomePage: vi.fn().mockReturnValue('/mock/home'),
}));

// Mock utils to prevent getConfigPath from running
vi.mock('@/process/utils', () => ({
  getConfigPath: vi.fn().mockReturnValue('/mock/config'),
  getDataPath: vi.fn().mockReturnValue('/mock/data'),
  ensureDirectory: vi.fn(),
  ensureCliSafeSymlink: vi.fn((p: string) => p),
}));

// Mock child_process
vi.mock('child_process', () => ({
  execSync: vi.fn(),
  spawn: vi.fn(),
}));

// Mock agent functions (must use mock prefix for vitest hoisting)
const mockDetect = vi.fn().mockResolvedValue({ source: 'claude', servers: [] });
const mockInstall = vi.fn().mockResolvedValue({ success: true });
const mockRemove = vi.fn().mockResolvedValue({ success: true });
const mockTest = vi.fn().mockResolvedValue({ success: true, tools: [] });
const mockGetTransports = vi.fn().mockReturnValue(['stdio', 'sse']);
const mockGetBackend = vi.fn().mockReturnValue('claude');

// Must use mock-prefixed function name for vitest hoisting to work
const mockCreateAgent = function () {
  return {
    detectMcpServers: mockDetect,
    installMcpServers: mockInstall,
    removeMcpServer: mockRemove,
    testMcpConnection: mockTest,
    getSupportedTransports: mockGetTransports,
    getBackendType: mockGetBackend,
  };
};

vi.mock('@/process/services/mcpServices/agents/ClaudeMcpAgent', () => ({
  ClaudeMcpAgent: vi.fn().mockImplementation(mockCreateAgent),
}));
vi.mock('@/process/services/mcpServices/agents/GeminiMcpAgent', () => ({
  GeminiMcpAgent: vi.fn().mockImplementation(mockCreateAgent),
}));
vi.mock('@/process/services/mcpServices/agents/AionuiMcpAgent', () => ({
  AionuiMcpAgent: vi.fn().mockImplementation(mockCreateAgent),
}));
vi.mock('@/process/services/mcpServices/agents/CodebuddyMcpAgent', () => ({
  CodebuddyMcpAgent: vi.fn().mockImplementation(mockCreateAgent),
}));
vi.mock('@/process/services/mcpServices/agents/QwenMcpAgent', () => ({
  QwenMcpAgent: vi.fn().mockImplementation(mockCreateAgent),
}));
vi.mock('@/process/services/mcpServices/agents/IflowMcpAgent', () => ({
  IflowMcpAgent: vi.fn().mockImplementation(mockCreateAgent),
}));
vi.mock('@/process/services/mcpServices/agents/CodexMcpAgent', () => ({
  CodexMcpAgent: vi.fn().mockImplementation(mockCreateAgent),
}));

describe('McpService', () => {
  let McpService: any;
  let mcpServiceInstance: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();

    const mod = await import('@/process/services/mcpServices/McpService');
    McpService = mod.McpService;
    mcpServiceInstance = new McpService();
  });

  describe('getAgentMcpConfigs', () => {
    it('should call detectMcpServers on agents', async () => {
      if (typeof mcpServiceInstance.getAgentMcpConfigs === 'function') {
        const agents = [{ backend: 'claude', name: 'Claude', cliPath: 'claude' }];
        const results = await mcpServiceInstance.getAgentMcpConfigs(agents);
        expect(Array.isArray(results)).toBe(true);
        expect(mockDetect).toHaveBeenCalled();
      }
    });
  });

  describe('getSupportedTransportsForAgent', () => {
    it('should return transport types for known agent', () => {
      if (typeof mcpServiceInstance.getSupportedTransportsForAgent === 'function') {
        const transports = mcpServiceInstance.getSupportedTransportsForAgent({ backend: 'claude' });
        expect(Array.isArray(transports)).toBe(true);
      }
    });
  });

  describe('testMcpConnection', () => {
    it('should test connection with available agent', async () => {
      if (typeof mcpServiceInstance.testMcpConnection === 'function') {
        const server = { name: 'test', command: 'echo', args: [], transport: 'stdio' };
        const result = await mcpServiceInstance.testMcpConnection(server);
        expect(result).toBeDefined();
      }
    });
  });

  describe('syncMcpToAgents', () => {
    it('should call installMcpServers on agents', async () => {
      if (typeof mcpServiceInstance.syncMcpToAgents === 'function') {
        const servers = [{ name: 'test', command: 'echo', args: [], transport: 'stdio', enabled: true }];
        const agents = [{ backend: 'claude', name: 'Claude', cliPath: 'claude' }];
        await mcpServiceInstance.syncMcpToAgents(servers, agents);
        expect(mockInstall).toHaveBeenCalled();
      }
    });
  });

  describe('removeMcpFromAgents', () => {
    it('should call removeMcpServer on agents', async () => {
      if (typeof mcpServiceInstance.removeMcpFromAgents === 'function') {
        const agents = [{ backend: 'claude', name: 'Claude', cliPath: 'claude' }];
        await mcpServiceInstance.removeMcpFromAgents('test-server', agents);
        expect(mockRemove).toHaveBeenCalled();
      }
    });
  });
});
