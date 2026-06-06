// Test doubles and utilities shared across the lite-auth suite.
// No production code depends on this file.

// --- Web Storage double ----------------------------------------------------

export class MemoryStorage {
    constructor() { this._m = new Map(); }
    getItem(k) { return this._m.has(k) ? this._m.get(k) : null; }
    setItem(k, v) { this._m.set(k, String(v)); }
    removeItem(k) { this._m.delete(k); }
    clear() { this._m.clear(); }
    get length() { return this._m.size; }
    key(i) { return Array.from(this._m.keys())[i] ?? null; }
}

export function installWebStorage() {
    const local = new MemoryStorage();
    const session = new MemoryStorage();
    globalThis.localStorage = local;
    globalThis.sessionStorage = session;
    return { local, session };
}

export function uninstallWebStorage() {
    delete globalThis.localStorage;
    delete globalThis.sessionStorage;
}

// --- BroadcastChannel double -----------------------------------------------
// Delivers to *other* live instances on the same channel name via queueMicrotask
// (matching the asynchronous semantics of the real API and lite-channel's
// default microtask scheduling).

const BC_REGISTRY = new Map(); // name -> Set<MockBroadcastChannel>

function clone(data) {
    if (typeof structuredClone === "function") return structuredClone(data);
    return JSON.parse(JSON.stringify(data));
}

export class MockBroadcastChannel {
    constructor(name) {
        this.name = name;
        this._listeners = new Set();
        this.onmessage = null;
        this._closed = false;
        if (!BC_REGISTRY.has(name)) BC_REGISTRY.set(name, new Set());
        BC_REGISTRY.get(name).add(this);
    }
    postMessage(data) {
        if (this._closed) return;
        const peers = BC_REGISTRY.get(this.name);
        if (!peers) return;
        const payload = clone(data);
        for (const peer of peers) {
            if (peer === this || peer._closed) continue;
            queueMicrotask(() => {
                if (peer._closed) return;
                const ev = { data: payload };
                if (typeof peer.onmessage === "function") peer.onmessage(ev);
                for (const l of peer._listeners) {
                    try { l(ev); } catch { /* ignore listener throw */ }
                }
            });
        }
    }
    addEventListener(type, fn) { if (type === "message") this._listeners.add(fn); }
    removeEventListener(type, fn) { if (type === "message") this._listeners.delete(fn); }
    close() {
        this._closed = true;
        const s = BC_REGISTRY.get(this.name);
        if (s) s.delete(this);
    }
}

export function installBroadcastChannel() {
    globalThis.BroadcastChannel = MockBroadcastChannel;
}

export function resetBroadcastChannel() {
    BC_REGISTRY.clear();
    delete globalThis.BroadcastChannel;
}

// --- Fake adapter ----------------------------------------------------------

let nextId = 0;

/**
 * Build a configurable adapter plus a call-count record.
 *
 * opts:
 *   expiresAt        number | (() => number)  expiresAt for issued records
 *   user             object                   user payload (default { id: 'u1' })
 *   withRefresh      boolean                  expose refresh()
 *   withSignOut      boolean                  expose signOut()
 *   signInReject     boolean | Error          make signIn reject
 *   refreshReject    boolean | Error          make refresh reject
 *   signOutReject    boolean | Error          make signOut reject
 *   refreshExpiresAt number | (() => number)  expiresAt for refreshed records
 *   delayMs          number                   resolve after a real delay
 */
export function makeAdapter(opts = {}) {
    const calls = { signIn: 0, refresh: 0, signOut: 0 };
    const user = opts.user || { id: "u1", name: "Ada" };
    const exp = () => (typeof opts.expiresAt === "function" ? opts.expiresAt() : opts.expiresAt);
    const refExp = () =>
        typeof opts.refreshExpiresAt === "function"
            ? opts.refreshExpiresAt()
            : opts.refreshExpiresAt != null
              ? opts.refreshExpiresAt
              : exp();

    async function maybeDelay() {
        if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
    }

    const adapter = {
        async signIn(_credentials, _signal) {
            calls.signIn++;
            await maybeDelay();
            if (opts.signInReject) {
                throw opts.signInReject instanceof Error ? opts.signInReject : new Error("invalid creds");
            }
            return {
                user,
                accessToken: "access-" + ++nextId,
                refreshToken: "refresh-" + nextId,
                expiresAt: exp(),
            };
        },
    };

    if (opts.withRefresh) {
        adapter.refresh = async (rec, _signal) => {
            calls.refresh++;
            await maybeDelay();
            if (opts.refreshReject) {
                throw opts.refreshReject instanceof Error ? opts.refreshReject : new Error("refresh failed");
            }
            return {
                user: rec.user,
                accessToken: "access-ref-" + ++nextId,
                refreshToken: "refresh-ref-" + nextId,
                expiresAt: refExp(),
            };
        };
    }

    if (opts.withSignOut) {
        adapter.signOut = async (_rec) => {
            calls.signOut++;
            if (opts.signOutReject) {
                throw opts.signOutReject instanceof Error ? opts.signOutReject : new Error("revoke failed");
            }
        };
    }

    return { adapter, calls };
}

// --- timing ---------------------------------------------------------------

/** Drain the microtask queue (channel propagation, persist writes at debounce:0). */
export async function flush(turns = 25) {
    for (let i = 0; i < turns; i++) await Promise.resolve();
}

/** A real macrotask tick, for suites not using mock timers. */
export function realTick(ms = 0) {
    return new Promise((r) => setTimeout(r, ms));
}
