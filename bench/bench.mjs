// Honest microbenchmarks for @zakkster/lite-auth.
//
// Auth events (sign-in, sign-out, refresh) are infrequent by nature, so this is
// not a hot-loop engine benchmark; it simply measures that the common paths are
// cheap and free of surprises. Numbers are ops/s on the current machine.

import { createAuth, decodeJwtExp } from "../Auth.js";

function bench(name, fn, ms = 400) {
    // warm up
    for (let i = 0; i < 1000; i++) fn(i);
    let ops = 0;
    const end = process.hrtime.bigint() + BigInt(ms) * 1_000_000n;
    while (process.hrtime.bigint() < end) {
        fn(ops);
        ops++;
    }
    const elapsedMs = ms;
    const opsPerSec = Math.round((ops / elapsedMs) * 1000);
    console.log("  " + name.padEnd(42) + opsPerSec.toLocaleString("en-US").padStart(14) + " ops/s");
    return opsPerSec;
}

async function benchAsync(name, fn, ms = 400) {
    for (let i = 0; i < 200; i++) await fn(i);
    let ops = 0;
    const end = process.hrtime.bigint() + BigInt(ms) * 1_000_000n;
    while (process.hrtime.bigint() < end) {
        await fn(ops);
        ops++;
    }
    const opsPerSec = Math.round((ops / ms) * 1000);
    console.log("  " + name.padEnd(42) + opsPerSec.toLocaleString("en-US").padStart(14) + " ops/s");
    return opsPerSec;
}

const fixedExp = Date.now() + 3_600_000;
const adapter = {
    async signIn(c) {
        return { user: { id: c.id, name: c.id }, accessToken: "tok-" + c.id, refreshToken: "r", expiresAt: fixedExp };
    },
};

// A representative JWT for the decoder path.
const jwt =
    "eyJhbGciOiJIUzI1NiJ9." +
    Buffer.from(JSON.stringify({ sub: "u1", exp: Math.floor(fixedExp / 1000) })).toString("base64url") +
    ".sig";

console.log("\n@zakkster/lite-auth microbenchmarks (higher is better)\n");

// 1. Projection reads on a live, churning record.
{
    const auth = createAuth({ adapter, storage: "memory" });
    await auth.signIn({ id: "u1" });
    bench("projection read (session/isAuth/token)", () => {
        // touch all four projections
        void auth.session.peek();
        void auth.isAuthenticated.peek();
        void auth.token.peek();
        void auth.expiresAt.peek();
    });
    auth.dispose();
}

// 2. decodeJwtExp throughput (the path the padding fix touched).
bench("decodeJwtExp", () => decodeJwtExp(jwt));

// 3. Full sign-in + sign-out cycle (controller churn, memory storage).
{
    let n = 0;
    await benchAsync("signIn + signOut cycle (memory)", async () => {
        const auth = createAuth({ adapter, storage: "memory" });
        await auth.signIn({ id: "u" + n++ });
        await auth.signOut();
        auth.dispose();
    });
}

console.log("");
