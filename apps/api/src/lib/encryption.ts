import crypto from "node:crypto";
import { config } from "../config.js";

const ALGORITHM = "aes-256-cbc";
const IV_LENGTH = 16;

/**
 * Encrypts a string using AES-256-CBC.
 * Returns a string in the format "iv:encryptedData".
 */
export function encrypt(text: string): string {
  if (!text) return text;
  
  // Use a hash of the JWT secret or a dedicated key if provided
  const key = crypto.createHash("sha256").update(process.env.ENCRYPTION_KEY || config.jwtSecret).digest();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  
  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");
  
  return `${iv.toString("hex")}:${encrypted}`;
}

/**
 * Decrypts a string encrypted with the encrypt function above.
 * If decryption fails or format is wrong, returns the original text (for migration/fallback).
 */
export function decrypt(text: string | null | undefined): string | null {
  if (!text) return text ?? null;
  
  const parts = text.split(":");
  if (parts.length !== 2) return text; // Probably plain text
  
  try {
    const [ivHex, encryptedData] = parts;
    const key = crypto.createHash("sha256").update(process.env.ENCRYPTION_KEY || config.jwtSecret).digest();
    const iv = Buffer.from(ivHex, "hex");
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    
    let decrypted = decipher.update(encryptedData, "hex", "utf8");
    decrypted += decipher.final("utf8");
    
    return decrypted;
  } catch (err) {
    // If decryption fails, it might be plain text that happens to contain a colon
    return text;
  }
}
