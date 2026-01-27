import { vi, beforeAll, afterAll, afterEach, expect } from "vitest";
import { cleanup } from "@testing-library/react";
import * as matchers from "@testing-library/jest-dom/matchers";

// Extend Vitest's expect with jest-dom matchers
expect.extend(matchers);

// Mock Web Crypto API for testing
const cryptoMock = {
  subtle: {
    generateKey: vi.fn(),
    deriveKey: vi.fn(),
    deriveBits: vi.fn(),
    encrypt: vi.fn(),
    decrypt: vi.fn(),
    exportKey: vi.fn(),
    importKey: vi.fn(),
    sign: vi.fn(),
    verify: vi.fn(),
  },
  getRandomValues: vi.fn((array: Uint8Array) => {
    // Fill with deterministic values for testing
    for (let i = 0; i < array.length; i++) {
      array[i] = i % 256;
    }
    return array;
  }),
};

// Set up crypto mock if not in secure context
if (typeof globalThis.crypto === "undefined") {
  Object.defineProperty(globalThis, "crypto", {
    value: cryptoMock,
    writable: true,
  });
}

// Mock IndexedDB for keyStore tests
const indexedDBMock = {
  open: vi.fn(),
  deleteDatabase: vi.fn(),
};

if (typeof globalThis.indexedDB === "undefined") {
  Object.defineProperty(globalThis, "indexedDB", {
    value: indexedDBMock,
    writable: true,
  });
}

// Global test setup
beforeAll(() => {
  // Setup code that runs before all tests
});

afterAll(() => {
  // Cleanup code that runs after all tests
});

afterEach(() => {
  // Cleanup after each test
  cleanup();
  vi.clearAllMocks();
});

// Export for use in tests
export { vi, cryptoMock };
