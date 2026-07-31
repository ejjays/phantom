-- housekeeping: delete anonymous users idle for 30+ days (supabase-recommended).
-- run periodically from the SQL editor; cascades remove their profiles,
-- reactions, comments, likes & push tokens. never run while you still want
-- those guests' content.
delete from auth.users
where is_anonymous is true and created_at < now() - interval '30 days';
