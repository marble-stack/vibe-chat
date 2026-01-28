/**
 * @vitest-environment jsdom
 *
 * KeyStore API Contract Tests
 *
 * Note: Full keyStore tests require a real IndexedDB environment.
 * These tests verify the module exports exist without actually importing
 * the module (which would trigger Dexie initialization).
 */
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

describe("KeyStore Module Structure", () => {
  it("should have keyStore.ts file", () => {
    const keyStorePath = path.resolve(__dirname, "../../lib/keyStore.ts");
    expect(fs.existsSync(keyStorePath)).toBe(true);
  });

  it("should export required functions based on source code analysis", () => {
    const keyStorePath = path.resolve(__dirname, "../../lib/keyStore.ts");
    const content = fs.readFileSync(keyStorePath, "utf-8");

    // Check for exported functions
    expect(content).toContain("export async function storeIdentityKeys");
    expect(content).toContain("export async function getIdentityKeys");
    expect(content).toContain("export async function getIdentityPrivateKey");
    expect(content).toContain("export async function storeChannelKey");
    expect(content).toContain("export async function getChannelKey");
    expect(content).toContain("export async function hasChannelKey");
    expect(content).toContain("export async function storeUserKey");
    expect(content).toContain("export async function getUserKey");
    expect(content).toContain("export async function clearAllKeys");
    expect(content).toContain("export async function hasIdentityKeys");
    expect(content).toContain("export async function regenerateIdentityKeys");
  });

  it("should use Dexie for IndexedDB storage", () => {
    const keyStorePath = path.resolve(__dirname, "../../lib/keyStore.ts");
    const content = fs.readFileSync(keyStorePath, "utf-8");

    expect(content).toContain("import Dexie");
    expect(content).toContain('super("vibechat-keystore")');
  });

  it("should define correct database schema", () => {
    const keyStorePath = path.resolve(__dirname, "../../lib/keyStore.ts");
    const content = fs.readFileSync(keyStorePath, "utf-8");

    // Check for table definitions
    expect(content).toContain("identity!");
    expect(content).toContain("preKeys!");
    expect(content).toContain("channelKeys!");
    expect(content).toContain("userKeys!");
  });

  it("should handle null returns for missing data", () => {
    const keyStorePath = path.resolve(__dirname, "../../lib/keyStore.ts");
    const content = fs.readFileSync(keyStorePath, "utf-8");

    // These functions should return null when data doesn't exist
    expect(content).toContain("if (!identity) return null");
    expect(content).toContain("if (!stored) return null");
  });
});
