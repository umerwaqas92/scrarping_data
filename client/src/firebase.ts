import { initializeApp, type FirebaseApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, type Auth } from "firebase/auth";

// Firebase web config. These keys are public by design (they identify the
// project, not grant access), but can be overridden via Vite env vars.
const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};

const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY ?? "AIzaSyDTgL95SMVolfMc1shXNmaQfuZ0oBrr9O4",
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN ?? "allapps-69753.firebaseapp.com",
  projectId: env.VITE_FIREBASE_PROJECT_ID ?? "allapps-69753",
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET ?? "allapps-69753.appspot.com",
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? "923857001091",
  appId: env.VITE_FIREBASE_APP_ID ?? "1:923857001091:web:39a2b3723126f83d8e99b6",
  measurementId: env.VITE_FIREBASE_MEASUREMENT_ID ?? "G-YTCCP7RHLB",
};

export const app: FirebaseApp = initializeApp(firebaseConfig);
export const auth: Auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: "select_account" });

// Optional allowlist of Google emails (comma-separated in VITE_ALLOWED_EMAILS).
export const ALLOWED_EMAILS: string[] = (env.VITE_ALLOWED_EMAILS ?? "")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

export function isEmailAllowed(email: string | null | undefined): boolean {
  if (ALLOWED_EMAILS.length === 0) return true; // no allowlist configured → allow any
  if (!email) return false;
  return ALLOWED_EMAILS.includes(email.toLowerCase());
}
