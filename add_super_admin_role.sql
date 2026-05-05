ALTER TYPE "UserRole" ADD VALUE 'SUPER_ADMIN' BEFORE 'ADMIN';
UPDATE users SET role = 'SUPER_ADMIN' WHERE email = 'super@openconduit.dev';
SELECT email, role FROM users;
