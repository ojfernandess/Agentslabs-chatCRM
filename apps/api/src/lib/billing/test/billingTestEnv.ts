import { config as loadDotenv } from "dotenv";
import { resolve } from "node:path";

loadDotenv({ path: resolve(process.cwd(), "../../.env") });
loadDotenv({ path: resolve(process.cwd(), ".env") });

const defaultLocalDb = "postgresql://openconduit:openconduit@localhost:5432/openconduit";
process.env.DATABASE_URL ??= defaultLocalDb;
if (process.env.DATABASE_URL.includes("@db:")) {
  process.env.DATABASE_URL = defaultLocalDb;
}
process.env.JWT_SECRET ??= "test-jwt-secret-for-billing-tests-only-not-production";
process.env.STRIPE_SECRET_KEY ??= "sk_test_51billingflowmock000000000000";
process.env.STRIPE_WEBHOOK_SECRET ??=
  "whsec_test_billing_flow_secret_1234567890";
