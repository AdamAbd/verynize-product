// A redirected HOME has no usable macOS login keychain. Never substitute a mock
// keychain in production: its encryption password is public.
const os = require("node:os");
const path = require("node:path");
const keychainReachable =
  process.platform !== "darwin" || path.resolve(process.env.HOME || "") === os.userInfo().homedir;
let availabilityChecks = 0;
function isEncryptionAvailable(storage) {
  if (!keychainReachable) return false;
  availabilityChecks++;
  return storage.isEncryptionAvailable() && storage.getSelectedStorageBackend?.() !== "basic_text";
}
// Non-secret diagnostic used by the real-Electron startup regression.
const secureStorageDiagnostics = () => ({ availabilityChecks, keychainReachable });
module.exports = { isEncryptionAvailable, secureStorageDiagnostics };
