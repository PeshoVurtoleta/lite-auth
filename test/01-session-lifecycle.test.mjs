import { test } from "node:test";
import assert from "node:assert/strict";
import { createAuth } from "../Auth.js";
import { MemoryStorage, makeAdapter, flush } from "./helpers.mjs";

function mem() {
    return { storage: new MemoryStorage() };
}

test("starts unauthenticated with empty projections", async () => {
    const { adapter } = makeAdapter();
    const auth = createAuth({ adapter, storage: "memory" });
    await auth.ready;
    assert.equal(auth.session.peek(), null);
    assert.equal(auth.isAuthenticated.peek(), false);
    assert.equal(auth.token.peek(), null);
    assert.equal(auth.expiresAt.peek(), null);
    assert.equal(auth.status.peek(), "idle");
    assert.equal(auth.error.peek(), null);
    auth.dispose();
});

test("signIn populates session, token, and isAuthenticated", async () => {
    const { adapter } = makeAdapter({ expiresAt: Date.now() + 600000 });
    const auth = createAuth({ adapter, storage: "memory" });
    const user = await auth.signIn({ username: "ada" });
    assert.deepEqual(user, { id: "u1", name: "Ada" });
    assert.equal(auth.isAuthenticated.peek(), true);
    assert.deepEqual(auth.session.peek(), { id: "u1", name: "Ada" });
    assert.match(auth.token.peek(), /^access-/);
    assert.ok(auth.expiresAt.peek() > Date.now());
    assert.equal(auth.status.peek(), "idle");
    auth.dispose();
});

test("signOut clears the session", async () => {
    const { adapter } = makeAdapter({ withSignOut: true });
    const auth = createAuth({ adapter, storage: "memory" });
    await auth.signIn({ username: "ada" });
    assert.equal(auth.isAuthenticated.peek(), true);
    await auth.signOut();
    assert.equal(auth.isAuthenticated.peek(), false);
    assert.equal(auth.session.peek(), null);
    assert.equal(auth.token.peek(), null);
    auth.dispose();
});

test("projections are reactive to record changes", async () => {
    const { adapter } = makeAdapter();
    const auth = createAuth({ adapter, storage: "memory" });
    const seen = [];
    const stop = auth.isAuthenticated.subscribe((v) => seen.push(v));
    await auth.signIn({ username: "ada" });
    await auth.signOut();
    stop();
    // subscribe fires immediately (false), then true on signIn, then false on signOut.
    assert.deepEqual(seen, [false, true, false]);
    auth.dispose();
});

test("signIn while already authenticated replaces the session", async () => {
    const { adapter, calls } = makeAdapter();
    const auth = createAuth({ adapter, ...mem() });
    const u1 = await auth.signIn({ username: "ada" });
    const t1 = auth.token.peek();
    const u2 = await auth.signIn({ username: "ada" });
    const t2 = auth.token.peek();
    assert.equal(calls.signIn, 2);
    assert.notEqual(t1, t2);
    assert.deepEqual(u1, u2);
    assert.equal(auth.isAuthenticated.peek(), true);
    auth.dispose();
});

test("custom storageKey does not collide with the default", async () => {
    const { storage } = mem();
    const { adapter } = makeAdapter();
    const auth = createAuth({ adapter, storage, storageKey: "myapp.auth" });
    await auth.signIn({ username: "ada" });
    await flush();
    assert.ok(storage.getItem("myapp.auth"));
    assert.equal(storage.getItem("lite-auth.session.v1"), null);
    auth.dispose();
});

test("createAuth throws without a valid adapter", () => {
    assert.throws(() => createAuth({}), /adapter/);
    assert.throws(() => createAuth({ adapter: {} }), /signIn/);
});
