const aslan = require("./middleware/Aslan.js");

let AUTH_STORE = {
  username: null,
  email: null,
  passwordHash: null,
};

const registerUser = async ({ username, email, password }) => {
  const passwordHash = await aslan.hash_password(password);
  AUTH_STORE = {
    username,
    email,
    passwordHash,
  };
  return { passwordHash };
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

  return { ok: true };
};

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
  AUTH_STORE = {
    username: AUTH_STORE.username,
    email: AUTH_STORE.email,
    passwordHash,
  };

  return { ok: true, passwordHash };
};

module.exports = {
  registerUser,
  verifyLogin,
  recoverUsername,
  resetPassword,
};
