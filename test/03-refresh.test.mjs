import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { createAuth } from "../Auth.js";
import { MemoryStorage, makeAdapter, flush } from "./helpers.mjs";

const BASE = 1_700_000_000_000;
const LIFE = 300_000; // 5 minutes
const THRESHOLD = 60; // seconds
const DELAY = LIFE - THRESHOLD * 1000; // 240_000 ms until refresh

function enableTimers() {
    mock.timers.enable({ apis: ["setTimeout", "Date"], now: BASE });
}

test("schedules a refresh at the threshold and swaps the token", async (t) => {
    enableTimers();
    t.after(() => mock.timers.reset());
    const { adapter, calls } = makeAdapter({
        withRefresh: true,
        expiresAt: () => Date.now() + LIFE,
        refreshExpiresAt: () => Date.now() + LIFE,
    });
    const auth = createAuth({ adapter, storage: "memory", refresh: { enabled: true, threshold: THRESHOLD } });
    await auth.signIn({ username: "ada" });
    const before = auth.token.peek();
    assert.equal(calls.refresh, 0);
    mock.timers.tick(DELAY + 1);
    await flush();
    assert.equal(calls.refresh, 1);
    assert.notEqual(auth.token.peek(), before);
    assert.match(auth.token.peek(), /^access-ref-/);
    auth.dispose();
});

test("reschedules after a refresh so the next token also refreshes", async (t) => {
    enableTimers();
    t.after(() => mock.timers.reset());
    const { adapter, calls } = makeAdapter({
        withRefresh: true,
        expiresAt: () => Date.now() + LIFE,
        refreshExpiresAt: () => Date.now() + LIFE,
    });
    const auth = createAuth({ adapter, storage: "memory", refresh: { enabled: true, threshold: THRESHOLD } });
    await auth.signIn({ username: "ada" });
    mock.timers.tick(DELAY + 1);
    await flush();
    assert.equal(calls.refresh, 1);
    mock.timers.tick(DELAY + 1);
    await flush();
    assert.equal(calls.refresh, 2);
    auth.dispose();
});

test("a background refresh fires onTokenRefresh", async (t) => {
    enableTimers();
    t.after(() => mock.timers.reset());
    const refreshed = [];
    const { adapter } = makeAdapter({
        withRefresh: true,
        expiresAt: () => Date.now() + LIFE,
        refreshExpiresAt: () => Date.now() + LIFE,
    });
    const auth = createAuth({
        adapter,
        storage: "memory",
        refresh: { enabled: true, threshold: THRESHOLD },
        onTokenRefresh: (rec) => refreshed.push(rec.accessToken),
    });
    await auth.signIn({ username: "ada" });
    mock.timers.tick(DELAY + 1);
    await flush();
    assert.equal(refreshed.length, 1);
    auth.dispose();
});

test("a failed background refresh expires the session", async (t) => {
    enableTimers();
    t.after(() => mock.timers.reset());
    const order = [];
    const { adapter } = makeAdapter({
        withRefresh: true,
        refreshReject: true,
        expiresAt: () => Date.now() + LIFE,
    });
    const auth = createAuth({
        adapter,
        storage: "memory",
        refresh: { enabled: true, threshold: THRESHOLD },
        onSessionExpire: () => order.push("expire"),
        onSignOut: () => order.push("out"),
    });
    await auth.signIn({ username: "ada" });
    assert.equal(auth.isAuthenticated.peek(), true);
    mock.timers.tick(DELAY + 1);
    await flush();
    assert.equal(auth.isAuthenticated.peek(), false);
    assert.deepEqual(order, ["expire", "out"]);
    assert.equal(auth.error.peek().code, "refresh_failed");
    auth.dispose();
});

test("refresh disabled means no timer ever fires", async (t) => {
    enableTimers();
    t.after(() => mock.timers.reset());
    const { adapter, calls } = makeAdapter({ withRefresh: true, expiresAt: () => Date.now() + LIFE });
    const auth = createAuth({ adapter, storage: "memory" }); // no refresh config
    await auth.signIn({ username: "ada" });
    const before = auth.token.peek();
    mock.timers.tick(LIFE * 100);
    await flush();
    assert.equal(calls.refresh, 0);
    assert.equal(auth.token.peek(), before);
    assert.equal(auth.isAuthenticated.peek(), true);
    auth.dispose();
});

test("an expired-on-boot session is refreshed when a refresh token is present", async (t) => {
    enableTimers();
    t.after(() => mock.timers.reset());
    const storage = new MemoryStorage();
    storage.setItem(
        "k",
        JSON.stringify({
            user: { id: "u9" },
            accessToken: "old",
            refreshToken: "r",
            expiresAt: BASE - 1000, // already expired at BASE
        }),
    );
    const { adapter, calls } = makeAdapter({
        withRefresh: true,
        refreshExpiresAt: () => Date.now() + LIFE,
    });
    const auth = createAuth({
        adapter,
        storage,
        storageKey: "k",
        refresh: { enabled: true, threshold: THRESHOLD },
    });
    await auth.ready;
    await flush();
    assert.equal(calls.refresh, 1);
    assert.equal(auth.isAuthenticated.peek(), true);
    assert.match(auth.token.peek(), /^access-ref-/);
    auth.dispose();
});

test("an expired-on-boot session with no refresh starts signed out and fires onSessionExpire", async (t) => {
    enableTimers();
    t.after(() => mock.timers.reset());
    const storage = new MemoryStorage();
    storage.setItem(
        "k",
        JSON.stringify({ user: { id: "u9" }, accessToken: "old", expiresAt: BASE - 1000 }),
    );
    let expired = 0;
    const auth = createAuth({
        adapter: makeAdapter().adapter,
        storage,
        storageKey: "k",
        onSessionExpire: () => expired++,
    });
    await auth.ready;
    await flush();
    assert.equal(auth.isAuthenticated.peek(), false);
    assert.equal(expired, 1);
    auth.dispose();
});

test("dispose clears the pending refresh timer", async (t) => {
    enableTimers();
    t.after(() => mock.timers.reset());
    const { adapter, calls } = makeAdapter({
        withRefresh: true,
        expiresAt: () => Date.now() + LIFE,
        refreshExpiresAt: () => Date.now() + LIFE,
    });
    const auth = createAuth({ adapter, storage: "memory", refresh: { enabled: true, threshold: THRESHOLD } });
    await auth.signIn({ username: "ada" });
    auth.dispose();
    mock.timers.tick(DELAY + 1);
    await flush();
    assert.equal(calls.refresh, 0, "no refresh after dispose");
});
