import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// Mock WebSocket
class MockWebSocket {
  readyState = 1; // OPEN
  sentMessages: string[] = [];

  send(data: string) {
    this.sentMessages.push(data);
  }
}

// The connection management functions are not exported, so we test them
// through the exported module state accessors we'll create

describe('WebSocket Connection Management', () => {
  let connectionMaps: {
    getChannelConnectionsSize: () => number;
    getCommunityConnectionsSize: () => number;
    getCommunityOnlineUsersSize: () => number;
    getSocketUsersSize: () => number;
    cleanupEmptyMaps: () => void;
  };

  beforeEach(async () => {
    // Import the module fresh for each test
    vi.resetModules();
    const mod = await import('../../websocket/connectionMaps.js');
    connectionMaps = mod;
  });

  describe('Empty Set Cleanup', () => {
    it('should expose functions to check map sizes', () => {
      expect(connectionMaps.getChannelConnectionsSize).toBeDefined();
      expect(connectionMaps.getCommunityConnectionsSize).toBeDefined();
      expect(connectionMaps.getCommunityOnlineUsersSize).toBeDefined();
      expect(connectionMaps.getSocketUsersSize).toBeDefined();
    });

    it('should start with empty maps', () => {
      expect(connectionMaps.getChannelConnectionsSize()).toBe(0);
      expect(connectionMaps.getCommunityConnectionsSize()).toBe(0);
      expect(connectionMaps.getCommunityOnlineUsersSize()).toBe(0);
      expect(connectionMaps.getSocketUsersSize()).toBe(0);
    });

    it('should provide a cleanupEmptyMaps function', () => {
      expect(connectionMaps.cleanupEmptyMaps).toBeDefined();
      expect(typeof connectionMaps.cleanupEmptyMaps).toBe('function');
    });
  });
});
