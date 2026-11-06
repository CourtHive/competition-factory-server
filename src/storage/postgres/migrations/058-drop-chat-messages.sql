-- 058-drop-chat-messages.sql
-- AFFECTS: admin
-- Chat phase 4c (Mentat planning/CHAT_TO_AMS.md): drop CFS's chat table. Chat moved to courthive-ams (storage, in its
-- own database) and score-relay's `/chat` namespace (delivery) on 2026-10-29, and CFS's chat code was removed in phase
-- 4a (CFS 4.9.0). Nothing reads or writes this table. On nest it held 2 rows, last written 2026-10-25 (checked
-- 2026-11-06); the 30-day hold was waived by CA because chat had no production users.
--
-- Schema-qualified so it can only ever name CFS's table. DROP TABLE takes its indexes and the `seq` sequence with it.

DROP TABLE IF EXISTS public.chat_messages;
