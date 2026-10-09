import { z } from 'zod';
import prisma from '../config/prisma.js';
import { canManageEvent } from '../utils/eventAccess.js';
import { MediaValidationError, uploadEventImages } from '../services/eventMediaService.js';
import {
  PrebookError,
  checkRows,
  draftDataSchema,
  draftTitle,
  rowEvents,
  submitDraftRows,
} from '../services/prebookService.js';

/*
 * Organizer prebooking: autosaved drafts, a live per-row availability check, per-row submission, image
 * uploads for the form, and showing / hiding a confirmed date. Rules live in services/prebookService.js.
 * Every route runs behind requireApprovedOrganizer, which sets req.company.
 */

const fail = (res, error, fallback) => {
  if (error instanceof PrebookError || error instanceof MediaValidationError) return res.status(error.status || 400).json({ success: false, message: error.message });
  if (error instanceof z.ZodError) return res.status(400).json({ success: false, message: error.errors[0]?.message || 'Invalid prebooking' });
  console.error(fallback, error);
  return res.status(500).json({ success: false, message: fallback });
};

async function ownDraft(req) {
  const draft = await prisma.prebookDraft.findUnique({ where: { id: req.params.id } });
  if (!draft || draft.companyId !== req.company.id) throw new PrebookError(404, 'Prebooking not found.');
  return draft;
}

const withRows = async (draft) => ({ ...draft, rowEvents: await rowEvents(draft.id) });

/** GET /api/prebook/drafts: this company's prebookings, most recently edited first. */
export const listDrafts = async (req, res) => {
  try {
    const drafts = await prisma.prebookDraft.findMany({
      where: { companyId: req.company.id },
      orderBy: { updatedAt: 'desc' },
      select: { id: true, title: true, updatedAt: true, data: true, events: { select: { status: true, reservedAt: true } } },
    });
    const summary = drafts.map(({ data, events, ...draft }) => ({
      ...draft,
      dates: Array.isArray(data?.rows) ? data.rows.length : 0,
      submitted: events.length,
      reserved: events.filter((e) => e.reservedAt && !['CANCELLED', 'REJECTED'].includes(e.status)).length,
    }));
    return res.json({ success: true, data: { drafts: summary } });
  } catch (error) {
    return fail(res, error, 'Could not load your prebookings.');
  }
};

/** POST /api/prebook/drafts { data? }: starts a prebooking. */
export const createDraft = async (req, res) => {
  try {
    const data = draftDataSchema.parse(req.body?.data || {});
    const draft = await prisma.prebookDraft.create({
      data: { companyId: req.company.id, createdById: req.user.id, title: draftTitle(data), data },
    });
    return res.status(201).json({ success: true, data: { draft: await withRows(draft) } });
  } catch (error) {
    return fail(res, error, 'Could not start a prebooking.');
  }
};

/** GET /api/prebook/drafts/:id: the saved form plus each submitted row's event status. */
export const getDraft = async (req, res) => {
  try {
    return res.json({ success: true, data: { draft: await withRows(await ownDraft(req)) } });
  } catch (error) {
    return fail(res, error, 'Could not load this prebooking.');
  }
};

/** PUT /api/prebook/drafts/:id { data }: autosave. */
export const saveDraft = async (req, res) => {
  try {
    await ownDraft(req);
    const data = draftDataSchema.parse(req.body?.data);
    const draft = await prisma.prebookDraft.update({ where: { id: req.params.id }, data: { data, title: draftTitle(data) } });
    return res.json({ success: true, data: { savedAt: draft.updatedAt } });
  } catch (error) {
    return fail(res, error, 'Could not save this prebooking.');
  }
};

/** DELETE /api/prebook/drafts/:id: discards the form. Dates already submitted stay as they are. */
export const deleteDraft = async (req, res) => {
  try {
    await ownDraft(req);
    await prisma.prebookDraft.delete({ where: { id: req.params.id } });
    return res.json({ success: true, message: 'Prebooking discarded. Dates already submitted are unchanged.' });
  } catch (error) {
    return fail(res, error, 'Could not discard this prebooking.');
  }
};

const checkSchema = z.object({ city: z.string().max(60).default(''), rows: draftDataSchema.shape.rows });

/** POST /api/prebook/check { city, rows }: live availability for each unsubmitted row. */
export const checkAvailability = async (req, res) => {
  try {
    const { city, rows } = checkSchema.parse(req.body);
    const labels = Object.fromEntries((req.body?.labels && typeof req.body.labels === 'object' ? Object.entries(req.body.labels) : []).map(([k, v]) => [k, String(v).slice(0, 30)]));
    return res.json({ success: true, data: { results: await checkRows(city.trim(), rows, { labels }) } });
  } catch (error) {
    return fail(res, error, 'Could not check availability.');
  }
};

/**
 * POST /api/prebook/drafts/:id/submit { rowKeys? }: sends the chosen dates (default: all) for approval.
 * Answers one result per date; dates left out, or that clash, stay in the draft to fix and submit later.
 */
export const submitDraft = async (req, res) => {
  try {
    const draft = await ownDraft(req);
    const rowKeys = z.array(z.string().max(40)).max(30).optional().parse(req.body?.rowKeys);
    const results = await submitDraftRows(draft, req.company, rowKeys);
    const count = (status) => results.filter((r) => r.status === status).length;
    const submitted = count('submitted');
    const failed = count('conflict') + count('invalid');
    const message = failed
      ? `${submitted} date${submitted === 1 ? '' : 's'} submitted. ${failed} need${failed === 1 ? 's' : ''} changes and stay${failed === 1 ? 's' : ''} in your draft.`
      : submitted
        ? `${submitted} date${submitted === 1 ? '' : 's'} submitted for approval. They are not reserved until an admin approves them.`
        : 'These dates were already submitted.';
    return res.status(failed && !submitted ? 409 : 200).json({
      success: !failed,
      message,
      data: { results, draft: await withRows(await ownDraft(req)) },
    });
  } catch (error) {
    return fail(res, error, 'Could not submit these dates.');
  }
};

const IMAGE_KINDS = { banner: 'banner', card: 'card', galleryWide: 'galleryWide', gallery: 'gallery' };

/** POST /api/prebook/images (multipart image + kind): stores one image for the form and returns its URL. */
export const uploadImage = async (req, res) => {
  try {
    const kind = IMAGE_KINDS[req.body?.kind];
    if (!kind) throw new PrebookError(400, 'Unknown image placement.');
    if (!req.file) throw new PrebookError(400, 'Choose an image to upload.');
    const [url] = await uploadEventImages([{ file: req.file, kind }]);
    return res.status(201).json({ success: true, data: { url } });
  } catch (error) {
    return fail(res, error, 'Could not upload the image.');
  }
};

/**
 * PATCH /api/prebook/events/:eventId/visibility { hidden }: keeps a date off public pages or shows it.
 * Hiding never cancels the date, releases its slot or touches sold tickets. Showing needs approval,
 * ticket tiers and a seating plan.
 */
export const setVisibility = async (req, res) => {
  try {
    const { hidden } = z.object({ hidden: z.boolean() }).parse(req.body);
    const event = await prisma.event.findUnique({ where: { id: req.params.eventId } });
    if (!event || !(await canManageEvent(req.user, event, { requireApproved: true }))) throw new PrebookError(404, 'Event not found.');
    if (!hidden) {
      if (!event.approvedAt || !['PUBLISHED', 'PAUSED', 'COMPLETED'].includes(event.status)) {
        throw new PrebookError(400, 'Only an approved date can be shown publicly.');
      }
      const [tiers, plan, seats] = await Promise.all([
        prisma.ticketTier.count({ where: { eventId: event.id } }),
        prisma.venueLayout.findFirst({ where: { eventId: event.id, status: 'PUBLISHED' }, select: { id: true } }),
        prisma.seat.count({ where: { eventId: event.id } }),
      ]);
      if (!tiers || !(plan || seats)) {
        throw new PrebookError(400, 'Add ticket prices and publish a seating plan for this date before showing it publicly.');
      }
    }
    const updated = await prisma.event.update({ where: { id: event.id }, data: { isHidden: hidden }, select: { id: true, isHidden: true, status: true, reservedAt: true } });
    await prisma.auditLog.create({
      data: { userId: req.user.id, action: hidden ? 'EVENT_HIDDEN' : 'EVENT_SHOWN', targetType: 'Event', targetId: event.id, details: { name: event.name } },
    });
    return res.json({
      success: true,
      message: hidden ? 'Hidden from the public. The reservation and any sold tickets are unchanged.' : 'This date is now visible to the public.',
      data: { event: updated },
    });
  } catch (error) {
    return fail(res, error, 'Could not change the visibility.');
  }
};
