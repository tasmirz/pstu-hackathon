# Scenario Simulator

**Owner:** C · **Started:** 10:30, before the transfer endpoint exists · **Reader:** everyone

A single CLI that runs every scenario against the *running stack* — real HTTP, real Postgres, real Kafka, real container kills — and prints a PASS/FAIL board. It is not a unit test suite. It talks to the system the way a user and a failing network do.

Three reasons it is built first, not last:

1. **It is the development feedback loop.** A's ledger is correct when the board is green. Without it, "correct" is a feeling until 14:00.
2. **The invariant checks need no API.** Conservation, drift and append-only are pure SQL. C can build and verify them at 10:30 while A is still writing `TransferService`.
3. **It is the demo.** Beat 8 of the demo script is this board going green on stage, live. A green board with 70 scenarios beats any feature you could build with the same hour.

---

## 1. The design principle that makes it cheap

**Every scenario asserts the money invariants automatically. Scenarios only assert their own specific behaviour.**

The runner wraps every scenario:

```
  snapshot invariants  ->  run scenario  ->  scenario assertions
                                          ->  UNIVERSAL assertions  <- always, free
```

The universal assertions, after every single scenario:

| Invariant | Check |
|---|---|
| Conservation | `SELECT SUM(amount) FROM ledger.entries` = 0 |
| No drift | `ledger.v_balance_drift` returns 0 rows |
| No negative | `ledger.v_negative_accounts` returns 0 rows |
| Every txn balances | no `txn_id` with fewer than 2 legs or a non-zero sum |
| Append-only | `UPDATE ledger.entries` as `txn_svc` is denied |

This is what makes 70 scenarios affordable. A new scenario is ten lines, and it inherits five correctness proofs for free. It also means a bug in `TransferService` is caught by *whichever scenario runs next*, not only by the one written to look for it.

The final line of the report — **"conservation held across all 72 scenarios"** — is the single strongest sentence in the demo.

---

## 2. Layout

```
sim/
  run.ts                 CLI: --only, --tag, --reset, --json, --bail
  harness/
    client.ts            typed API client; every call returns {status, body, ms}
    invariants.ts        the five universal checks (pure SQL, no API)
    seed.ts              deterministic personas + ephemeral account factory
    chaos.ts             container control + client-side abort injection
    report.ts            terminal board, JSON out, exit code
  scenarios/
    happy.ts  idempotency.ts  validation.ts  concurrency.ts
    hold.ts   reversal.ts     requests.ts    dispute.ts
    cache.ts  chaos.ts        auth.ts        limits.ts
```

### Scenario shape

```ts
export const IDEM_02: Scenario = {
  id: 'IDEM-02',
  name: 'Concurrent double-tap with one key debits exactly once',
  tags: ['idempotency', 'concurrency', 'tier1'],

  async run(ctx) {
    const [rahim, karim] = await ctx.freshUsers(2);
    const key    = ctx.uuid();
    const before = await ctx.balance(rahim);

    // 10 parallel requests, same idempotency key
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        ctx.transfer(rahim, karim, 250_000, { key })));

    ctx.expect(results.every(r => r.status < 300), 'all 10 accepted');
    ctx.expectAllIdentical(results.map(r => r.body.transaction.ref));
    ctx.expectEq(await ctx.balance(rahim), before - 250_000, 'exactly one debit');
    ctx.expectEq(await ctx.countTxns({ ref: results[0].body.transaction.ref }), 1);
  }
};
```

No universal invariant assertions in the body. The runner adds them.

### Isolation: ephemeral accounts, not database resets

`ctx.freshUsers(n)` registers users with unique generated phone numbers. Scenarios never collide, can run in parallel, and no reset is needed between them. Conservation is a *global* invariant, so accumulated data from earlier scenarios does not weaken it — it strengthens it.

The named personas — **Rahim, Karim, Alam, Nadia** — are seeded once and used only by scenarios whose output is read aloud during the demo, so the board's language matches the demo script.

`--reset` truncates and re-seeds for a clean run immediately before the demo.

---

## 3. Simulating the network cut

This is the part that separates the harness from a test suite. Three mechanisms, in increasing cost:

### 3.1 Client-side abort — free, and the most important one

```ts
// The user's phone loses signal AFTER the request left. The server still
// processes it. The client never learns the outcome.
async abortAfter(ms: number, fn: (signal: AbortSignal) => Promise<any>) {
  const ac = new AbortController();
  setTimeout(() => ac.abort(), ms);
  try { return { aborted: false, res: await fn(ac.signal) }; }
  catch { return { aborted: true }; }
}
```

**The assertion here is subtle and must be written correctly.** After an abort, the server may or may not have committed. When the client retries with the same idempotency key, the correct assertion is:

> the sender was debited **exactly once** — either the original committed and the retry replayed it, or the original never committed and the retry executed it.

Both outcomes are correct. Asserting "the first one won" would be wrong and would produce a flaky test that erodes trust in the board.

### 3.2 Container pause — a black hole

```bash
docker compose pause postgres     # SIGSTOP: connections hang, no RST
docker compose unpause postgres
```

Freezes the process without closing sockets, so the client hangs until timeout — this is what a real network partition looks like, and it behaves differently from a crash. Use it to check that a stalled transfer leaves nothing partially written and that the pool recovers.

### 3.3 Container kill and restart — a crash

```bash
docker compose kill txn-service && docker compose up -d txn-service
docker compose kill redpanda    && docker compose up -d redpanda
docker network disconnect pstu_default redpanda   # true partition
```

`chaos.ts` wraps these as `chaos.kill('redpanda')`, `chaos.pause('postgres', 3000)`, `chaos.waitHealthy('txn-service')`.

**Toxiproxy** would add latency, bandwidth limits and packet slicing. It is the proper tool and it is another container plus wiring. Skip it unless Phase 3 is ahead of schedule — the three mechanisms above cover every failure the judges will ask about.

### 3.4 Config that makes timing testable

The 60-second undo window makes hold scenarios unusable in a test run. Read these from env:

```
UNDO_WINDOW_SECONDS=60     # simulator sets 3
SWEEPER_INTERVAL_MS=1000   # simulator sets 250
```

Everything else (daily limit, velocity) triggers fast enough with real values — do not parameterise what you do not have to.

---

## 4. Scenario catalog

**Tier 1** is the minimum credible board and must exist by 13:00. **Tier 2** is the target. **Tier 3** is upside.

### LEDGER — runs standalone and after every scenario · Tier 1
| ID | Scenario |
|---|---|
| `LED-01` | Conservation: `SUM(entries) = 0` |
| `LED-02` | No cached balance drifts from its ledger-derived balance |
| `LED-03` | No non-mint account is negative |
| `LED-04` | Every transaction has at least 2 legs summing to zero |
| `LED-05` | `UPDATE ledger.entries` as `txn_svc` is denied |
| `LED-06` | `DELETE FROM ledger.entries` as `txn_svc` is denied |
| `LED-07` | Hand-inserted single unbalanced leg is rejected at COMMIT |

### HAPPY — Tier 1
| ID | Scenario |
|---|---|
| `HAP-01` | Register mints exactly Tk 100,000 from `SYSTEM_MINT` as a real 2-leg txn |
| `HAP-02` | Transfer debits sender and credits receiver by the same amount |
| `HAP-03` | Both parties see the transfer in history with correct direction |
| `HAP-04` | Transaction detail returns both legs, summing to zero |
| `HAP-05` | Request then pay: requester credited, request state `PAID` |
| `HAP-06` | `SYSTEM_MINT` is negative by exactly the total minted |

### IDEMPOTENCY — Tier 1
| ID | Scenario |
|---|---|
| `IDEM-01` | Same key twice sequentially: one debit, identical response body |
| `IDEM-02` | Same key x10 concurrently: one debit |
| `IDEM-03` | Same key, different amount: `422 IDEMPOTENCY_KEY_REUSE` |
| `IDEM-04` | **User B replaying user A's key gets B's own result, never A's** |
| `IDEM-05` | Abort mid-request, retry same key: exactly one debit |
| `IDEM-06` | Step-up retry after `403` reuses key: one debit |

`IDEM-04` is the data-leak test. A globally-unique idempotency key would let one user read another's transaction response by guessing it.

### VALIDATION — Tier 1
| ID | Scenario |
|---|---|
| `VAL-01` | Transfer exceeding balance: `402`, **zero entries written** |
| `VAL-02` | Amount `0`: `400` |
| `VAL-03` | Negative amount: `400` |
| `VAL-04` | Self-transfer: `422` |
| `VAL-05` | Unknown recipient: `404` |
| `VAL-06` | Frozen sender cannot send: `403` |
| `VAL-07` | **Frozen account can still receive**: `201` |
| `VAL-08` | Float amount (`250.5`) rejected, never truncated |

### CONCURRENCY — Tier 1 (this is where real bugs live)
| ID | Scenario |
|---|---|
| `CON-01` | A to B and B to A simultaneously x100: **zero deadlocks** |
| `CON-02` | N concurrent sends from one account totalling more than its balance: only the affordable ones succeed, balance never negative |
| `CON-03` | Ring: 200 accounts, 5,000 concurrent transfers, supply unchanged |
| `CON-04` | Concurrent settle and cancel on one `HELD` transfer: **exactly one wins** |
| `CON-05` | Two concurrent reversals of one txn: one succeeds, other `409` |
| `CON-06` | Two payers race to pay one request: one payment |
| `CON-07` | Concurrent decline and pay on one request: exactly one wins |

`CON-04` and `CON-05` are the CAS tests. If state transitions were written as read-check-write instead of a conditional `UPDATE`, these fail — and they are the only thing that will catch it.

### HOLD / UNDO — Tier 2 (skip entirely if the HELD flow did not ship)
| ID | Scenario |
|---|---|
| `HLD-01` | Above threshold: `202 HELD`, sender debited **immediately**, receiver not yet credited |
| `HLD-02` | Cancel inside window: sender refunded, conserved at every instant |
| `HLD-03` | Sweeper settles after window: receiver credited |
| `HLD-04` | Cancel after settle: `409 INVALID_STATE` |
| `HLD-05` | Held money cannot be double-spent — send the full balance while a hold is open: `402` |

`HLD-05` is the one that proves the HOLD account design. Without it, "the money cannot be double-spent" is a claim.

### REVERSAL — Tier 2
| ID | Scenario |
|---|---|
| `REV-01` | Reversal creates a **new** txn; the original row is byte-identical afterwards |
| `REV-02` | Second reversal: `409` (unique index, not an `if`) |
| `REV-03` | Receiver already spent it: `402`, no money fabricated |
| `REV-04` | Reversal of a reversal: blocked |

### CHAOS — Tier 2
| ID | Scenario |
|---|---|
| `CHA-01` | Kill txn-service mid-load, restart: invariants hold, no txn stuck mid-write |
| `CHA-02` | Pause Postgres mid-transfer: client errors, **nothing partially written** |
| `CHA-03` | **Kill Redpanda: transfers still commit**, outbox backs up |
| `CHA-04` | Restart Redpanda: outbox drains to zero, notifications arrive |
| `CHA-05` | Kill the outbox relay mid-drain: no event published twice |
| `CHA-06` | Redeliver a consumed Kafka message: **no duplicate notification** |

`CHA-03` and `CHA-04` together *are* the architecture argument. They are the most persuasive fifteen seconds available in the demo.

### AUTH — Tier 2
| ID | Scenario |
|---|---|
| `AUTH-01` | Refresh rotation issues a new token and consumes the old |
| `AUTH-02` | **Replaying a consumed refresh token revokes the whole family** |
| `AUTH-03` | 5 wrong PINs: `423 ACCOUNT_LOCKED` |
| `AUTH-04` | `logout-all` invalidates outstanding access tokens via `token_version` |
| `AUTH-05` | Same TOTP code twice inside one 30s window: second rejected |

### DISPUTE — Tier 2
| ID | Scenario |
|---|---|
| `DIS-01` | Sender raises a dispute: state `OPEN`, **no money moves** |
| `DIS-02` | Receiver may also raise one on the same transaction type |
| `DIS-03` | Second dispute while one is open: `409 DISPUTE_ALREADY_OPEN` |
| `DIS-04` | A non-party raising a dispute: `403 NOT_A_PARTY` |
| `DIS-05` | Transaction older than 7 days: `422 DISPUTE_WINDOW_CLOSED` |
| `DIS-06` | Admin `REVERSE`: reversal txn created, original untouched, dispute `REVERSED` |
| `DIS-07` | **Admin `REVERSE` when the receiver already spent it: `402`, dispute stays `OPEN`, `attempts` incremented, no partial write** |
| `DIS-08` | Admin `REJECT`: dispute `REJECTED`, zero entries written |
| `DIS-09` | Resolve without `resolution` text: rejected by the DB constraint |
| `DIS-10` | Two admins resolve the same dispute concurrently: exactly one wins |
| `DIS-11` | Every resolution wrote an `audit_log` row with before/after |

`DIS-07` is the one worth writing first. It is the only scenario that proves the system refuses to fabricate money, and it exercises a full rollback across three tables.

### CACHE — Tier 2
| ID | Scenario |
|---|---|
| `CACHE-01` | Cached history matches an uncached read of the same query exactly |
| `CACHE-02` | Transfer bumps the user's version; the next read is fresh, not stale |
| `CACHE-03` | **Redis killed mid-run: every read still succeeds** from Postgres, `X-Cache: MISS` |
| `CACHE-04` | Redis restarted: reads repopulate, no wrong values served during recovery |
| `CACHE-05` | **Stale-write race** — hold a read open, bump the version, let the read write; assert the next read does **not** see the stale rows |
| `CACHE-06` | Balance endpoint is never served from cache (`X-Cache: BYPASS`) |
| `CACHE-07` | Duplicate Kafka delivery double-INCRs the version: harmless, reads stay correct |

`CACHE-05` is the whole justification for version-keyed reads. Write it as: read version `v`, start a history query, `INCR` the version out of band, let the query finish and write to key `v`, then read again and assert freshness. With a `DEL`-based cache this scenario **fails** — which is exactly why it exists.

### LIMITS — Tier 3
`LIM-01` daily cap enforced · `LIM-02` remaining allowance is accurate · `LIM-03` more than 10 txn/min returns `429` · `LIM-04` limit resets at local midnight

### SCALE — Tier 3
`SCL-01` `EXPLAIN` shows partition pruning on a date-ranged query · `SCL-02` keyset pagination returns no duplicates and no gaps across the full history · `SCL-03` `commit_delay` on vs off, both TPS numbers printed

---

## 5. Report

```
  PSTU Money Movement — Scenario Simulator          2026-08-29 13:22
  ------------------------------------------------------------------
  LEDGER INVARIANTS                                          7/7  PASS
    OK  LED-01  conservation                        SUM = 0 paisa
    OK  LED-02  no balance drift                    214/214 accounts
    OK  LED-05  ledger is append-only               UPDATE denied

  HAPPY PATH              6/6  PASS      REVERSAL          4/4  PASS
  IDEMPOTENCY             6/6  PASS      DISPUTE          11/11 PASS
  VALIDATION              8/8  PASS      CACHE             7/7  PASS
  CONCURRENCY             7/7  PASS      CHAOS             6/6  PASS
  HOLD / UNDO             5/5  PASS      AUTH              5/5  PASS
  ------------------------------------------------------------------
  72 passed  0 failed  78.9s

  CON-03  5,000 concurrent transfers   1,840 tps   p95 24ms   0 deadlocks
  Conservation held across all 72 scenarios.
```

A failure prints the scenario id, the assertion that failed, expected vs actual, and **the invariant snapshot before and after** — so a conservation break points at the scenario that caused it rather than the one that noticed it.

`--json` writes `sim-results.json`. Exit code is the failure count, so it can gate a commit if you want it to.

**Serve it:** `POST /admin/simulator/run` streams the same board to the admin UI. Running it from a button on stage is better than running it from a terminal, and it costs about ten minutes.

---

## 6. Schedule

The harness is built *alongside* the features, never as a phase. Each scenario is ten lines once the harness exists.

| When | C builds | Unblocked by |
|---|---|---|
| 10:30–11:10 | `invariants.ts`, `seed.ts`, `report.ts`, runner | nothing — pure SQL |
| 11:10–11:30 | `client.ts` against `API.md` shapes | `API.md` only |
| 12:00 | LED + HAP + IDEM + VAL green | A's checkpoint |
| 12:00–13:00 | CON, HLD, REV, DIS, CACHE added as features land | each feature |
| 13:00–13:45 | CHAOS, AUTH, `--reset`, admin endpoint | Phase 3 |

**Hard budget: 90 minutes of C's day, total.** If the board has Tier 1 green by 13:00 and nothing else, that is a complete result. A simulator that eats the afternoon has failed at its job even if every scenario passes.

### Two failure modes to avoid

- **Do not chase flaky scenarios.** A test that fails intermittently on timing is worse than no test — it teaches the team to ignore red. Delete it or make it deterministic (`UNDO_WINDOW_SECONDS=3` rather than `sleep(60)`).
- **Do not let the board go red and stay red.** The moment a scenario fails and someone says "we will fix it later", the board stops being a signal. Either fix it or delete the scenario.

---

## 7. In the demo

Beat 8: run `--reset` beforehand so the board is clean, then run it live on stage. Let it stream. The three lines to read aloud when it finishes:

1. *"Seventy-two scenarios, including nine that kill containers mid-transaction."*
2. *"Five thousand concurrent transfers, zero deadlocks, total supply unchanged."*
3. *"Conservation held across all of them."*

Then open `/admin/integrity` — the same invariant, checked one more time, live.
