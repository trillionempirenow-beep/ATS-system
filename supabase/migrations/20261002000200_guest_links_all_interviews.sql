-- Guest links for every interview in the built-in room, not only final interviews.
-- Interviews already booked in the room get a guest token so the interviewer can share one.
update interviews
   set guest_token = replace(gen_random_uuid()::text, '-', '')
 where room_code is not null
   and guest_token is null;
