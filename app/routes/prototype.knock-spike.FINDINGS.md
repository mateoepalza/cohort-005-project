# PROTOTYPE findings: Does Knock hold up against Cadence?

Throwaway spike for https://github.com/mateoepalza/cohort-005-project/issues/34.
Run it with `npm run dev`, then open `/prototype/knock-spike` and pick a user in the DevUI.
It needs the Knock keys in `.env` (see issue 30) and two workflows committed in Knock Development:
`discussion-reply` and `new-enrollment`, each with one in-app feed step.

## Results (2026-11-14, Knock Development, @knocklabs/node 1.41.1, @knocklabs/client 0.23.1)

1. **Signed user tokens: pass.**
   - `signUserToken(String(userId))` reads `KNOCK_SIGNING_KEY` from the environment by default. With that token, the feed for the same user returns 200.
   - With no token, the feed returns 400 `missing_user_token`.
   - User 2's token on user 1's feed returns 403 `authorization`.
   - The page signs a token in the loader for whoever the DevUI selects, so switching users switches the feed.
   - The page calls `users.update` (identify) for the recipient and the actor before each trigger. Knock needs the user to exist for `actor.name` to show in templates.
2. **Triggering: pass.**
   - `knock.workflows.trigger(key, { recipients, actor, data })` returns a `workflow_run_id`.
   - The message is delivered to the in-app feed channel within a couple of seconds.
   - A workflow that hasn't been committed returns 404 "workflow not found… commit the workflow".
3. **Headless feed API: pass.** It was exercised through `@knocklabs/client` with the signed token.
   - `feed.fetch()` and `getState()` return the items plus `{ total_count, unread_count, unseen_count }`.
   - `markAsSeen`, `markAsRead`, `markAsUnread`, `markAllAsSeen` and `markAllAsRead` all update the counts correctly.
   - The bulk operations are async; they settled within about 2s.
   - Realtime updates are available through `feed.listenForUpdates()`.
4. **Preferences: pass, at the workflow level.** Category-level and environment-default behaviour were not exercised.
   - A user can set preferences client-side with their signed token, using `knock.user.setPreferences(...)`.
   - A recipient preference of `workflows: { "new-enrollment": false }` blocks delivery.
   - A `categories: { new_enrollment: … }` preference had no effect, because the dashboard workflows were created without categories (messages carry `categories: []`). A category only matches workflows tagged with it.
   - "Off by default" depends on Knock's environment default preference set, which is set in the dashboard or through the management API. It wasn't configured during the spike.
