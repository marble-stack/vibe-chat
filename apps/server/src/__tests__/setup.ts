import { vi, beforeAll, afterAll, afterEach } from "vitest";

// Mock environment variables for testing
process.env.JWT_SECRET = "test-jwt-secret-for-testing-only";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.NODE_ENV = "test";

// Global test setup
beforeAll(() => {
  // Setup code that runs before all tests
});

afterAll(() => {
  // Cleanup code that runs after all tests
});

afterEach(() => {
  // Cleanup after each test
  vi.clearAllMocks();
});

// Export vi for use in tests if needed
export { vi };
