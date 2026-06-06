import { test } from "node:test";
import assert from "node:assert/strict";
import { createAuth } from "../Auth.js";
import { MemoryStorage, makeAdapter, flush } from "./helpers.mjs";

test("onSignIn fires on a fresh sign-in", async () => {
    const seen = [];
    const auth = createAuth({
        adapter: makeAdapter().adapter,
        storage: "memory",
        onSignIn: (u) => seen.push(u),
    });
    await auth.signIn({ username: "ada" });
    assert.equal(seen.length, 1);
    assert.deepEqual(seen[0], { id: "u1", name: "Ada" });
    auth.dispose();
});

test("onSignOut fires on sign-out", async () => {
    const events = [];
    const auth = createAuth({
        adapter: makeAdapter().adapter,
        storage: "memory",
        onSignOut: () => events.push("out"),
    });
    await auth.signIn({ username: "ada" });
    await auth.signOut();
    assert.deepEqual(events, ["out"]);
    auth.dispose();
});

test("a restored session does NOT fire onSignIn", async () => {
    const storage = new MemoryStorage();
    storage.setItem(
        "k",
        JSON.stringify({ user: { id: "u9" }, accessToken: "t", expiresAt: Date.now() + 600000 }),
    );
    const seen = [];
    const auth = createAuth({
        adapter: makeAdapter().adapter,
        storage,
        storageKey: "k",
        onSignIn: (u) => seen.push(u),
    });
    await auth.ready;
    await flush();
    assert.equal(seen.length, 0, "restore is the baseline, not a transition");
    assert.equal(auth.isAuthenticated.peek(), true);
    auth.dispose();
});

test("runtime onSignIn registration returns an idempotent disposer", async () => {
    const auth = createAuth({ adapter: makeAdapter().adapter, storage: "memory" });
    const seen = [];
    const off = auth.onSignIn((u) => seen.push(u.id));
    await auth.signIn({ username: "ada" });
    off();
    off(); // idempotent
    await auth.signOut();
    await auth.signIn({ username: "ada" });
    assert.deepEqual(seen, ["u1"], "hook fired once, then was removed");
    auth.dispose();
});

test("multiple hooks all fire", async () => {
    const auth = createAuth({ adapter: makeAdapter().adapter, storage: "memory" });
    let a = 0;
    let b = 0;
    auth.onSignIn(() => a++);
    auth.onSignIn(() => b++);
    await auth.signIn({ username: "ada" });
    assert.equal(a, 1);
    assert.equal(b, 1);
    auth.dispose();
});

test("a throwing hook does not break others or escape", async () => {
    const auth = createAuth({ adapter: makeAdapter().adapter, storage: "memory" });
    let reached = false;
    auth.onSignIn(() => {
        throw new Error("hook boom");
    });
    auth.onSignIn(() => {
        reached = true;
    });
    await assert.doesNotReject(auth.signIn({ username: "ada" }));
    assert.equal(reached, true);
    auth.dispose();
});

test("onTokenRefresh fires on a successful manual refresh", async () => {
    const refreshed = [];
    const auth = createAuth({
        adapter: makeAdapter({ withRefresh: true, expiresAt: Date.now() + 600000 }).adapter,
        storage: "memory",
        onTokenRefresh: (rec) => refreshed.push(rec.accessToken),
    });
    await auth.signIn({ username: "ada" });
    const before = auth.token.peek();
    await auth.refresh();
    const after = auth.token.peek();
    assert.equal(refreshed.length, 1);
    assert.notEqual(before, after);
    assert.match(after, /^access-ref-/);
    auth.dispose();
});

test("expiry fires onSessionExpire before onSignOut", async () => {
    const order = [];
    const auth = createAuth({
        adapter: makeAdapter({ withRefresh: true, refreshReject: true, expiresAt: Date.now() + 600000 })
            .adapter,
        storage: "memory",
        onSignIn: () => order.push("in"),
        onSignOut: () => order.push("out"),
        onSessionExpire: () => order.push("expire"),
    });
    await auth.signIn({ username: "ada" });
    await assert.rejects(auth.refresh(), /refresh/i);
    assert.deepEqual(order, ["in", "expire", "out"]);
    assert.equal(auth.isAuthenticated.peek(), false);
    auth.dispose();
});
