import { and, desc, eq } from "drizzle-orm";
import { courses, lessons, modules, notes } from "~/db/schema";
import type { Db } from "~/lib/comments.server";
import { MAX_NOTE_LENGTH, NOTE_TOO_LONG } from "~/lib/notes";

// ─── Notes ───
// A Student's own plain-text writing about a Lesson, one per Student per
// Lesson (enforced by the `notes_user_lesson_unique` index). A Note is private
// to the Student who wrote it: nothing outside the Student's own Lesson page
// and Saved page may read it. See GLOSSARY.md.
//
// Every function takes the database first, so tests can hand in an in-memory
// one. Content access is the caller's job: the Lesson action checks it before
// calling in.

export function getNote(db: Db, studentId: number, lessonId: number) {
  return db
    .select({ body: notes.body, updatedAt: notes.updatedAt })
    .from(notes)
    .where(and(eq(notes.userId, studentId), eq(notes.lessonId, lessonId)))
    .get();
}

export type SaveNoteResult =
  | { ok: true; saved: "written" | "cleared" }
  | { ok: false; error: string };

/**
 * Writes the Student's Note on a Lesson, replacing the body and moving
 * `updatedAt` on if one exists. The body is trimmed; over the cap it is
 * refused, never truncated. An empty body clears the Note.
 */
export function saveNote(
  db: Db,
  studentId: number,
  lessonId: number,
  body: string,
  now: Date
): SaveNoteResult {
  const trimmed = body.trim();
  if (trimmed.length > MAX_NOTE_LENGTH) {
    return { ok: false, error: NOTE_TOO_LONG };
  }

  if (trimmed.length === 0) {
    db.delete(notes)
      .where(and(eq(notes.userId, studentId), eq(notes.lessonId, lessonId)))
      .run();
    return { ok: true, saved: "cleared" };
  }

  const at = now.toISOString();
  db.insert(notes)
    .values({
      userId: studentId,
      lessonId,
      body: trimmed,
      createdAt: at,
      updatedAt: at,
    })
    .onConflictDoUpdate({
      target: [notes.userId, notes.lessonId],
      set: { body: trimmed, updatedAt: at },
    })
    .run();
  return { ok: true, saved: "written" };
}

/** The Student's Notes with their Lesson and Course, last edited first. */
export function listNotes(db: Db, studentId: number) {
  return db
    .select({
      id: notes.id,
      body: notes.body,
      updatedAt: notes.updatedAt,
      lessonId: lessons.id,
      lessonTitle: lessons.title,
      courseTitle: courses.title,
      courseSlug: courses.slug,
    })
    .from(notes)
    .innerJoin(lessons, eq(notes.lessonId, lessons.id))
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .innerJoin(courses, eq(modules.courseId, courses.id))
    .where(eq(notes.userId, studentId))
    .orderBy(desc(notes.updatedAt), desc(notes.id))
    .all();
}
