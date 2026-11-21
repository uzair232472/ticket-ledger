-- R0: indexes for the paged / grouped training-data exporter (services/ml/export.js) and database-enforced
-- payment idempotency (services/stripeWebhookService.js, services/paymentEvidence.js).
-- Indexes only: no table, column or data change. The partial and expression indexes at the end cannot be
-- written in schema.prisma; they exist only here. A future `prisma migrate dev` diff must not drop them.

-- Exporter: snapshot pages in prediction-time order, and one event's snapshots
CREATE INDEX "MlPrediction_modelName_role_subjectType_asOf_id_idx" ON "MlPrediction"("modelName", "role", "subjectType", "asOf", "id");
CREATE INDEX "MlPrediction_modelName_role_subjectType_eventId_idx" ON "MlPrediction"("modelName", "role", "subjectType", "eventId");
-- Exporter: behaviour pages by action and time, per-customer aggregates
CREATE INDEX "BehaviorEvent_action_createdAt_id_idx" ON "BehaviorEvent"("action", "createdAt", "id");
CREATE INDEX "BehaviorEvent_userId_createdAt_idx" ON "BehaviorEvent"("userId", "createdAt");
-- Exporter: tickets / orders in label windows, a customer's orders for an event
CREATE INDEX "Ticket_eventId_createdAt_idx" ON "Ticket"("eventId", "createdAt");
CREATE INDEX "Order_eventId_createdAt_idx" ON "Order"("eventId", "createdAt");
CREATE INDEX "Order_userId_eventId_createdAt_idx" ON "Order"("userId", "eventId", "createdAt");
-- Audit lookups by action and target (webhook duplicates, checkout ends, disputes, evidence)
CREATE INDEX "AuditLog_action_targetType_targetId_idx" ON "AuditLog"("action", "targetType", "targetId");

-- Recommendation clicks / lists by list id, failed payments by order id (JSON fields)
CREATE INDEX "BehaviorEvent_rec_list_id_idx" ON "BehaviorEvent" ((metadata->>'listId')) WHERE action IN ('recommendation_impression', 'recommendation_click');
CREATE INDEX "BehaviorEvent_payment_failed_order_idx" ON "BehaviorEvent" ((metadata->>'orderId')) WHERE action = 'payment_failed';
-- Payments: one processed row per Stripe event (concurrent re-deliveries cannot both be processed) and one
-- evidence row per order (the checkout and the webhook may race). Fails, rather than deleting anything, if
-- duplicates already exist.
CREATE UNIQUE INDEX "AuditLog_stripe_event_unique" ON "AuditLog" ("targetId") WHERE action = 'STRIPE_EVENT' AND "targetType" = 'StripeEvent';
CREATE UNIQUE INDEX "AuditLog_payment_evidence_unique" ON "AuditLog" ("targetId") WHERE action = 'PAYMENT_SERVER_VERIFIED' AND "targetType" = 'Order';
