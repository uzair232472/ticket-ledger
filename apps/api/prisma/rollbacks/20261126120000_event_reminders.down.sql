-- Rollback for migration 20261126120000_event_reminders: drops the reminder delivery log. Reminders already
-- sent stay in people's notifications and inboxes; only the "already sent" record is lost.
--   psql -v ON_ERROR_STOP=1 -d "$DATABASE_URL" -f prisma/rollbacks/20261126120000_event_reminders.down.sql
-- Removes the _prisma_migrations record too, so `npx prisma migrate deploy` can re-apply it later.
BEGIN;
DROP TABLE IF EXISTS "EventReminderDelivery";
DELETE FROM "_prisma_migrations" WHERE migration_name = '20261126120000_event_reminders';
COMMIT;
