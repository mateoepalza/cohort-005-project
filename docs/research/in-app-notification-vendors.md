# In-app notification vendors: Knock, Novu, Courier, MagicBell, SuprSend

Research for issue #3 (map #2, "In-app notifications spec"). It was checked on **2026-11-14** against vendor docs, pricing pages, GitHub and npm. Pricing and plan limits change often, so re-check them before signing up.

Scope: Cadence wants **in-app only** for v1, run by a third party, with email possibly added later. Recipients are Student, Instructor, Platform Admin and Team Admin. Cadence's stack is React Router 7, TypeScript and Node.

This note doesn't pick a vendor. A later ticket makes that decision.

## Summary table

| | Knock | Novu | Courier | MagicBell | SuprSend |
|---|---|---|---|---|---|
| **Feed storage** | Hosted by Knock. Feed items stay available indefinitely, while message logs are kept 30 days (90 on Enterprise) [K4] | Hosted by Novu Cloud, or in your own MongoDB if self-hosted [N4] | Hosted by Courier. Inbox retention isn't documented; message logs are kept 30 days (365 on Enterprise) per Courier's blog [C6] | Hosted by MagicBell. Retention isn't documented | Hosted by SuprSend, which manages read, seen and archive state [S3] |
| **React components** | `@knocklabs/react` 0.15.1: `NotificationFeedPopover`, `NotificationFeed`, `NotificationIconButton` (bell), plus headless hooks [K2] | `@novu/react` 3.19.2: `Inbox`, `Bell`, `Notifications`, `Preferences`, and React 18+ [N1] | `@trycourier/courier-react` 9.3.5: `CourierInbox`, toasts, preference center, and React 18+ (a React 17 variant exists) [C2] | `@magicbell/react` 1.14.0: `FloatingInbox`, `Inbox`, `UserPreferences`, `ToastContainer` [M2] | `@suprsend/react` 1.5.0: drop-in inbox and toasts, or headless. `@suprsend/react-inbox` has reached end of support [S2] |
| **Read state** | `unseen` → `seen` → `read`, plus `archived`. Clicks fire `interacted` [K3] | Read/unread with unread count, plus archive. Snooze is Cloud-only [N1][N5] | Read, opened and archived, synced across devices. Tabs come from message tags [C2][C4] | Read/unread, archive and delete [M5] | Read, seen and archived [S3] |
| **Preferences** | Per-user `PreferenceSet` covering channel types, categories and workflows, with hooks and a hosted preference center [K5] | Global, per-workflow and per-channel levels. Critical workflows can't be muted. Built-in UI in `<Inbox>` [N6] | Preference center using `read/write:preferences` token scopes [C3] | Per category × channel, through the `UserPreferences` component [M2][M5] | User preferences only on the **Business** plan ($250/mo) and above [S1] |
| **Real time** | WebSocket, managed by the SDK [K6] | WebSocket (`wss://…socket.novu.co`) [N2] | Real-time socket. `signOut` disconnects it [C3] | "Persistent connection", protocol not named [M5] | Socket connection via `initializeSocketConnection()` [S5] |
| **Node SDK / trigger** | `@knocklabs/node` 1.41.1 (Apache-2.0). Triggers a workflow with `recipients` and `data`. Supports inline identify, `Idempotency-Key` and `cancellation_key` [K7] | `@novu/api` 3.19.1. `novu.trigger({ workflowId, to: { subscriberId, … }, payload })`, with inline subscriber upsert [N3] | `@trycourier/courier` 10.0.0 (Apache-2.0, Node 20+). `client.send.message({ message: { to: { user_id }, template, data, routing: { channels: ["inbox"] } } })` plus `profiles.create`. Supports idempotency keys [C5][C4] | `magicbell-js` 1.8.0. `client.broadcasts.createBroadcast({ title, content, actionUrl, category, topic, recipients })` and `users.saveUser` [M4] | `@suprsend/node-sdk` 1.15.1 (MIT). `workflows.trigger(WorkflowTriggerRequest)` with up to 100 recipients and inline upsert by `distinct_id` [S6] |
| **Client identity** | Public key + `userId`. **Enhanced security mode** requires an RS256 JWT (`sub` = user id) signed by your backend. It's off by default [K1] | `applicationIdentifier` + `subscriberId`. **HMAC-SHA256** `subscriberHash` from the secret key, which must be switched on per environment [N2] | Backend calls `POST /auth/issue-token` for a JWT scoped `user_id:<id> inbox:read:messages inbox:write:events`. Always set `expires_in`, because without it the token never expires [C3] | Backend signs an **HS256** user JWT (`user_external_id` / `user_email` + `api_key`) with the project secret [M3] | Backend signs an **ES256** JWT (`entity_type: subscriber`, `entity_id: distinct_id`). Enhanced Security Mode must be on (it's off in Sandbox) [S4] |
| **Email later** | Yes, as another channel step in the workflow | Yes, with all channels on the free plan [N0] | Yes, via template channels and routing (one send can cover several channels) [C0] | Yes, as an email channel [M1] | Yes, but you bring your own ESP (SendGrid etc.) [S1] |
| **Free tier** | 10k messages/mo, with no hard cap [K0] | 10k workflow runs/mo, 5 workflows, 24 h activity retention, Novu branding [N0][N2] | 10k sends/mo [C0] | 1k deliveries/mo, 1 project [M0] | 10k notifications/mo, SuprSend branding in the feed [S1] |
| **Smallest paid plan** | Starter **$250/mo** for 50k messages, then $0.005 each [K0] | Pro **from $30/mo** for 30k runs, then $1.20 per 1k [N0] | Business is pay-as-you-go: **$0.005/send from the first send** (50k = $250) [C0] | Startup **$249/mo** for 50k deliveries, then $0.0025 each [M0] | Essentials **$100/mo** for 50k (no preferences); Business $250/mo [S1] |
| **What's billed** | One message to one user on one channel, so in-app counts. Messages suppressed by preferences aren't billed [K0] | A workflow run (definition not captured) [N0] | One template to one recipient, even across several channels [C0] | Per delivery per channel [M0] | Each channel counts separately. Digests count as one [S1] |
| **Data residency / PII** | GDPR (DPA, SCCs) and SOC 2 Type II [K8]. **No EU region found** in Knock's docs. A competitor blog says it's planned for end of 2026 (unverified) | **US and EU (Frankfurt) on Free.** More regions on Enterprise [N0][N2] | **EU datacenter (Ireland) on Business**, with separate EU API hosts [C0][C3][C6] | GDPR claimed, DPA available. **Hosting region not stated** [M6] | US or EU residency per workspace [S7] |
| **Self-host** | No offering found | Yes: **Community edition** (MIT outside `enterprise/`), which needs MongoDB, Redis and S3. Inbox works there; snooze and branding removal don't [N4][N5][N7] | No offering found | No (MagicBell's own blog table) [M7] | Yes, but **Enterprise only** (self-hosted or BYOC) [S1][S7] |
| **Test / local mode** | Development and production environments with separate data. Sandbox mode exists but **isn't available for in-app channels** [K9] | Development and production environments (custom ones on Team+). Self-hosting can serve as a local stand-in [N8] | Test and Production environments with separate keys. A **Mock** key type is Enterprise only [C7] | Not documented (separate projects) | Sandbox, Staging and Production workspaces. Test Mode limits delivery to internal testers [S7] |

## Per-vendor notes

### Knock
- It is a workflow engine: you trigger a workflow and its steps fan out to channels. In-app feed is one channel type. Each feed message is immutable once generated, and only its status can change [K3].
- Security: enhanced security mode is off by default, so anyone with the public key can read any user's feed until you switch it on. Knock's docs warn you to switch it on before launch. Tokens can carry grants scoped to tenants and objects. `onUserTokenExpiring` handles refresh [K1].
- Cost: the free plan doesn't hard-cap usage, but the first paid tier is $250/mo, which is a big step up [K0].
- Gap: no published EU region, which matters if Cadence has EU users.

### Novu
- It is the only vendor with a **genuinely self-hostable, MIT-licensed** core. The repo's `LICENSE` puts `enterprise/packages` under a proprietary licence and everything else under MIT. The current release is `@novu/framework@v2.14.0` (2026-09-28) [N7]. Self-hosting is heavy, though: MongoDB, Redis (with AOF) and object storage [N4].
- Cheapest entry to paid ($30/mo), and EU region on the free plan [N0].
- For EU, both the client (`apiUrl`, `socketUrl`) and the server SDK (`serverURL`) must point at `eu.*` hosts [N2][N3].
- The free plan keeps the activity feed for only 24 hours, which is the debugging log, not the inbox [N0].

### Courier
- Pricing is pure pay-per-send. Once you add a card, **every** send is billed, including the first 10k. The page says that at 50k sends/mo you pay about the same as Knock or MagicBell's entry tier [C0].
- A send is "one template to one recipient", so adding email to an in-app template later doesn't double the bill. This differs from Knock, MagicBell and SuprSend, which bill per channel [C0].
- Inbox auth uses scoped JWTs. If you leave out `expires_in`, you get a token that never expires [C3].
- Tenant scoping (`tenantId` on sign-in, `context.tenant_id` on send) could map to Cadence Teams [C4].

### MagicBell
- It is inbox-first: you send a "broadcast" with title, content, actionUrl and category. There's less of a workflow engine than the others [M4].
- Has the smallest free tier (1k deliveries) [M0].
- Data residency, SOC 2 and the real-time transport aren't stated on its public pages [M5][M6]. You'd need to ask MagicBell sales.
- The doc examples use 1-year user JWTs. That's your choice, not a requirement [M3].

### SuprSend
- Cheapest paid tier is $100/mo, but **preferences, digest and i18n start at Business ($250/mo)** [S1].
- Has the most explicit environment model (Sandbox / Staging / Production, with a Test Mode that sends only to internal testers) [S7].
- Email requires your own ESP account [S1].
- Watch out: if the JWT `entity_id` doesn't match the `distinct_id` used when triggering, the inbox renders empty with no error [S4].

## Trade-offs worth weighing (not a decision)

- **Lock-in vs control:** Novu is the only option where Cadence could later run the same stack itself without an Enterprise contract. Every other vendor is SaaS only, or self-hosted only on Enterprise.
- **EU data:** Novu (free plan), Courier (Business) and SuprSend (per workspace) document EU residency. Knock and MagicBell don't publish an EU region.
- **Cost at small scale:** all five are free up to their limits (MagicBell is the lowest at 1k). Paid entry ranges from about $30 (Novu) to $250 (Knock, MagicBell, SuprSend Business), and Courier charges by usage.
- **Adding email later:** all five support it. Courier bills one send per template however many channels it uses; the others bill per channel.
- **Local dev/testing:** none offers a local emulator for in-app. Cadence will likely need its own fake or no-op adapter for tests either way. Knock's sandbox mode explicitly excludes in-app.
- **Secure identity:** all five support backend-signed identity: JWT (Knock RS256, Courier, MagicBell HS256, SuprSend ES256) or HMAC (Novu). Knock, Novu and SuprSend need it switched on explicitly.

## Couldn't verify

- Knock: whether an EU region exists or is coming. The only claim is from a Courier blog [C6].
- Knock and Courier: how long inbox items are kept beyond the log retention.
- Novu: exactly what counts as a "workflow run" (the FAQ answer wasn't captured).
- MagicBell: hosting region, retention, real-time protocol, test mode and SOC 2.
- SuprSend: retention, and whether "multi-region" includes APAC.
- Courier: whether inbox-only messages count as a "send". Its "one template to one recipient" definition suggests they do.

## Sources

- [K0] https://knock.app/pricing
- [K1] https://docs.knock.app/in-app-ui/security-and-authentication
- [K2] https://docs.knock.app/in-app-ui/react/overview
- [K3] https://docs.knock.app/integrations/in-app/knock
- [K4] https://docs.knock.app/manage-your-account/data-retention
- [K5] https://docs.knock.app/concepts/preferences
- [K6] https://docs.knock.app/in-app-ui/javascript/overview
- [K7] https://docs.knock.app/send-notifications/triggering-workflows/api ; https://github.com/knocklabs/knock-node (v1.41.1, 2026-11-10)
- [K8] https://knock.app/legal/data-processing-addendum ; https://knock.app/blog/gdpr-announcement
- [K9] https://docs.knock.app/concepts/environments
- [N0] https://novu.co/pricing
- [N1] https://docs.novu.co/platform/inbox/overview
- [N2] https://docs.novu.co/platform/inbox/prepare-for-production
- [N3] https://docs.novu.co/platform/sdks/server/typescript
- [N4] https://docs.novu.co/community/self-hosting-novu/overview
- [N5] https://docs.novu.co/community/self-hosted-and-novu-cloud
- [N6] https://docs.novu.co/platform/inbox/configuration/preferences
- [N7] https://github.com/novuhq/novu (LICENSE)
- [N8] https://docs.novu.co/platform/concepts/environments
- [C0] https://www.courier.com/pricing (page published 2026-11-12)
- [C2] https://www.courier.com/docs/platform/inbox/inbox-overview
- [C3] https://www.courier.com/docs/platform/inbox/authentication
- [C4] https://www.courier.com/docs/in-app/send-to-the-inbox
- [C5] https://www.courier.com/docs/sdk-libraries/node ; https://github.com/trycourier/courier-node (v10.0.0, 2026-10-29)
- [C6] https://www.courier.com/blog/eu-data-residency-notifications (a Courier blog. Its claims about competitors are secondary)
- [C7] https://courier.com/docs/platform/workspaces/environments-api-keys
- [M0] https://www.magicbell.com/pricing
- [M1] https://www.magicbell.com/docs
- [M2] https://www.magicbell.com/docs/libraries/magicbell-react
- [M3] https://www.magicbell.com/docs/api/authentication/user
- [M4] https://www.magicbell.com/docs/libraries/magicbell-js
- [M5] https://www.magicbell.com/docs/channels/in_app
- [M6] https://www.magicbell.com/security
- [M7] https://www.magicbell.com/blog/firebase-cloud-messaging-service-alternatives
- [S1] https://www.suprsend.com/pricing
- [S2] https://docs.suprsend.com/docs/inbox-react
- [S3] https://docs.suprsend.com/docs/inbox-overview
- [S4] https://docs.suprsend.com/docs/client-authentication ; https://docs.suprsend.com/docs/react-inbox-integration
- [S5] https://docs.suprsend.com/docs/js-inapp-feed
- [S6] https://docs.suprsend.com/docs/node-trigger-workflow-from-api ; https://docs.suprsend.com/docs/users
- [S7] https://www.suprsend.com/enterprise ; https://docs.suprsend.com/docs/what-is-suprsend
- npm versions checked 2026-11-14 with `npm view`.
