# Assignment: DeepSeek — Round 3: Remaining Demo UI States

## Previous rounds — complete

The core Kinetic Ledger screen set, reputation indicators, LOW-reputation
step-up state, frozen Dashboard, and linked REVERSAL history row are complete
and logged in `BUILD_LOG_DEEPSEEK.md`.

Continue in Stitch project **Ledger Flow Money Movement**
(`12103859305734439630`) and keep backend/frontend code untouched.

## 1. Notification feed

Design the P2 notification feed from `UI_SPEC.md` §10:

- unread/read states and an unread Dashboard indicator;
- transaction received/sent, request, reversal, and limit-warning examples;
- tap target leading to the relevant transaction/request;
- empty state and concise event timestamps.

Keep this honest as a design state: the Kafka consumer is still deferred, so
do not describe the event pipeline as currently live.

## 2. Duplicate-send guard warning

Add the deferred warning state to Send Money confirmation. It must reuse the
existing inline warning/step-up placement and clearly distinguish:

- retrying the same idempotency key (safe replay), and
- a genuinely new, similar transfer that may be accidental.

Do not add a new modal or compete visually with the recipient and amount.

## 3. Admin simulator presentation

Design the admin-side simulator results state as a presentation surface, not a
new backend promise: grouped pass/fail counts, conservation summary, failing
scenario IDs, and a clear note that execution is launched by the demo/operator
until an API trigger exists.

## 4. Canonical-screen cleanup record

Recheck the duplicate Transaction History and Request Money screens noted in
the last build log. If Stitch still cannot delete them, explicitly mark the
canonical IDs in `UI_SPEC.md` and the build log so frontend implementation
cannot select the wrong screen.

## Deliverables and verification

- Confirm every changed screen with `get_screen`.
- Update only `UI_SPEC.md` and `BUILD_LOG_DEEPSEEK.md` in git.
- Add screen IDs beside each touched spec section.
- Log remaining manual cleanup or connector limitations.

## Out of scope

TOTP enrolment remains deferred because the backend does not ship TOTP.
Do not touch `apps/api/**`, `frontend/**`, `sim/**`, or infra.
