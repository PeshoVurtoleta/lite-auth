import { test } from "node:test";
import assert from "node:assert/strict";
import { createAuth } from "../Auth.js";
import {
    MemoryStorage,
    makeAdapter,
    flush,
    installWebStorage,
    uninstallWebStorage,
} from "./helpers.mjs";

test("writes the session through to storage", async () => {
    const storage = new MemoryStorage();
    const { adapter } = makeAdapter({ expiresAt: Date.now() + 600000 });
    const auth = createAuth({ adapter, storage, storageKey: "k" });
    await auth.signIn({ username: "ada" });
    await flush();
    const raw = storage.getItem("k");
    assert.ok(raw, "expected a stored value");
    const rec = JSON.parse(raw);
    assert.deepEqual(rec.user, { id: "u1", name: "Ada" });
    assert.match(rec.accessToken, /^access-/);
    auth.dispose();
});

test("hydrates a stored session synchronously on boot", async () => {
    const storage = new MemoryStorage();
    storage.setItem(
        "k",
        JSON.stringify({
            user: { id: "u9", name: "Restored" },
            accessToken: "stored-token",
            refreshToken: "stored-refresh",
            expiresAt: Date.now() + 600000,
        }),
    );
    const { adapter } = makeAdapter();
    const auth = createAuth({ adapter, storage, storageKey: "k" });
    // Available immediately, before ready resolves.
    assert.equal(auth.isAuthenticated.peek(), true);
    assert.deepEqual(auth.session.peek(), { id: "u9", name: "Restored" });
    assert.equal(auth.token.peek(), "stored-token");
    auth.dispose();
});

test("signOut removes the stored key", async () => {
    const storage = new MemoryStorage();
    const { adapter } = makeAdapter();
    const auth = createAuth({ adapter, storage, storageKey: "k" });
    await auth.signIn({ username: "ada" });
    await flush();
    assert.ok(storage.getItem("k"));
    await auth.signOut();
    await flush();
    assert.equal(storage.getItem("k"), null);
    auth.dispose();
});

test("sessionStorage and localStorage are isolated backends", async () => {
    const { local, session } = installWebStorage();
    try {
        const a1 = createAuth({ adapter: makeAdapter().adapter, storage: "sessionStorage", storageKey: "k" });
        await a1.signIn({ username: "ada" });
        await flush();
        assert.ok(session.getItem("k"), "session backend should hold the record");
        assert.equal(local.getItem("k"), null, "local backend must stay empty");
        a1.dispose();
    } finally {
        uninstallWebStorage();
    }
});

test("memory storage persists nothing to disk", async () => {
    const { local } = installWebStorage();
    try {
        const auth = createAuth({ adapter: makeAdapter().adapter, storage: "memory", storageKey: "k" });
        await auth.signIn({ username: "ada" });
        await flush();
        assert.equal(local.getItem("k"), null);
        assert.equal(auth.isAuthenticated.peek(), true);
        auth.dispose();
    } finally {
        uninstallWebStorage();
    }
});

test("a corrupt stored value is discarded without throwing, and surfaces on error", async () => {
    const storage = new MemoryStorage();
    storage.setItem("k", "{ this is not valid json");
    const { adapter } = makeAdapter();
    let auth;
    assert.doesNotThrow(() => {
        auth = createAuth({ adapter, storage, storageKey: "k" });
    });
    assert.equal(auth.isAuthenticated.peek(), false);
    assert.ok(auth.error.peek() instanceof Error);
    assert.equal(auth.error.peek().code, "storage");
    assert.equal(storage.getItem("k"), null, "corrupt entry should be removed");
    auth.dispose();
});

test("a structurally invalid stored record is discarded", async () => {
    const storage = new MemoryStorage();
    storage.setItem("k", JSON.stringify({ user: null, accessToken: 123 }));
    const auth = createAuth({ adapter: makeAdapter().adapter, storage, storageKey: "k" });
    assert.equal(auth.isAuthenticated.peek(), false);
    assert.equal(auth.error.peek().code, "storage");
    auth.dispose();
});

test("a quota/write failure does not throw from signIn; session stays usable", async () => {
    // Storage that reads fine but rejects writes (quota exhaustion). lite-persist
    // swallows the write failure, so the session remains live in memory.
    const storage = new MemoryStorage();
    storage.setItem = () => {
        throw new Error("QuotaExceededError");
    };
    const { adapter } = makeAdapter();
    const auth = createAuth({ adapter, storage, storageKey: "k" });
    await assert.doesNotReject(auth.signIn({ username: "ada" }));
    await flush();
    assert.equal(auth.isAuthenticated.peek(), true, "session remains usable in memory");
    auth.dispose();
});

test("requesting localStorage outside the browser is a misconfiguration", () => {
    uninstallWebStorage();
    assert.throws(
        () => createAuth({ adapter: makeAdapter().adapter, storage: "localStorage" }),
        /misconfigured|unavailable/i,
    );
});
