UPDATE events SET time = ?
WHERE session_id = (SELECT id FROM sessions WHERE session_key = ?) AND seq = 0;
