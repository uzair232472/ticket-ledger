import { z } from 'zod';
import prisma from '../config/prisma.js';
import { CategoryError, categoryColumns } from './categoryService.js';
import {
  ScheduleError,
  conflictMessage,
  findScheduleConflicts,
  lockVenue,
  normalizeVenue,
  parseTimeOfDay,
  resolveSchedule,
  slotsClash,
} from './eventScheduleService.js';
import { noticeSubmitted } from './eventReviewNotices.js';

/*
 * Prebooking: an organizer reserves one or more future dates / venue slots in one form. Shared details are
 * entered once; each row (date) has its own venue and schedule and may override the name, images and public
 * visibility. The form is autosaved as a PrebookDraft. Submitting turns each chosen row into its own Event
 * (PENDING_APPROVAL, which holds the slot); an admin's approval confirms the reservation (reservedAt).
 */

const PREBOOK_EVENT_TYPES = [
  'CRICKET_MATCH', 'FOOTBALL_MATCH', 'KABADDI', 'BOXING', 'MUSIC_CONCERT', 'MUSIC_FESTIVAL',
  'HOCKEY_MATCH', 'QAWWALI', 'THEATRE', 'CONFERENCE', 'GENERAL_ADMISSION', 'OTHER',
];
const MAX_ROWS = 30;
const imageUrl = z.string().regex(/^(https?:\/\/|\/)/).max(1000).nullable().optional();
const imagesSchema = z
  .object({
    bannerUrl: imageUrl,
    cardImageUrl: imageUrl,
    galleryWideUrl: imageUrl,
    // null / missing: use the shared gallery
    gallery: z.array(z.string().regex(/^(https?:\/\/|\/)/).max(1000)).max(10).nullable().optional(),
  })
  .partial()
  .default({});
const text = (max) => z.string().max(max).optional().default('');

// What an autosave may store: anything half-filled is fine; completeness is checked when submitting
export const draftDataSchema = z.object({
  shared: z
    .object({
      name: text(150),
      description: text(5000),
      type: z.enum(PREBOOK_EVENT_TYPES).optional().default('CONFERENCE'),
      customCategoryId: z.string().uuid().nullable().optional(),
      city: text(60),
      contactEmail: text(200),
      images: imagesSchema,
    })
    .default({}),
  rows: z
    .array(
      z.object({
        key: z.string().regex(/^[A-Za-z0-9_-]{4,40}$/),
        venue: text(200),
        latitude: z.number().min(-90).max(90).nullable().optional(),
        longitude: z.number().min(-180).max(180).nullable().optional(),
        locationAddress: z.string().max(300).nullable().optional(),
        date: text(10),
        time: text(20),
        endDate: text(10),
        endTime: text(20),
        customize: z.boolean().optional().default(false),
        custom: z
          .object({ name: text(150), images: imagesSchema, isPublic: z.boolean().optional().default(true) })
          .partial()
          .default({}),
      }),
    )
    .max(MAX_ROWS, `A prebooking can have at most ${MAX_ROWS} dates.`)
    .default([]),
});

// "19:00" -> "7:00 PM PKT", the wall-clock text events show next to their date
const displayTime = (value) => {
  const minutes = parseTimeOfDay(value);
  const h = Math.floor(minutes / 60);
  return `${h % 12 || 12}:${String(minutes % 60).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'} PKT`;
};

export class PrebookError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** Short title for listing drafts. */
export const draftTitle = (data) => data.shared?.name?.trim() || 'Untitled prebooking';

/**
 * The values a row's event gets: overrides where the organizer customized this date, the shared value
 * wherever an override is left unset. Each date gets its own copy, so later changes don't spread.
 */
export function effectiveRow(shared, row) {
  const custom = row.customize ? row.custom || {} : {};
  const ci = custom.images || {};
  const si = shared.images || {};
  return {
    name: custom.name?.trim() || shared.name.trim(),
    bannerUrl: ci.bannerUrl || si.bannerUrl || null,
    cardImageUrl: ci.cardImageUrl || si.cardImageUrl || null,
    galleryWideUrl: ci.galleryWideUrl || si.galleryWideUrl || null,
    gallery: Array.isArray(ci.gallery) ? ci.gallery : si.gallery || [],
    isPublic: row.customize ? custom.isPublic !== false : true,
  };
}

/** Problems with the shared details (they block every date). */
export function sharedProblems(shared) {
  const problems = [];
  if (shared.name.trim().length < 3) problems.push('Enter the event name (at least 3 characters).');
  if (shared.description.trim().length < 10) problems.push('Add a description (at least 10 characters).');
  if (shared.city.trim().length < 2) problems.push('Choose the city.');
  if (shared.contactEmail.trim() && !z.string().email().safeParse(shared.contactEmail.trim()).success) {
    problems.push('Enter a valid contact email, or leave it empty.');
  }
  return problems;
}

/** Schedule of one row, or { field, message } when it isn't complete or valid. */
export function rowSchedule(row, now = new Date()) {
  if (row.venue.trim().length < 2) return { error: { field: 'venue', message: 'Enter the venue for this date.' } };
  try {
    const schedule = resolveSchedule(row);
    if (schedule.startsAt <= now) return { error: { field: 'date', message: 'This date has already started or passed. Choose a future date.' } };
    return { schedule };
  } catch (error) {
    if (error instanceof ScheduleError) return { error: { field: error.details.field, message: error.message } };
    throw error;
  }
}

/**
 * Live check for the form: each row against booked events (pending requests and reserved dates, hidden ones
 * included) and against the earlier rows in the form. Only the later row of a clashing pair is flagged.
 * `rows` are the rows not yet submitted; submitted ones are events and are covered by the database check.
 */
export async function checkRows(city, rows, { labels = {} } = {}) {
  const results = [];
  const accepted = [];
  for (const [index, row] of rows.entries()) {
    const label = labels[row.key] || `Date ${index + 1}`;
    const { schedule, error } = rowSchedule(row);
    if (error) {
      results.push({ key: row.key, ok: false, incomplete: !row.venue.trim() || !row.date || !row.time || !row.endDate || !row.endTime, ...error });
      continue;
    }
    const proposed = { start: schedule.startsAt, end: schedule.endsAt };
    const sameVenue = accepted.find(
      (other) => normalizeVenue(other.venue) === normalizeVenue(row.venue) && slotsClash(proposed, other),
    );
    if (sameVenue) {
      results.push({
        key: row.key,
        ok: false,
        field: 'schedule',
        clashesWith: sameVenue.key,
        message: conflictMessage(proposed, sameVenue, { who: `${sameVenue.label} in this form`, you: 'This date' }),
      });
      continue;
    }
    const conflicts = city ? await findScheduleConflicts({ city, venue: row.venue, ...schedule }) : [];
    if (conflicts.length) {
      results.push({ key: row.key, ok: false, field: 'schedule', message: conflicts[0].message.replace('Your event', 'This date'), more: conflicts.length - 1 });
      continue;
    }
    accepted.push({ key: row.key, label, venue: row.venue, ...proposed });
    results.push({ key: row.key, ok: true });
  }
  return results;
}

/**
 * Submits the chosen rows of a draft. Each row is its own transaction under its venue lock: rechecked,
 * then created as a PENDING_APPROVAL event keyed by (draft, row key). A row that already has an event is
 * reported as already submitted and never created again, so retries are safe.
 * Returns one result per chosen row: submitted | already_submitted | conflict | invalid.
 */
export async function submitDraftRows(draft, company, rowKeys) {
  const data = draftDataSchema.parse(draft.data);
  const { shared } = data;
  const keys = rowKeys?.length ? new Set(rowKeys) : null;
  const chosen = data.rows.filter((row) => !keys || keys.has(row.key));
  if (!chosen.length) throw new PrebookError(400, 'Choose at least one date to submit.');
  const labelOf = Object.fromEntries(data.rows.map((row, i) => [row.key, `Date ${i + 1}`]));

  const problems = sharedProblems(shared);
  let category = null;
  try {
    category = await categoryColumns(shared.type, shared.customCategoryId);
  } catch (error) {
    if (!(error instanceof CategoryError)) throw error;
    problems.push(error.message);
  }

  const results = [];
  for (const row of chosen) {
    const base = { key: row.key, label: labelOf[row.key] };
    const existing = await prisma.event.findUnique({
      where: { prebookDraftId_prebookRowKey: { prebookDraftId: draft.id, prebookRowKey: row.key } },
      select: { id: true, status: true },
    });
    if (existing) {
      results.push({ ...base, status: 'already_submitted', eventId: existing.id, eventStatus: existing.status });
      continue;
    }
    if (problems.length) {
      results.push({ ...base, status: 'invalid', field: 'shared', message: problems[0] });
      continue;
    }
    const { schedule, error } = rowSchedule(row);
    if (error) {
      results.push({ ...base, status: 'invalid', ...error });
      continue;
    }

    const eff = effectiveRow(shared, row);
    try {
      const event = await prisma.$transaction(async (tx) => {
        await lockVenue(tx, { city: shared.city, venue: row.venue });
        const conflicts = await findScheduleConflicts({ city: shared.city, venue: row.venue, ...schedule }, tx);
        if (conflicts.length) {
          // Name the clashing date when it is one submitted from this same form
          const sibling = conflicts[0].eventId
            ? await tx.event.findFirst({ where: { id: conflicts[0].eventId, prebookDraftId: draft.id }, select: { prebookRowKey: true } })
            : null;
          const message = sibling
            ? conflictMessage({ start: schedule.startsAt, end: schedule.endsAt }, { start: conflicts[0].startsAt, end: conflicts[0].endsAt }, { who: `${labelOf[sibling.prebookRowKey] || 'Another date'} in this form`, you: 'This date' })
            : conflicts[0].message.replace('Your event', 'This date');
          throw new ScheduleError(409, message, { field: 'schedule' });
        }
        return tx.event.create({
          data: {
            companyId: company.id,
            name: eff.name,
            description: shared.description.trim(),
            ...category,
            status: 'PENDING_APPROVAL',
            submittedAt: new Date(),
            date: new Date(row.date),
            time: displayTime(row.time),
            startsAt: schedule.startsAt,
            endsAt: schedule.endsAt,
            city: shared.city.trim(),
            venue: row.venue.trim(),
            latitude: row.latitude ?? null,
            longitude: row.longitude ?? null,
            locationAddress: row.locationAddress ?? null,
            contactEmail: shared.contactEmail.trim().toLowerCase() || null,
            bannerUrl: eff.bannerUrl,
            cardImageUrl: eff.cardImageUrl,
            galleryWideUrl: eff.galleryWideUrl,
            galleryImages: { create: eff.gallery.map((url, position) => ({ url, position })) },
            isHidden: !eff.isPublic,
            prebookDraftId: draft.id,
            prebookRowKey: row.key,
          },
        });
      });
      await noticeSubmitted(event, company);
      await prisma.auditLog.create({
        data: { userId: company.userId, action: 'PREBOOK_DATE_SUBMITTED', targetType: 'Event', targetId: event.id, details: { draftId: draft.id, rowKey: row.key, venue: event.venue } },
      });
      results.push({ ...base, status: 'submitted', eventId: event.id, eventStatus: event.status });
    } catch (error) {
      if (error instanceof ScheduleError) {
        results.push({ ...base, status: 'conflict', field: 'schedule', message: error.message });
      } else if (error.code === 'P2002') {
        // The same row submitted twice at once (double click, two tabs): the other request created it
        const made = await prisma.event.findUnique({
          where: { prebookDraftId_prebookRowKey: { prebookDraftId: draft.id, prebookRowKey: row.key } },
          select: { id: true, status: true },
        });
        results.push({ ...base, status: 'already_submitted', eventId: made?.id, eventStatus: made?.status });
      } else {
        throw error;
      }
    }
  }
  return results;
}

/** Each submitted row's event, keyed by row: the status shown next to the date in the form. */
export async function rowEvents(draftId) {
  const events = await prisma.event.findMany({
    where: { prebookDraftId: draftId },
    select: {
      id: true, prebookRowKey: true, name: true, status: true, reservedAt: true, isHidden: true,
      reviewComment: true, venue: true, startsAt: true, endsAt: true,
      _count: { select: { tiers: true, tickets: true } },
    },
  });
  return Object.fromEntries(events.map(({ prebookRowKey, ...event }) => [prebookRowKey, event]));
}
