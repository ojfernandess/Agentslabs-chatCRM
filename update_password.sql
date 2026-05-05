UPDATE users SET password_hash = '$2b$12$IIh0uuk2CcAEVKTY.jGPw.39up8d4xkP3niKROXTBgb9waezAqTFi' WHERE email = 'super@openconduit.dev';
SELECT email, role FROM users WHERE email = 'super@openconduit.dev';
