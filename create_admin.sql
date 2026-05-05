DELETE FROM users WHERE email = 'super@x.com';
INSERT INTO users (id, email, name, password_hash, role, created_at) 
VALUES (gen_random_uuid(), 'super@x.com', 'Super Admin', '$2b$12$t358qyw1Nq0.wa9lPdeK2Or/RTuXKYbCI2ob7FL/DsMi1IeuSzezy', 'ADMIN', NOW());
SELECT email, role FROM users WHERE email = 'super@x.com';
