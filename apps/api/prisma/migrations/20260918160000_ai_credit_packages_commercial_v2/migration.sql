-- Pacotes comerciais v2: R$ 1 = 1 Crédito de IA (apresentação unificada, sem duplicidade Pix/cartão)
UPDATE "ai_credit_packages"
SET "is_active" = false, "updated_at" = CURRENT_TIMESTAMP
WHERE "slug" IN (
  'starter-10',
  'growth-25',
  'pro-50',
  'starter-10-brl',
  'growth-25-brl',
  'pro-50-brl'
);

INSERT INTO "ai_credit_packages" (
  "id",
  "slug",
  "name",
  "description",
  "credit_amount",
  "amount_cents",
  "currency",
  "display_order",
  "is_active",
  "updated_at"
)
VALUES
  (
    gen_random_uuid(),
    'starter-25-brl',
    'Starter',
    'Ideal para começar a utilizar os recursos de Inteligência Artificial.',
    25.00000000,
    2500,
    'BRL',
    10,
    true,
    CURRENT_TIMESTAMP
  ),
  (
    gen_random_uuid(),
    'growth-50-brl',
    'Growth',
    'Mais créditos para operações frequentes com IA.',
    50.00000000,
    5000,
    'BRL',
    20,
    true,
    CURRENT_TIMESTAMP
  ),
  (
    gen_random_uuid(),
    'pro-100-brl',
    'Pro',
    'Ideal para equipes com maior volume de atendimentos.',
    100.00000000,
    10000,
    'BRL',
    30,
    true,
    CURRENT_TIMESTAMP
  ),
  (
    gen_random_uuid(),
    'business-250-brl',
    'Business',
    'Para operações com uso intensivo de agentes e automações.',
    250.00000000,
    25000,
    'BRL',
    40,
    true,
    CURRENT_TIMESTAMP
  ),
  (
    gen_random_uuid(),
    'scale-500-brl',
    'Scale',
    'Para operações de alto volume utilizando Inteligência Artificial.',
    500.00000000,
    50000,
    'BRL',
    50,
    true,
    CURRENT_TIMESTAMP
  )
ON CONFLICT ("slug") DO NOTHING;
