// Account naming rules shared by the AccountDirectory object and the D1 directory (cloud/profiles.js).
export const RESERVED = new Set([
  "api",
  "apps",
  "admin",
  "u",
  "public",
  "verynize",
  "support",
  "help",
  "settings",
  "login",
  "signin",
]);
export const EMAIL = /^[^\s@<>()",;:]{1,64}@[a-z0-9-]+(\.[a-z0-9-]+)+$/;
export const HANDLE = /^[a-z0-9][a-z0-9-]{2,29}$/;
export const APP_NAME = /^[a-z0-9][a-z0-9-]{0,62}$/;
