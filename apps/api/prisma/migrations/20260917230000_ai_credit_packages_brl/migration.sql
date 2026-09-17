-- Pacotes BRL para checkout Mercado Pago (créditos em USD na carteira)
INSERT INTO "ai_credit_packages" ("id", "slug", "name", "description", "credit_amount", "amount_cents", "currency", "display_order", "is_active", "updated_at")
VALUES
  (gen_random_uuid(), 'starter-10-brl', 'Starter — R$ 55', 'Pacote inicial de créditos de IA (Pix)', 10.00000000, 5500, 'BRL', 11, true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'growth-25-brl', 'Growth — R$ 137', 'Pacote recomendado para uso moderado (Pix)', 25.00000000, 13750, 'BRL', 21, true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'pro-50-brl', 'Pro — R$ 275', 'Pacote para equipas com alto volume (Pix)', 50.00000000, 27500, 'BRL', 31, true, CURRENT_TIMESTAMP)
ON CONFLICT ("slug") DO NOTHING;
