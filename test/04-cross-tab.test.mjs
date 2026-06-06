import { test, mock } from "node:test";
import assert from "node:assert/strict";
import "@zakkster/lite-channel"; // warm the module cache so createAuth's dynamic import resolves promptly
import { createAuth } from "../Auth.js";
import { makeAdapter, flush, installBroadcastChannel, resetBroadcastChannel } from "./helpers.mjs";

const BASE = 1_700_000_000_000;
const LIFE = 300_000;
const THRESHOLD = 60;
const DELAY = LIFE - THRESHOLD * 1000;

function makeTab(opts) {
    return createAuth({
        adapter: opts.adapter,
        storage: opts.storage || "memory",
        storageKey: "k",
        channelName: opts.channelName || "ch",
        crossTab: true,
        channelOptions: { heartbeatMs: 0, evictMs: 10_000_000, readyMs: 0 },
        refresh: opts.refresh,
        onSignOut: opts.onSignOut,
    });
}

test("a sign-in in one tab propagates to another", async () => {
    installBroadcastChannel();
    try {
        const { adapter } = makeAdapter();
        const A = makeTab({ adapter });
        const B = makeTab({ adapter });
        await Promise.all([A.ready, B.ready]);
        await flush();
        await A.signIn({ username: "ada" });
        await flush();
        assert.equal(B.isAuthenticated.peek(), true);
        assert.deepEqual(B.session.peek(), { id: "u1", name: "Ada" });
        assert.equal(B.token.peek(), A.token.peek());
        A.dispose();
        B.dispose();
    } finally {
        resetBroadcastChannel();
    }
});

test("a sign-out in one tab logs out the other (the headline feature)", async () => {
    installBroadcastChannel();
    try {
        const { adapter } = makeAdapter();
        let bOut = 0;
        const A = makeTab({ adapter });
        const B = makeTab({ adapter, onSignOut: () => bOut++ });
        await Promise.all([A.ready, B.ready]);
        await flush();
        await A.signIn({ username: "ada" });
        await flush();
        assert.equal(B.isAuthenticated.peek(), true);
        await A.signOut();
        await flush();
        assert.equal(B.isAuthenticated.peek(), false, "the other tab should be logged out");
        assert.equal(bOut, 1, "onSignOut should fire in the receiving tab");
        A.dispose();
        B.dispose();
    } finally {
        resetBroadcastChannel();
    }
});

test("only the leader tab refreshes (exactly one refresh across two tabs)", async (t) => {
    mock.timers.enable({ apis: ["setTimeout", "Date"], now: BASE });
    installBroadcastChannel();
    t.after(() => {
        resetBroadcastChannel();
        mock.timers.reset();
    });
    const { adapter, calls } = makeAdapter({
        withRefresh: true,
        expiresAt: () => Date.now() + LIFE,
        refreshExpiresAt: () => Date.now() + LIFE * 10, // next refresh far away
    });
    const A = makeTab({ adapter, refresh: { enabled: true, threshold: THRESHOLD } });
    const B = makeTab({ adapter, refresh: { enabled: true, threshold: THRESHOLD } });
    await Promise.all([A.ready, B.ready]);
    await flush(); // settle presence so leadership is decided before sign-in
    await A.signIn({ username: "ada" });
    await flush(); // propagate the record to the follower
    mock.timers.tick(DELAY + 1);
    await flush();
    assert.equal(calls.refresh, 1, "exactly one tab (the leader) performs the refresh");
    assert.match(A.token.peek(), /^access-ref-/);
    assert.match(B.token.peek(), /^access-ref-/);
    assert.equal(A.token.peek(), B.token.peek(), "both tabs converge on the refreshed token");
    A.dispose();
    B.dispose();
});

test("a late-joining tab adopts the active session over the channel", async () => {
    installBroadcastChannel();
    try {
        const { adapter } = makeAdapter();
        const A = makeTab({ adapter });
        await A.ready;
        await flush();
        await A.signIn({ username: "ada" });
        await flush();
        // B opens only now; memory storage means the channel is its only source.
        const B = makeTab({ adapter });
        await B.ready;
        await flush();
        assert.equal(B.isAuthenticated.peek(), true, "late tab adopts the running session");
        assert.deepEqual(B.session.peek(), { id: "u1", name: "Ada" });
        A.dispose();
        B.dispose();
    } finally {
        resetBroadcastChannel();
    }
});

test("propagation does not echo into an infinite loop", async () => {
    installBroadcastChannel();
    try {
        const { adapter, calls } = makeAdapter();
        const A = makeTab({ adapter });
        const B = makeTab({ adapter });
        await Promise.all([A.ready, B.ready]);
        await flush();
        await A.signIn({ username: "ada" });
        await flush(60);
        assert.equal(calls.signIn, 1, "sign-in must run exactly once, not re-trigger over the wire");
        assert.equal(A.token.peek(), B.token.peek());
        assert.equal(A.error.peek(), null);
        assert.equal(B.error.peek(), null);
        A.dispose();
        B.dispose();
    } finally {
        resetBroadcastChannel();
    }
});
