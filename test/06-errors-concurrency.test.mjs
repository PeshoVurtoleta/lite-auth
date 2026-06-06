import { test } from "node:test";
import assert from "node:assert/strict";
import { createAuth, AuthError } from "../Auth.js";
import { makeAdapter } from "./helpers.mjs";

test("bad credentials throw a typed AuthError and populate error", async () => {
    const auth = createAuth({ adapter: makeAdapter({ signInReject: true }).adapter, storage: "memory" });
    await assert.rejects(auth.signIn({ username: "x" }), (e) => {
        assert.ok(e instanceof AuthError);
        assert.equal(e.code, "invalid_credentials");
        return true;
    });
    assert.ok(auth.error.peek() instanceof AuthError);
    assert.equal(auth.error.peek().code, "invalid_credentials");
    assert.equal(auth.status.peek(), "idle");
    assert.equal(auth.isAuthenticated.peek(), false);
    auth.dispose();
});

test("a network-layer failure maps to code 'network'", async () => {
    const adapter = {
        async signIn() {
            throw new TypeError("Failed to fetch");
        },
    };
    const auth = createAuth({ adapter, storage: "memory" });
    await assert.rejects(auth.signIn({}), (e) => e.code === "network");
    auth.dispose();
});

test("error clears on the next successful sign-in", async () => {
    let fail = true;
    const adapter = {
        async signIn() {
            if (fail) {
                fail = false;
                throw new AuthError("invalid_credentials", "nope");
            }
            return { user: { id: "u1" }, accessToken: "t", expiresAt: Date.now() + 600000 };
        },
    };
    const auth = createAuth({ adapter, storage: "memory" });
    await assert.rejects(auth.signIn({}));
    assert.ok(auth.error.peek());
    await auth.signIn({});
    assert.equal(auth.error.peek(), null);
    assert.equal(auth.isAuthenticated.peek(), true);
    auth.dispose();
});

test("refresh without an active session throws 'expired'", async () => {
    const auth = createAuth({
        adapter: makeAdapter({ withRefresh: true }).adapter,
        storage: "memory",
    });
    await assert.rejects(auth.refresh(), (e) => e.code === "expired");
    auth.dispose();
});

test("refresh with an adapter lacking refresh() throws 'misconfigured'", async () => {
    const auth = createAuth({ adapter: makeAdapter().adapter, storage: "memory" });
    await auth.signIn({ username: "ada" });
    await assert.rejects(auth.refresh(), (e) => e.code === "misconfigured");
    auth.dispose();
});

test("concurrent signIn calls: last call wins, earlier is aborted", async () => {
    const { adapter, calls } = makeAdapter({ delayMs: 15, expiresAt: Date.now() + 600000 });
    const auth = createAuth({ adapter, storage: "memory" });
    const p1 = auth.signIn({ username: "first" });
    const p2 = auth.signIn({ username: "second" });
    const results = await Promise.allSettled([p1, p2]);
    assert.equal(calls.signIn, 2);
    const aborted = results.filter((r) => r.status === "rejected" && r.reason.code === "aborted");
    const ok = results.filter((r) => r.status === "fulfilled");
    assert.equal(aborted.length, 1, "exactly one call should be aborted");
    assert.equal(ok.length, 1, "exactly one call should win");
    assert.equal(auth.isAuthenticated.peek(), true);
    auth.dispose();
});

test("signOut during an in-flight refresh aborts the refresh and stays signed out", async () => {
    const { adapter } = makeAdapter({ withRefresh: true, delayMs: 15, expiresAt: Date.now() + 600000 });
    const auth = createAuth({ adapter, storage: "memory" });
    await auth.signIn({ username: "ada" });
    const refreshing = auth.refresh();
    const out = auth.signOut();
    const [r] = await Promise.allSettled([refreshing, out]);
    assert.equal(r.status, "rejected");
    assert.equal(r.reason.code, "aborted");
    assert.equal(auth.isAuthenticated.peek(), false, "sign-out must not be resurrected by the refresh");
    auth.dispose();
});

test("signOut never throws even when server revoke fails", async () => {
    const { adapter } = makeAdapter({ withSignOut: true, signOutReject: true });
    const auth = createAuth({ adapter, storage: "memory" });
    await auth.signIn({ username: "ada" });
    await assert.doesNotReject(auth.signOut());
    assert.equal(auth.isAuthenticated.peek(), false);
    assert.equal(auth.error.peek().code, "network");
    auth.dispose();
});
