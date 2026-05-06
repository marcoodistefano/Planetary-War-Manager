const aslan = require("./middleware/Aslan.js");
const crypto = require("crypto");

let AUTH_STORE = {
  uuid: null,
  username: null,
  email: null,
  passwordHash: null,
};

const registerUser = async ({ username, email, password }) => {
  const passwordHash = await aslan.hash_password(password);
  // Simula la generazione di un UUID da parte del DBMS
  const userUuid = crypto.randomUUID(); 
  
  AUTH_STORE = {
    uuid: userUuid,
    username,
    email,
    passwordHash,
  };
  return { passwordHash, uuid: userUuid };
};

const verifyLogin = async ({ username, password }) => {
  if (!AUTH_STORE.username || !AUTH_STORE.passwordHash) {
    return { ok: false, error: "Credenziali non valide" };
  }

  if (AUTH_STORE.username !== username) {
    return { ok: false, error: "Credenziali non valide" };
  }

  const isMatch = await aslan.verify_password(password, AUTH_STORE.passwordHash);
  if (!isMatch) {
    return { ok: false, error: "Credenziali non valide" };
  }

  // Restituiamo l'UUID per usarlo in Redis
  return { ok: true, uuid: AUTH_STORE.uuid };
};

// recoverUsername rimane invariato...
const recoverUsername = async ({ email, password }) => {
  if (!AUTH_STORE.email || AUTH_STORE.email !== email) {
    return { ok: false, error: "Email non valida" };
  }
  const isMatch = await aslan.verify_password(password, AUTH_STORE.passwordHash);
  if (!isMatch) {
    return { ok: false, error: "Credenziali non valide" };
  }
  return { ok: true, username: AUTH_STORE.username };
};

const resetPassword = async ({ username, email, newPassword }) => {
  if (!AUTH_STORE.username || !AUTH_STORE.email) {
    return { ok: false, error: "Utente o email non validi" };
  }

  if (AUTH_STORE.username !== username || AUTH_STORE.email !== email) {
    return { ok: false, error: "Utente o email non validi" };
  }

  const passwordHash = await aslan.hash_password(newPassword);
  AUTH_STORE.passwordHash = passwordHash;

  // Restituiamo l'UUID per revocare le sessioni
  return { ok: true, passwordHash, uuid: AUTH_STORE.uuid };
};

module.exports = {
  registerUser,
  verifyLogin,
  recoverUsername,
  resetPassword,
};