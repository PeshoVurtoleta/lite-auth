/**
 * @zakkster/lite-auth
 *
 * Session-as-a-signal authentication for the lite-* ecosystem.
 *
 * The whole of auth state lives in one reactive value. Everything an
 * application binds to is a projection of that value:
 *
 *     signal<SessionRecord | undefined>  (private source of truth)
 *         |- session         computed -> User | null
 *         |- isAuthenticated computed -> boolean
 *         |- token           computed -> string | null
 *         |- expiresAt       computed -> number | null
 *
 * Persistence is delegated to @zakkster/lite-persist (boot hydration plus
 * debounced write-through). Cross-tab propagation is delegated to
 * @zakkster/lite-channel (BroadcastChannel, presence, leader election).
 * The two are kept on separate axes: lite-persist owns disk with its own
 * cross-tab path disabled (syncTabs:false); lite-channel owns the wire.
 *
 * Token refresh is timer-based and, under crossTab, performed only by the
 * leader tab. Refresh tokens are frequently single-use, so electing one
 * refresher avoids a rotation race across tabs; followers receive the new
 * record over the channel.
 *
 * MIT License. Copyright (c) Zahary Shinikchiev.
 */

import {
    signal as defaultSignal,
    computed as defaultComputed,
    batch as defaultBatch,
    dispose as disposeReactive,
} from "@zakkster/lite-signal";
import {persist} from "@zakkster/lite-persist";

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * Typed error thrown by awaited imperative actions (signIn / refresh) and
 * surfaced reactively on the `error` signal for ambient failures.
 *
 * The `code` discriminant mirrors the named-error pattern used elsewhere in
 * the ecosystem (see lite-signal's CapacityError).
 */
export class AuthError extends Error {
    /**
     * @param {("invalid_credentials"|"network"|"refresh_failed"|"no_refresh_token"|"expired"|"storage"|"aborted"|"misconfigured")} code
     * @param {string} message
     * @param {{ cause?: unknown }} [opts]
     */
    constructor(code, message, opts) {
        super(message);
        this.name = "AuthError";
        this.code = code;
        if (opts && "cause" in opts) this.cause = opts.cause;
    }
}

function toAuthError(err, fallbackCode) {
    if (err instanceof AuthError) return err;
    // DOMException / AbortError from fetch and AbortController.
    if (err && (err.name === "AbortError" || err.code === 20)) {
        return new AuthError("aborted", "operation aborted", {cause: err});
    }
    // Network-layer failures from fetch reject as TypeError.
    if (err instanceof TypeError) {
        return new AuthError("network", err.message || "network error", {cause: err});
    }
    return new AuthError(fallbackCode, err && err.message ? err.message : String(err), {cause: err});
}

// ---------------------------------------------------------------------------
// Record validation and helpers
// ---------------------------------------------------------------------------

/**
 * Validate the structural shape of a session record. Throws a plain Error
 * (mapped to the caller's fallback code by toAuthError) on malformed input.
 */
function validateRecord(rec) {
    if (rec == null || typeof rec !== "object") {
        throw new Error("lite-auth: session record must be an object");
    }
    if (rec.user == null) {
        throw new Error("lite-auth: session record is missing `user`");
    }
    if (typeof rec.accessToken !== "string" || rec.accessToken.length === 0) {
        throw new Error("lite-auth: session record is missing a string `accessToken`");
    }
    if (rec.refreshToken != null && typeof rec.refreshToken !== "string") {
        throw new Error("lite-auth: `refreshToken` must be a string when present");
    }
    if (rec.expiresAt != null && typeof rec.expiresAt !== "number") {
        throw new Error("lite-auth: `expiresAt` must be a number (epoch ms) when present");
    }
    return rec;
}

function isExpired(rec, nowMs) {
    return rec != null && rec.expiresAt != null && nowMs >= rec.expiresAt;
}

/**
 * Decode the `exp` claim of a JWT and return it as epoch milliseconds.
 * Returns undefined for non-JWTs or unreadable payloads. Pure and zero-dep;
 * works under both browser (atob) and Node (Buffer).
 *
 * @param {string} token
 * @returns {number | undefined}
 */
export function decodeJwtExp(token) {
    if (typeof token !== "string") return undefined;
    const dot1 = token.indexOf(".");
    if (dot1 < 0) return undefined;
    const dot2 = token.indexOf(".", dot1 + 1);
    if (dot2 < 0) return undefined;
    let b64 = token.slice(dot1 + 1, dot2).replace(/-/g, "+").replace(/_/g, "/");
    const padLen = (4 - (b64.length % 4)) % 4;
    if (padLen > 0) b64 += padLen === 1 ? "=" : padLen === 2 ? "==" : "===";
    let json;
    try {
        if (typeof atob === "function") {
            json = atob(b64);
        } else if (typeof Buffer !== "undefined") {
            json = Buffer.from(b64, "base64").toString("binary");
        } else {
            return undefined;
        }
        const payload = JSON.parse(json);
        if (payload && typeof payload.exp === "number") return payload.exp * 1000;
    } catch {
        return undefined;
    }
    return undefined;
}

/**
 * Resolve the `storage` option into a Web-Storage-shaped backend, or null for
 * memory mode (signal-only, no disk).
 */
function resolveStorage(storage) {
    if (storage === "memory") return null;
    if (storage == null || storage === "localStorage") {
        if (typeof globalThis.localStorage === "undefined") {
            throw new AuthError(
                "misconfigured",
                'localStorage is unavailable; use storage:"memory" outside the browser',
            );
        }
        return globalThis.localStorage;
    }
    if (storage === "sessionStorage") {
        if (typeof globalThis.sessionStorage === "undefined") {
            throw new AuthError(
                "misconfigured",
                'sessionStorage is unavailable; use storage:"memory" outside the browser',
            );
        }
        return globalThis.sessionStorage;
    }
    if (typeof storage.getItem === "function" && typeof storage.setItem === "function") {
        return storage; // custom StorageLike
    }
    throw new AuthError("misconfigured", "unknown storage backend: " + String(storage));
}

// ---------------------------------------------------------------------------
// Built-in fetch adapter
// ---------------------------------------------------------------------------

/**
 * A REST adapter over fetch. POSTs JSON to the configured endpoints and parses
 * `{ user, accessToken, refreshToken?, expiresAt? }` from each response. When
 * `expiresAt` is absent it is derived from the access token's JWT `exp` claim.
 *
 * @param {{
 *   signInUrl: string,
 *   refreshUrl?: string,
 *   signOutUrl?: string,
 *   headers?: Record<string,string> | (() => Record<string,string>),
 *   parseSession?: (json: unknown) => any,
 *   fetch?: typeof fetch,
 * }} opts
 */
export function fetchAdapter(opts) {
    if (!opts || typeof opts.signInUrl !== "string") {
        throw new AuthError("misconfigured", "fetchAdapter requires a signInUrl");
    }
    const f = opts.fetch || globalThis.fetch;
    if (typeof f !== "function") {
        throw new AuthError("misconfigured", "no fetch implementation available");
    }
    // Headers may be a static object or a getter evaluated per request. A getter
    // keeps dynamic values (e.g. an Authorization token rotated by background
    // refresh) fresh on every call rather than frozen at adapter-construction.
    const headerOpt = opts.headers;
    const resolveHeaders = () => {
        const dyn = typeof headerOpt === "function" ? headerOpt() : headerOpt;
        return Object.assign({"content-type": "application/json"}, dyn || {});
    };

    function parse(json) {
        if (opts.parseSession) return validateRecord(opts.parseSession(json));
        const rec = {
            user: json && json.user,
            accessToken: json && json.accessToken,
            refreshToken: json && json.refreshToken,
            expiresAt: json && json.expiresAt,
        };
        if (rec.expiresAt == null && typeof rec.accessToken === "string") {
            rec.expiresAt = decodeJwtExp(rec.accessToken);
        }
        return validateRecord(rec);
    }

    const adapter = {
        async signIn(credentials, signal) {
            const res = await f(opts.signInUrl, {
                method: "POST",
                headers: resolveHeaders(),
                body: JSON.stringify(credentials),
                signal,
            });
            if (!res.ok) {
                throw new AuthError("invalid_credentials", "sign-in failed with status " + res.status);
            }
            return parse(await res.json());
        },
    };

    if (opts.refreshUrl) {
        adapter.refresh = async (record, signal) => {
            // The built-in REST adapter clearly cannot refresh without a token.
            // Surface the documented `no_refresh_token` code rather than letting
            // the server 4xx through as a generic `refresh_failed`. Custom
            // adapters remain free to handle a missing token however they like;
            // the core does not preempt them.
            if (record.refreshToken == null) {
                throw new AuthError("no_refresh_token", "no refresh token in current session");
            }
            const res = await f(opts.refreshUrl, {
                method: "POST",
                headers: resolveHeaders(),
                body: JSON.stringify({refreshToken: record.refreshToken}),
                signal,
            });
            if (!res.ok) {
                throw new AuthError("refresh_failed", "token refresh failed with status " + res.status);
            }
            return parse(await res.json());
        };
    }

    if (opts.signOutUrl) {
        adapter.signOut = async (record) => {
            await f(opts.signOutUrl, {
                method: "POST",
                headers: resolveHeaders(),
                body: JSON.stringify({refreshToken: record.refreshToken}),
            });
        };
    }

    return adapter;
}

// ---------------------------------------------------------------------------
// createAuth
// ---------------------------------------------------------------------------

/**
 * Create a reactive authentication controller.
 *
 * @param {import("./Auth.js").AuthConfig} config
 * @returns {import("./Auth.js").Auth}
 */
export function createAuth(config) {
    if (!config || !config.adapter || typeof config.adapter.signIn !== "function") {
        throw new AuthError("misconfigured", "createAuth requires an adapter with a signIn() method");
    }

    const adapter = config.adapter;
    const R = config.registry || {signal: defaultSignal, computed: defaultComputed, batch: defaultBatch};
    const storageKey = config.storageKey || "lite-auth.session.v1";
    const channelName = config.channelName || storageKey;
    const crossTab = config.crossTab === true;
    const refreshCfg = config.refresh || {enabled: false};
    const refreshEnabled = refreshCfg.enabled === true;
    const threshold = (typeof refreshCfg.threshold === "number" ? refreshCfg.threshold : 60) * 1000;
    const onError = typeof config.onError === "function" ? config.onError : null;

    // -- core state ---------------------------------------------------------
    // The empty state is `undefined`, not `null`: lite-persist removes a key
    // only when the signal value is `undefined` (a `null` would be written as
    // the string "null"). Public projections still surface `null` for "no
    // user"; all internal emptiness checks are loose (`== null`).
    const _record = R.signal(/** @type {any} */ (undefined));
    const status = R.signal("idle");
    const error = R.signal(/** @type {AuthError | null} */ (null));

    const session = R.computed(() => {
        const r = _record();
        return r ? r.user : null;
    });
    const isAuthenticated = R.computed(() => _record() != null);
    const token = R.computed(() => {
        const r = _record();
        return r ? r.accessToken : null;
    });
    const expiresAt = R.computed(() => {
        const r = _record();
        return r && r.expiresAt != null ? r.expiresAt : null;
    });

    // -- generation counter: bumps on every record mutation (local, refresh,
    //    sign-out, or cross-tab). Async actions capture it before awaiting and
    //    bail if it moved underneath them.
    let gen = 0;
    const disposers = [];
    disposers.push(_record.subscribe(() => {
        gen++;
    }));

    // Mutable wiring shared across boot, scheduling, and teardown. Declared up
    // here so the boot-time refresh path below can touch them without tripping
    // the temporal dead zone.
    let timer = null;
    let bus = null;
    let busReady = false;
    let refreshAbort = null;
    let signInAbort = null;
    let disposed = false;
    let wireNode = null; // cross-tab string-wire signal, disposed on teardown

    function setError(err) {
        error.set(err);
        if (onError) {
            try {
                onError(err);
            } catch (e) {
                reportHookError(e);
            }
        }
    }

    function clearError() {
        if (error.peek() !== null) error.set(null);
    }

    // -- lifecycle hooks ----------------------------------------------------
    const signInCbs = [];
    const signOutCbs = [];
    const expireCbs = [];
    const refreshCbs = [];

    function register(list, fn) {
        list.push(fn);
        let live = true;
        return () => {
            if (!live) return;
            live = false;
            const i = list.indexOf(fn);
            if (i >= 0) list.splice(i, 1);
        };
    }

    function reportHookError(e) {
        // A throwing user callback must not break the others or the graph.
        if (typeof console !== "undefined" && console.error) {
            console.error("lite-auth: lifecycle hook threw", e);
        }
    }

    function emit(list, arg) {
        // Iterate a copy so a callback may dispose itself mid-emit.
        const copy = list.slice();
        for (let i = 0; i < copy.length; i++) {
            try {
                copy[i](arg);
            } catch (e) {
                reportHookError(e);
            }
        }
    }

    if (config.onSignIn) register(signInCbs, config.onSignIn);
    if (config.onSignOut) register(signOutCbs, config.onSignOut);
    if (config.onSessionExpire) register(expireCbs, config.onSessionExpire);
    if (config.onTokenRefresh) register(refreshCbs, config.onTokenRefresh);

    // -- persistence (lite-persist; cross-tab path disabled) ----------------
    const backend = resolveStorage(config.storage);
    if (backend) {
        // Pre-validate any stored value so a corrupt entry cannot throw out of
        // createAuth via lite-persist's synchronous boot read.
        try {
            const raw = backend.getItem(storageKey);
            if (raw !== null) {
                const parsed = JSON.parse(raw);
                if (parsed != null) validateRecord(parsed);
            }
        } catch (e) {
            try {
                backend.removeItem(storageKey);
            } catch { /* ignore */
            }
            setError(new AuthError("storage", "discarded a corrupt stored session", {cause: e}));
        }
        try {
            const stop = persist(_record, storageKey, {
                storage: backend,
                syncTabs: false, // lite-channel owns cross-tab
                debounce: 0, // session writes are rare; favour durability
                flushOnDispose: true,
                deserialize: (str) => {
                    const v = JSON.parse(str);
                    return v == null ? undefined : validateRecord(v);
                },
            });
            disposers.push(stop);
        } catch (e) {
            setError(new AuthError("storage", "failed to initialise persistence", {cause: e}));
        }
    }

    // -- boot expiry handling ----------------------------------------------
    let bootSettled = Promise.resolve();
    {
        const rec0 = _record.peek();
        if (isExpired(rec0, Date.now())) {
            if (refreshEnabled && adapter.refresh && rec0.refreshToken) {
                bootSettled = doRefresh(rec0, false).catch(() => {
                });
            } else {
                emit(expireCbs);
                _record.set(undefined); // lite-persist removes the key
            }
        }
    }

    // -- lifecycle dispatch (attached post-hydration so a restored session is
    //    the baseline and does not fire onSignIn) ---------------------------
    let lifeInit = false;
    let prevHadUser = false;
    disposers.push(_record.subscribe((rec) => {
        const hasUser = rec != null;
        if (!lifeInit) {
            lifeInit = true;
            prevHadUser = hasUser;
            return;
        }
        if (hasUser === prevHadUser) {
            prevHadUser = hasUser;
            return;
        }
        prevHadUser = hasUser;
        if (hasUser) emit(signInCbs, rec.user);
        else emit(signOutCbs);
    }));

    // -- refresh scheduling -------------------------------------------------
    function leaderNow() {
        if (!crossTab) return true;
        if (!busReady || !bus) return false; // do not schedule before the bus is wired
        return bus.isLeader.peek();
    }

    function rearm() {
        if (timer !== null) {
            clearTimeout(timer);
            timer = null;
        }
        if (disposed || !refreshEnabled || !adapter.refresh) return;
        const rec = _record.peek();
        if (rec == null || rec.expiresAt == null) return;
        if (!leaderNow()) return;
        const delay = Math.max(0, rec.expiresAt - Date.now() - threshold);
        timer = setTimeout(() => {
            timer = null;
            const r = _record.peek();
            if (r != null) doRefresh(r, false).catch(() => {
            });
        }, delay);
    }

    // (Re)arm whenever the record changes. subscribe fires once on attach,
    // establishing the baseline schedule for a hydrated session.
    disposers.push(_record.subscribe(rearm));

    async function doRefresh(rec, manual) {
        if (refreshAbort) refreshAbort.abort();
        refreshAbort = new AbortController();
        const mySignal = refreshAbort.signal;
        const myGen = gen;
        status.set("refreshing");
        let next;
        try {
            if (!adapter.refresh) throw new AuthError("misconfigured", "adapter has no refresh()");
            next = await adapter.refresh(rec, mySignal);
            next = validateRecord(next);
        } catch (e) {
            if (status.peek() === "refreshing") status.set("idle");
            const err = toAuthError(e, "refresh_failed");
            // Superseded mid-flight (sign-out, fresh sign-in, or cross-tab change).
            if (mySignal.aborted || gen !== myGen) {
                if (manual) throw err;
                return;
            }
            setError(err);
            // Unrecoverable: the session is effectively dead. Expire then clear.
            emit(expireCbs);
            _record.set(undefined);
            if (manual) throw err;
            return;
        }
        if (mySignal.aborted || gen !== myGen) {
            if (status.peek() === "refreshing") status.set("idle");
            if (manual) throw new AuthError("aborted", "refresh superseded");
            return;
        }
        R.batch(() => {
            clearError();
            _record.set(next);
            status.set("idle");
        });
        emit(refreshCbs, next);
    }

    // -- cross-tab wiring (async; lite-channel is an optional peer) ----------
    if (crossTab) {
        const attach = (async () => {
            let mod;
            try {
                mod = await import("@zakkster/lite-channel");
            } catch (e) {
                setError(new AuthError(
                    "misconfigured",
                    'crossTab:true requires @zakkster/lite-channel to be installed',
                    {cause: e},
                ));
                return;
            }
            if (disposed) return;
            const opts = Object.assign({}, config.channelOptions, {persist: false});
            bus = mod.createTabSync(channelName, opts);

            // lite-channel applies inbound values inside a lite-signal batch().
            // Because batch defers subscriber notifications to commit time, its
            // internal "applying" echo guard has already been cleared when the
            // subscriber finally runs -- so syncing the record OBJECT directly
            // ping-pongs forever (every structuredClone hop is a fresh reference
            // that never dedupes by Object.is). We therefore sync a STRING wire:
            // identical strings dedupe by value, so when the originating tab
            // receives the echo its wire is unchanged and the loop stops.
            const EMPTY = "\u0000"; // "no session" sentinel; never collides with JSON
            const enc = (rec) => (rec == null ? EMPTY : JSON.stringify(rec));
            const _wire = R.signal(enc(_record.peek()));
            wireNode = _wire;
            let lastWire = enc(_record.peek());

            // Outbound: a local record change is pushed onto the wire to broadcast.
            disposers.push(_record.subscribe(() => {
                const s = enc(_record.peek());
                if (s === lastWire) return; // wire already reflects this value
                lastWire = s;
                _wire.set(s);
            }));

            // Inbound: a genuinely new wire value (from another tab) is adopted
            // into the record. Setting lastWire first makes the outbound
            // subscriber treat the resulting record change as already-sent.
            disposers.push(_wire.subscribe(() => {
                const s = _wire.peek();
                if (s === lastWire) return; // our own reflection or an echo we hold
                lastWire = s;
                let next;
                if (s === EMPTY) {
                    next = undefined;
                } else {
                    try {
                        next = validateRecord(JSON.parse(s));
                    } catch {
                        return; // ignore an unparseable/foreign payload
                    }
                }
                _record.set(next);
            }));

            bus.sync(_wire);
            busReady = true;
            disposers.push(bus.isLeader.subscribe(rearm));
            rearm(); // leadership is known now; schedule if we are the leader
        })();
        bootSettled = bootSettled.then(() => attach);
    }

    const ready = bootSettled.then(() => undefined);

    // -- public actions -----------------------------------------------------
    async function signIn(credentials) {
        if (signInAbort) signInAbort.abort();
        signInAbort = new AbortController();
        const mySignal = signInAbort.signal;
        const myGen = gen;
        status.set("authenticating");
        let rec;
        try {
            rec = await adapter.signIn(credentials, mySignal);
            rec = validateRecord(rec);
        } catch (e) {
            if (status.peek() === "authenticating") status.set("idle");
            const err = toAuthError(e, "invalid_credentials");
            setError(err);
            throw err;
        }
        if (mySignal.aborted || gen !== myGen) {
            if (status.peek() === "authenticating") status.set("idle");
            throw new AuthError("aborted", "sign-in superseded");
        }
        R.batch(() => {
            clearError();
            _record.set(rec);
            status.set("idle");
        });
        return rec.user;
    }

    async function signOut() {
        const rec = _record.peek();
        if (refreshAbort) refreshAbort.abort();
        if (signInAbort) signInAbort.abort();
        // Optimistic local clear: logout always succeeds locally and offline.
        R.batch(() => {
            _record.set(undefined);
            status.set("idle");
        });
        if (rec && adapter.signOut) {
            try {
                await adapter.signOut(rec);
            } catch (e) {
                // Best effort: a failed server revoke never resurrects the
                // local session and never throws from signOut.
                setError(toAuthError(e, "network"));
            }
        }
    }

    async function refresh() {
        const rec = _record.peek();
        if (rec == null) throw new AuthError("expired", "no active session to refresh");
        if (!adapter.refresh) throw new AuthError("misconfigured", "adapter has no refresh()");
        if (rec.refreshToken == null) {
            // Adapters may not need a refresh token; only flag when the default
            // contract clearly cannot proceed. Left permissive: the adapter is
            // the authority. Callers relying on tokens should ensure one exists.
        }
        return doRefresh(rec, true);
    }

    function dispose() {
        if (disposed) return;
        disposed = true;
        if (timer !== null) {
            clearTimeout(timer);
            timer = null;
        }
        if (refreshAbort) refreshAbort.abort();
        if (signInAbort) signInAbort.abort();
        for (let i = 0; i < disposers.length; i++) {
            try {
                disposers[i]();
            } catch { /* idempotent */
            }
        }
        disposers.length = 0;
        if (bus) {
            try {
                bus.dispose();
            } catch { /* ignore */
            }
            bus = null;
        }
        // Release pooled reactive nodes back to the registry, so repeated
        // create/dispose cycles (SSR per request, test harnesses) do not
        // accumulate nodes. For a custom registry, use its own dispose so the
        // right pool is touched -- the imported disposeReactive is bound to
        // the default registry and would silently no-op on foreign nodes. A
        // no-op for registries whose primitives are not lite-signal nodes.
        const disposeNode = typeof R.dispose === "function" ? R.dispose : disposeReactive;
        const nodes = [session, isAuthenticated, token, expiresAt, _record, status, error];
        if (wireNode) nodes.push(wireNode);
        for (let i = 0; i < nodes.length; i++) {
            try {
                disposeNode(nodes[i]);
            } catch { /* ignore */
            }
        }
    }

    return {
        session,
        isAuthenticated,
        token,
        expiresAt,
        status,
        error,
        ready,
        signIn,
        signOut,
        refresh,
        onSignIn: (fn) => register(signInCbs, fn),
        onSignOut: (fn) => register(signOutCbs, fn),
        onSessionExpire: (fn) => register(expireCbs, fn),
        onTokenRefresh: (fn) => register(refreshCbs, fn),
        dispose,
    };
}
