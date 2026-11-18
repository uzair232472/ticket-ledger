import { Router } from 'express';
import { orgGuard, requireAuth } from '../middlewares/auth.js';
import * as c from '../controllers/checkinController.js';
import { deviceEnrollRateLimiter, gateSyncRateLimiter } from '../middlewares/rateLimit.js';

// Gate check-in. Event access (assigned gate staff, owning organizer, Super Admin) is checked per request.
const router = Router();
const scanners = orgGuard('gate.scan');
const viewers = orgGuard('gate.stats');
const supervisors = orgGuard('gate.supervise');

router.get('/events', scanners, c.myEvents);
router.get('/events/:id/pack', scanners, c.pack);
router.get('/events/:id/stats', viewers, c.stats);
router.get('/events/:id/recent', viewers, c.recent);
router.post('/devices/enroll', scanners, deviceEnrollRateLimiter, c.enroll);
router.post('/scan', scanners, c.scanTicket);
router.post('/sync', scanners, gateSyncRateLimiter, c.syncScans);
// Revoked devices / staff without access: scans kept as evidence (signed in only: access may be gone)
router.post('/evidence', requireAuth, gateSyncRateLimiter, c.evidence);
router.post('/heartbeat', scanners, c.heartbeat);
router.get('/ping', scanners, c.ping);
router.post('/devices/manifest', scanners, gateSyncRateLimiter, c.manifest);
router.post('/exceptions', scanners, c.requestException);

// Gate management (supervisors): gates, re-entry, gate staff, devices, exceptions, reversals, reports
router.get('/manage/events/:id', supervisors, c.overview);
router.post('/manage/events/:id/gates', supervisors, c.createGate);
router.patch('/manage/events/:id/gates/:gateId', supervisors, c.updateGate);
router.delete('/manage/events/:id/gates/:gateId', supervisors, c.deleteGate);
router.put('/manage/events/:id/policy', supervisors, c.setPolicy);
router.put('/manage/events/:id/staff/:staffId/gates', supervisors, c.setStaffGates);
router.get('/manage/events/:id/devices', supervisors, c.devices);
router.get('/manage/events/:id/operations', supervisors, c.operations);
router.get('/manage/events/:id/devices/:deviceId', supervisors, c.deviceDetails);
router.post('/manage/events/:id/devices/:deviceId/actions', supervisors, c.deviceAction);
router.get('/manage/events/:id/quarantine', supervisors, c.quarantineList);
router.post('/manage/events/:id/quarantine/review', supervisors, c.quarantineReview);
router.get('/manage/events/:id/reports/:kind', supervisors, c.opsReport);
router.patch('/manage/events/:id/devices/:deviceId', supervisors, c.updateDevice);
router.get('/manage/events/:id/exceptions', supervisors, c.exceptions);
router.post('/manage/events/:id/exceptions/:exceptionId/decide', supervisors, c.decideException);
router.get('/manage/events/:id/checkins', supervisors, c.checkIns);
router.post('/manage/events/:id/checkins/:checkInId/reverse', supervisors, c.reverse);
router.get('/manage/events/:id/report', supervisors, c.report);
router.get('/manage/events/:id/conflicts', supervisors, c.conflicts);
router.get('/manage/events/:id/conflicts/:conflictId', supervisors, c.conflict);
router.post('/manage/events/:id/conflicts/:conflictId/resolve', supervisors, c.resolveConflict);

export default router;
