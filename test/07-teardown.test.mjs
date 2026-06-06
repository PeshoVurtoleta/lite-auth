import { test } from "node:test";
import assert from "node:assert/strict";
import { createAuth } from "../Auth.js";
import { MemoryStorage, makeAdapter, flush } from "./helpers.mjs";

test("dispose leaves the stored session intact (dispose is not sign-out)", async () => {
    const storage = new MemoryStorage();
    const auth = createAuth({ adapter: makeAdapter().adapter, storage, storageKey: "k" });
    await auth.signIn({ username: "ada" });
    await flush();
    assert.ok(storage.getItem("k"));
    auth.dispose();
    await flush();
    assert.ok(storage.getItem("k"), "stored session should survive dispose");
});

test("dispose is idempotent", async () => {
    const auth = createAuth({ adapter: makeAdapter().adapter, storage: "memory" });
    await auth.signIn({ username: "ada" });
    auth.dispose();
    assert.doesNotThrow(() => auth.dispose());
});

test("dispose before ready resolves does not throw", async () => {
    const auth = createAuth({ adapter: makeAdapter().adapter, storage: "memory" });
    assert.doesNotThrow(() => auth.dispose());
    await assert.doesNotReject(auth.ready);
});

test("a hook registered then disposed before any transition never fires", async () => {
    const auth = createAuth({ adapter: makeAdapter().adapter, storage: "memory" });
    let fired = false;
    const off = auth.onSignIn(() => {
        fired = true;
    });
    off();
    await auth.signIn({ username: "ada" });
    assert.equal(fired, false);
    auth.dispose();
});

test("repeated create/dispose does not exhaust the reactive node pool", () => {
    // The default lite-signal registry pools a bounded number of nodes; dispose()
    // must release them, or a few hundred controllers would throw CapacityError.
    assert.doesNotThrow(() => {
        for (let i = 0; i < 3000; i++) {
            const auth = createAuth({ adapter: makeAdapter().adapter, storage: "memory" });
            auth.dispose();
        }
    });
});
