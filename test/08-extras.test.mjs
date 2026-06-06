// Coverage for the un-tested public surface: fetchAdapter, decodeJwtExp,
// custom registry, and a handful of edge cases the v1.0.0 audit found
// (signOut on empty session, signIn race with dispose, exact node reclamation,
// the no_refresh_token AuthError code, refresh after dispose).
//
// This file pairs with 01-07 and uses the same helpers; nothing here depends
// on a real network -- fetchAdapter is exercised through an injected fetch.

import { test } from "node:test";
import assert from "node:assert/strict";
import { stats, createRegistry } from "@zakkster/lite-signal";
import {
    createAuth,
    fetchAdapter,
    decodeJwtExp,
    AuthError,
} from "../Auth.js";
import { MemoryStorage, makeAdapter, flush } from "./helpers.mjs";

// ===========================================================================
// decodeJwtExp
// ===========================================================================

test("decodeJwtExp returns undefined for non-string input", () => {
    assert.equal(decodeJwtExp(null), undefined);
    assert.equal(decodeJwtExp(undefined), undefined);
    assert.equal(decodeJwtExp(123), undefined);
    assert.equal(decodeJwtExp({}), undefined);
});

test("decodeJwtExp returns undefined for malformed tokens", () => {
    assert.equal(decodeJwtExp(""), undefined);
    assert.equal(decodeJwtExp("notajwt"), undefined);
    assert.equal(decodeJwtExp("only.one"), undefined);
    assert.equal(decodeJwtExp("a.@@@@@.s"), undefined);
    assert.equal(decodeJwtExp("a." + Buffer.from("not json").toString("base64url") + ".s"), undefined);
});

test("decodeJwtExp returns undefined when the payload has no `exp`", () => {
    const tok = "a." + Buffer.from(JSON.stringify({ sub: "u1" })).toString("base64url") + ".s";
    assert.equal(decodeJwtExp(tok), undefined);
});

test("decodeJwtExp returns undefined when `exp` is non-numeric", () => {
    const tok = "a." + Buffer.from(JSON.stringify({ exp: "oops" })).toString("base64url") + ".s";
    assert.equal(decodeJwtExp(tok), undefined);
});

test("decodeJwtExp decodes a valid `exp` to epoch milliseconds", () => {
    const expSec = 1_700_000_000;
    const tok = "a." + Buffer.from(JSON.stringify({ exp: expSec })).toString("base64url") + ".s";
    assert.equal(decodeJwtExp(tok), expSec * 1000);
});

test("decodeJwtExp tolerates base64url payloads needing padding", () => {
    // {"exp":17000000000} is 19 chars -> base64url is 26 chars (mod 4 == 2),
    // so the padding branch in decodeJwtExp (`if (padLen > 0)`) runs.
    const expSec = 17_000_000_000;
    const payload = Buffer.from(JSON.stringify({ exp: expSec })).toString("base64url");
    assert.equal(payload.length % 4, 2, "test fixture should need 2 chars of padding");
    assert.equal(decodeJwtExp("h." + payload + ".s"), expSec * 1000);
});

// ===========================================================================
// fetchAdapter
// ===========================================================================

test("fetchAdapter throws misconfigured without a signInUrl", () => {
    assert.throws(() => fetchAdapter({}), (e) => e instanceof AuthError && e.code === "misconfigured");
    assert.throws(() => fetchAdapter(), (e) => e instanceof AuthError && e.code === "misconfigured");
});

test("fetchAdapter throws misconfigured when no fetch is available", () => {
    const orig = globalThis.fetch;
    delete globalThis.fetch;
    try {
        assert.throws(
            () => fetchAdapter({ signInUrl: "/x" }),
            (e) => e instanceof AuthError && e.code === "misconfigured",
        );
    } finally {
        if (orig) globalThis.fetch = orig;
    }
});

test("fetchAdapter.signIn POSTs JSON and returns the parsed record", async () => {
    let captured = null;
    const a = fetchAdapter({
        signInUrl: "/api/login",
        fetch: async (url, init) => {
            captured = { url, init };
            return { ok: true, json: async () => ({ user: { id: "u1" }, accessToken: "tok", expiresAt: 9999 }) };
        },
    });
    const rec = await a.signIn({ username: "ada" }, new AbortController().signal);
    assert.equal(captured.url, "/api/login");
    assert.equal(captured.init.method, "POST");
    assert.equal(captured.init.body, JSON.stringify({ username: "ada" }));
    assert.equal(captured.init.headers["content-type"], "application/json");
    assert.deepEqual(rec.user, { id: "u1" });
    assert.equal(rec.accessToken, "tok");
});

test("fetchAdapter dynamic headers re-evaluate on every request", async () => {
    let token = "t1";
    const captured = [];
    const a = fetchAdapter({
        signInUrl: "/x",
        headers: () => ({ Authorization: "Bearer " + token }),
        fetch: async (_url, init) => {
            captured.push(init.headers.Authorization);
            return { ok: true, json: async () => ({ user: { id: "u" }, accessToken: "tok" }) };
        },
    });
    await a.signIn({}, new AbortController().signal);
    token = "t2";
    await a.signIn({}, new AbortController().signal);
    assert.deepEqual(captured, ["Bearer t1", "Bearer t2"]);
});

test("fetchAdapter.signIn on a 4xx response throws invalid_credentials", async () => {
    const a = fetchAdapter({
        signInUrl: "/x",
        fetch: async () => ({ ok: false, status: 401 }),
    });
    await assert.rejects(
        a.signIn({}, new AbortController().signal),
        (e) => e instanceof AuthError && e.code === "invalid_credentials",
    );
});

test("fetchAdapter.refresh on a 4xx response throws refresh_failed", async () => {
    const a = fetchAdapter({
        signInUrl: "/x",
        refreshUrl: "/r",
        fetch: async () => ({ ok: false, status: 401 }),
    });
    await assert.rejects(
        a.refresh({ refreshToken: "r" }, new AbortController().signal),
        (e) => e instanceof AuthError && e.code === "refresh_failed",
    );
});

test("fetchAdapter.refresh without a refresh token throws no_refresh_token", async () => {
    // This is the regression test for the doc/code mismatch: `no_refresh_token`
    // is in the AuthErrorCode union but was unused in v1.0.0-rc.
    const a = fetchAdapter({
        signInUrl: "/x",
        refreshUrl: "/r",
        fetch: async () => {
            assert.fail("fetch must not be called when refreshToken is missing");
        },
    });
    await assert.rejects(
        a.refresh({ /* no refreshToken */ }, new AbortController().signal),
        (e) => e instanceof AuthError && e.code === "no_refresh_token",
    );
});

test("fetchAdapter parseSession override maps a custom response shape", async () => {
    const a = fetchAdapter({
        signInUrl: "/x",
        parseSession: (j) => ({
            user: { id: j.data.id },
            accessToken: j.data.token,
            expiresAt: Date.now() + 1000,
        }),
        fetch: async () => ({ ok: true, json: async () => ({ data: { id: "u9", token: "custom" } }) }),
    });
    const rec = await a.signIn({}, new AbortController().signal);
    assert.deepEqual(rec.user, { id: "u9" });
    assert.equal(rec.accessToken, "custom");
});

test("fetchAdapter derives expiresAt from JWT exp when the response omits it", async () => {
    const expSec = Math.floor((Date.now() + 600_000) / 1000);
    const jwt = "h." + Buffer.from(JSON.stringify({ exp: expSec })).toString("base64url") + ".s";
    const a = fetchAdapter({
        signInUrl: "/x",
        fetch: async () => ({ ok: true, json: async () => ({ user: { id: "u" }, accessToken: jwt }) }),
    });
    const rec = await a.signIn({}, new AbortController().signal);
    assert.equal(rec.expiresAt, expSec * 1000);
});

// ===========================================================================
// Custom registry
// ===========================================================================

test("custom registry: createAuth runs entirely inside the supplied registry", async () => {
    const R = createRegistry();
    const before = stats();
    const { adapter } = makeAdapter();
    const auth = createAuth({ adapter, storage: "memory", registry: R });
    await auth.signIn({ username: "ada" });
    // The default registry must not have grown -- all nodes live in R.
    const dflt = stats();
    assert.equal(dflt.signals, before.signals);
    assert.equal(dflt.computeds, before.computeds);
    assert.equal(dflt.effects, before.effects);
    // R must hold the three signals + four computeds + the wiring effects.
    const r = R.stats();
    assert.ok(r.signals >= 3, "expected >= 3 signals in custom registry, got " + r.signals);
    assert.ok(r.computeds >= 4, "expected >= 4 computeds in custom registry, got " + r.computeds);
    auth.dispose();
});

test("custom registry: dispose reclaims signal and computed nodes (regression for v1.0.0 leak)", async () => {
    // v1.0.0 used the imported `dispose` bound to the default registry on a
    // custom-registry instance, leaking every signal and computed. The fix is
    // to prefer R.dispose when present. This test catches that exact bug.
    const R = createRegistry();
    const { adapter } = makeAdapter();
    const auth = createAuth({ adapter, storage: "memory", registry: R });
    await auth.signIn({ username: "ada" });
    auth.dispose();
    const r = R.stats();
    assert.equal(r.signals, 0, "all signals reclaimed");
    assert.equal(r.computeds, 0, "all computeds reclaimed");
    assert.equal(r.effects, 0, "all effects reclaimed");
    assert.equal(r.activeNodes, 0, "active node count back to zero");
});

test("custom registry without dispose: foreign primitives are silently tolerated on teardown", () => {
    // A registry whose primitives are not lite-signal nodes (a user shim, say)
    // must not throw from createAuth.dispose. The disposer falls back to the
    // imported lite-signal `dispose`, which no-ops on foreign inputs.
    const R = {
        signal: (initial) => {
            let v = initial;
            const subs = new Set();
            const fn = () => v;
            fn.peek = () => v;
            fn.set = (next) => {
                v = next;
                for (const s of subs) s(v);
            };
            fn.update = (f) => fn.set(f(v));
            fn.subscribe = (run) => {
                subs.add(run);
                run(v);
                return () => subs.delete(run);
            };
            return fn;
        },
        computed: (compute) => {
            const fn = () => compute();
            fn.peek = () => compute();
            fn.subscribe = (run) => {
                run(compute());
                return () => {};
            };
            return fn;
        },
        batch: (f) => f(),
        // no dispose
    };
    const { adapter } = makeAdapter();
    const auth = createAuth({ adapter, storage: "memory", registry: R });
    assert.doesNotThrow(() => auth.dispose());
});

// ===========================================================================
// Exact node reclamation (default registry)
// ===========================================================================

test("default registry: stats return to baseline after a full lifecycle", async () => {
    const before = stats();
    const { adapter } = makeAdapter({ withRefresh: true, withSignOut: true });
    const auth = createAuth({ adapter, storage: "memory" });
    await auth.signIn({ username: "ada" });
    await auth.refresh();
    await auth.signOut();
    auth.dispose();
    const after = stats();
    assert.equal(after.signals, before.signals);
    assert.equal(after.computeds, before.computeds);
    assert.equal(after.effects, before.effects);
    assert.equal(after.activeNodes, before.activeNodes);
});

// ===========================================================================
// Edge cases the v1.0.0 audit found work but were never asserted on
// ===========================================================================

test("signOut on an empty (never-signed-in) session is silent: no onSignOut fire", async () => {
    const events = [];
    const auth = createAuth({
        adapter: makeAdapter().adapter,
        storage: "memory",
        onSignOut: () => events.push("out"),
    });
    await auth.signOut();
    await flush();
    assert.deepEqual(events, [], "signOut on empty must not emit a spurious lifecycle event");
    assert.equal(auth.isAuthenticated.peek(), false);
    assert.equal(auth.status.peek(), "idle");
    auth.dispose();
});

test("an in-flight signIn rejects with 'aborted' when dispose() interrupts it", async () => {
    const { adapter } = makeAdapter({ delayMs: 25 });
    const auth = createAuth({ adapter, storage: "memory" });
    const p = auth.signIn({ username: "ada" });
    auth.dispose(); // tear down before signIn resolves
    await assert.rejects(p, (e) => e instanceof AuthError && e.code === "aborted");
});

test("dispose is idempotent across mixed-state instances", async () => {
    // unauthenticated, no awaits in flight
    const a1 = createAuth({ adapter: makeAdapter().adapter, storage: "memory" });
    assert.doesNotThrow(() => { a1.dispose(); a1.dispose(); });
    // authenticated, no refresh in flight
    const a2 = createAuth({ adapter: makeAdapter().adapter, storage: "memory" });
    await a2.signIn({ username: "ada" });
    assert.doesNotThrow(() => { a2.dispose(); a2.dispose(); });
    // authenticated, refresh enabled (timer armed)
    const a3 = createAuth({
        adapter: makeAdapter({ withRefresh: true, expiresAt: Date.now() + 600000 }).adapter,
        storage: "memory",
        refresh: { enabled: true, threshold: 60 },
    });
    await a3.signIn({ username: "ada" });
    assert.doesNotThrow(() => { a3.dispose(); a3.dispose(); });
});
