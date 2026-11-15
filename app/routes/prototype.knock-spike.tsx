// PROTOTYPE — throwaway Knock spike for "Does Knock hold up against Cadence?"
// (https://github.com/mateoepalza/cohort-005-project/issues/34). Not production
// code: no tests, minimal error handling. Lives on a research branch only.
import { useEffect, useRef, useState } from "react";
import { Form, useActionData, useNavigation } from "react-router";
import { Knock as KnockNode, signUserToken } from "@knocklabs/node";
import { and, eq, isNull, desc } from "drizzle-orm";
import type { Route } from "./+types/prototype.knock-spike";
import { db } from "~/db";
import { comments, courses, lessons, modules, users } from "~/db/schema";
import { getCurrentUserId } from "~/lib/session";

try {
  process.loadEnvFile?.(".env");
} catch {}

const knockServer = () => new KnockNode({ apiKey: process.env.KNOCK_API_KEY });

async function identify(userId: number) {
  const u = db.select().from(users).where(eq(users.id, userId)).get();
  if (!u) throw new Error(`No user ${userId}`);
  await knockServer().users.update(String(u.id), {
    name: u.name,
    email: u.email,
  });
  return u;
}

export async function loader({ request }: Route.LoaderArgs) {
  const userId = await getCurrentUserId(request);
  const questions = db
    .select({
      id: comments.id,
      authorId: comments.userId,
      authorName: users.name,
      lessonTitle: lessons.title,
      courseTitle: courses.title,
    })
    .from(comments)
    .innerJoin(users, eq(users.id, comments.userId))
    .innerJoin(lessons, eq(lessons.id, comments.lessonId))
    .innerJoin(modules, eq(modules.id, lessons.moduleId))
    .innerJoin(courses, eq(courses.id, modules.courseId))
    .where(isNull(comments.parentId))
    .orderBy(desc(comments.id))
    .limit(15)
    .all();
  const courseList = db
    .select({
      id: courses.id,
      title: courses.title,
      instructorId: courses.instructorId,
      instructorName: users.name,
    })
    .from(courses)
    .innerJoin(users, eq(users.id, courses.instructorId))
    .all();

  if (!userId) {
    return { user: null, questions, courseList, auth: null };
  }
  const user = await identify(userId);
  const userToken = await signUserToken(String(userId), {
    expiresInSeconds: 3600,
  });
  return {
    user: { id: user.id, name: user.name, role: user.role },
    questions,
    courseList,
    auth: {
      publicKey: process.env.KNOCK_PUBLIC_API_KEY!,
      feedChannelId: process.env.KNOCK_FEED_CHANNEL_ID!,
      userToken,
    },
  };
}

export async function action({ request }: Route.ActionArgs) {
  const actorId = await getCurrentUserId(request);
  if (!actorId) return { error: "Pick a user in the DevUI first" };
  const form = await request.formData();
  const intent = form.get("intent");
  const knock = knockServer();
  await identify(actorId);
  try {
    if (intent === "discussion-reply") {
      const q = db
        .select()
        .from(comments)
        .where(
          and(
            eq(comments.id, Number(form.get("questionId"))),
            isNull(comments.parentId)
          )
        )
        .get();
      if (!q) return { error: "No such Discussion Question" };
      await identify(q.userId);
      const res = await knock.workflows.trigger("discussion-reply", {
        recipients: [String(q.userId)],
        actor: String(actorId),
        data: { question_id: q.id, reply_body: String(form.get("body")) },
      });
      return { ok: `Triggered discussion-reply → user ${q.userId}`, res };
    }
    if (intent === "new-enrollment") {
      const c = db
        .select()
        .from(courses)
        .where(eq(courses.id, Number(form.get("courseId"))))
        .get();
      if (!c) return { error: "No such course" };
      await identify(c.instructorId);
      const res = await knock.workflows.trigger("new-enrollment", {
        recipients: [String(c.instructorId)],
        actor: String(actorId),
        data: { course_title: c.title },
      });
      return { ok: `Triggered new-enrollment → instructor ${c.instructorId}`, res };
    }
  } catch (e) {
    return { error: String(e) };
  }
  return { error: `Unknown intent ${intent}` };
}

type FeedView = {
  items: { id: string; workflow: string; seen: boolean; read: boolean; blocks: string; at: string }[];
  meta: { total_count: number; unread_count: number; unseen_count: number };
};

export default function KnockSpike({ loaderData }: Route.ComponentProps) {
  const { user, questions, courseList, auth } = loaderData;
  const actionData = useActionData<typeof action>();
  const nav = useNavigation();
  const knockRef = useRef<any>(null);
  const feedRef = useRef<any>(null);
  const [feed, setFeed] = useState<FeedView | null>(null);
  const [prefs, setPrefs] = useState<unknown>(null);
  const [log, setLog] = useState<string[]>([]);
  const say = (m: string) => setLog((l) => [`${new Date().toLocaleTimeString()} ${m}`, ...l].slice(0, 30));

  async function refresh() {
    const f = feedRef.current;
    if (!f) return;
    await f.fetch();
    const s = f.getState();
    setFeed({
      meta: s.metadata,
      items: s.items.map((i: any) => ({
        id: i.id,
        workflow: i.source?.key,
        seen: !!i.seen_at,
        read: !!i.read_at,
        blocks: i.blocks?.map((b: any) => b.rendered).join(" ") ?? "",
        at: i.inserted_at,
      })),
    });
  }

  async function loadPrefs() {
    try {
      setPrefs(await knockRef.current.user.getPreferences());
    } catch (e) {
      say(`getPreferences failed: ${e}`);
    }
  }

  useEffect(() => {
    if (!auth || !user) return;
    let cancelled = false;
    (async () => {
      const { default: Knock } = await import("@knocklabs/client");
      const knock = new Knock(auth.publicKey);
      knock.authenticate(String(user.id), auth.userToken);
      const f = knock.feeds.initialize(auth.feedChannelId);
      f.listenForUpdates();
      f.on("items.received.realtime", () => {
        say("realtime: new item arrived");
        refresh();
      });
      knockRef.current = knock;
      feedRef.current = f;
      if (cancelled) return;
      say(`authenticated as user ${user.id} with signed token`);
      await refresh();
      await loadPrefs();
    })().catch((e) => say(`init failed: ${e}`));
    return () => {
      cancelled = true;
      feedRef.current?.teardown?.();
      knockRef.current?.teardown?.();
    };
  }, [user?.id]);

  useEffect(() => {
    if (actionData) setTimeout(refresh, 1500);
  }, [actionData]);

  async function tryUnsigned() {
    const { default: Knock } = await import("@knocklabs/client");
    const k = new Knock(auth!.publicKey);
    k.authenticate(String(user!.id));
    const f = k.feeds.initialize(auth!.feedChannelId);
    try {
      const r = await f.fetch();
      say(`UNSIGNED fetch → ${JSON.stringify(r).slice(0, 200)}`);
    } catch (e) {
      say(`UNSIGNED fetch rejected: ${e}`);
    }
    f.teardown();
  }

  async function setEnrollmentPref(on: boolean) {
    await knockRef.current.user.setPreferences({
      categories: { new_enrollment: { channel_types: { in_app_feed: on } } },
    });
    say(`set new_enrollment.in_app_feed = ${on}`);
    await loadPrefs();
  }

  const act = async (label: string, fn: () => Promise<unknown>) => {
    await fn();
    say(label);
    await refresh();
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6 text-sm">
      <div className="rounded border-2 border-dashed border-amber-500 bg-amber-50 p-4 text-amber-900">
        <h1 className="text-lg font-bold">PROTOTYPE — Does Knock hold up against Cadence?</h1>
        <p>
          Four checks: signed user tokens follow the DevUI user · Node SDK triggers land in the right feed ·
          headless feed API (list / unread / read / seen) · an off-by-default, opt-in preference.
        </p>
      </div>

      {!user || !auth ? (
        <p>Select a user in the DevUI panel.</p>
      ) : (
        <>
          <section className="rounded border p-4">
            <h2 className="font-semibold">1 · Signed user token</h2>
            <p>
              Viewing as <b>{user.name}</b> (id {user.id}, {user.role}). Token: <code>{auth.userToken.slice(0, 32)}…</code>
            </p>
            <button className="mt-2 rounded border px-2 py-1" onClick={tryUnsigned}>
              Try the feed WITHOUT a token (should be rejected)
            </button>
          </section>

          <section className="rounded border p-4 space-y-3">
            <h2 className="font-semibold">2 · Trigger (as {user.name})</h2>
            <Form method="post" className="flex flex-wrap items-center gap-2">
              <input type="hidden" name="intent" value="discussion-reply" />
              Reply to
              <select name="questionId" className="rounded border px-1">
                {questions.map((q) => (
                  <option key={q.id} value={q.id}>
                    Q#{q.id} by {q.authorName} (id {q.authorId}) — {q.courseTitle} / {q.lessonTitle}
                  </option>
                ))}
              </select>
              <input name="body" defaultValue="Great question — here's my answer." className="rounded border px-1" />
              <button className="rounded bg-black px-2 py-1 text-white" disabled={nav.state !== "idle"}>
                Trigger Discussion Reply
              </button>
            </Form>
            <Form method="post" className="flex flex-wrap items-center gap-2">
              <input type="hidden" name="intent" value="new-enrollment" />
              Enroll in
              <select name="courseId" className="rounded border px-1">
                {courseList.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title} → instructor {c.instructorName} (id {c.instructorId})
                  </option>
                ))}
              </select>
              <button className="rounded bg-black px-2 py-1 text-white" disabled={nav.state !== "idle"}>
                Trigger New Enrollment
              </button>
            </Form>
            {actionData && (
              <pre className="overflow-auto rounded bg-gray-100 p-2 text-xs">{JSON.stringify(actionData, null, 2)}</pre>
            )}
          </section>

          <section className="rounded border p-4 space-y-2">
            <h2 className="font-semibold">3 · Headless feed for {user.name}</h2>
            <div className="flex flex-wrap gap-2">
              <button className="rounded border px-2 py-1" onClick={() => act("refreshed", async () => {})}>Refresh</button>
              <button className="rounded border px-2 py-1" onClick={() => act("marked all seen", () => feedRef.current.markAllAsSeen())}>Mark all seen</button>
              <button className="rounded border px-2 py-1" onClick={() => act("marked all read", () => feedRef.current.markAllAsRead())}>Mark all read</button>
            </div>
            {feed && (
              <>
                <p>
                  total <b>{feed.meta.total_count}</b> · unread <b>{feed.meta.unread_count}</b> · unseen{" "}
                  <b>{feed.meta.unseen_count}</b>
                </p>
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr><th>workflow</th><th>content</th><th>seen</th><th>read</th><th /></tr>
                  </thead>
                  <tbody>
                    {feed.items.map((i) => {
                      const item = () => feedRef.current.getState().items.find((x: any) => x.id === i.id);
                      return (
                        <tr key={i.id} className="border-t align-top">
                          <td>{i.workflow}</td>
                          <td dangerouslySetInnerHTML={{ __html: i.blocks }} />
                          <td>{i.seen ? "✓" : ""}</td>
                          <td>{i.read ? "✓" : ""}</td>
                          <td className="space-x-1 whitespace-nowrap">
                            <button className="underline" onClick={() => act(`seen ${i.id}`, () => feedRef.current.markAsSeen(item()))}>seen</button>
                            <button className="underline" onClick={() => act(`read ${i.id}`, () => feedRef.current.markAsRead(item()))}>read</button>
                            <button className="underline" onClick={() => act(`unread ${i.id}`, () => feedRef.current.markAsUnread(item()))}>unread</button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </>
            )}
          </section>

          <section className="rounded border p-4 space-y-2">
            <h2 className="font-semibold">4 · Preferences for {user.name} (set client-side with the signed token)</h2>
            <div className="flex gap-2">
              <button className="rounded border px-2 py-1" onClick={() => setEnrollmentPref(true)}>Opt IN to New Enrollment (in-app)</button>
              <button className="rounded border px-2 py-1" onClick={() => setEnrollmentPref(false)}>Opt OUT</button>
              <button className="rounded border px-2 py-1" onClick={loadPrefs}>Reload</button>
            </div>
            <pre className="overflow-auto rounded bg-gray-100 p-2 text-xs">{JSON.stringify(prefs, null, 2)}</pre>
          </section>

          <section className="rounded border p-4">
            <h2 className="font-semibold">Log</h2>
            <pre className="text-xs">{log.join("\n")}</pre>
          </section>
        </>
      )}
    </div>
  );
}
