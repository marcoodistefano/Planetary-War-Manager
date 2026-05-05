const Sauron = require("./middleware/Sauron.js");
const authModel = require("./authModel.js");

const register = async (req, res) => {
  console.log("--- Ricevuto dato grezzo ---");
  console.log(req.body);

  try {
    const result = await Sauron.process_register(req.body);

    if (!result.isValid) {
      console.log("--- Validazione fallita ---");
      return res.status(400).json(result);
    }

    const saved = await authModel.registerUser({
      username: result.data.username,
      email: result.data.email,
      password: result.data.password,
    });

    result.data.password = saved.passwordHash;

    console.log("--- Dato X sicuro generato ---");
    console.log(result.data);

    return res.json({
      message: "Registrazione ok",
      dato_x_sicuro: result.data,
    });
  } catch (error) {
    console.error("--- Errore durante l'elaborazione ---");
    console.error(error);
    return res.status(500).json({
      error: "Errore interno del server",
      details: error.message,
    });
  }
};

const login = async (req, res) => {
  console.log("--- Ricevuto dato da decodificare ---");
  console.log(req.body);

  try {
    const result = await Sauron.process_login(req.body);

    if (!result.isValid) {
      console.log("--- Validazione fallita ---");
      return res.status(400).json(result);
    }

    const authResult = await authModel.verifyLogin({
      username: result.data.username,
      password: result.data.password,
    });

    if (!authResult.ok) {
      return res.status(401).json({
        isValid: false,
        errors: [authResult.error],
      });
    }

    console.log("--- Dato X sicuro generato ---");
    console.log(result.data);

    return res.json({
      message: "Login avvenuto con successo",
      dato_x_sicuro: result.data,
    });
  } catch (error) {
    console.error("--- Errore durante l'elaborazione ---");
    console.error(error);
    return res.status(500).json({
      error: "Errore interno del server",
      details: error.message,
    });
  }
};

const recoveryUsername = async (req, res) => {
  console.log("--- Ricevuto dato da recupero username ---");
  console.log(req.body);

  try {
    const result = await Sauron.process_recovery_username(req.body);

    if (!result.isValid) {
      console.log("--- Validazione fallita ---");
      return res.status(400).json(result);
    }

    const recovery = await authModel.recoverUsername({
      email: result.data.email,
      password: result.data.password,
    });

    if (!recovery.ok) {
      return res.status(400).json({
        isValid: false,
        errors: [recovery.error],
      });
    }

    result.data.username = recovery.username;

    return res.json({
      message: "Username recuperato con successo",
      dato_x_sicuro: result.data,
    });
  } catch (error) {
    console.error("--- Errore durante l'elaborazione ---");
    console.error(error);
    return res.status(500).json({
      error: "Errore interno del server",
      details: error.message,
    });
  }
};

const recoveryPassword = async (req, res) => {
  console.log("--- Ricevuto dato da recupero password ---");
  console.log(req.body);

  try {
    const result = await Sauron.process_recovery_password(req.body);

    if (!result.isValid) {
      console.log("--- Validazione fallita ---");
      return res.status(400).json(result);
    }

    const reset = await authModel.resetPassword({
      username: result.data.username,
      email: result.data.email,
      newPassword: result.data.newPassword,
    });

    if (!reset.ok) {
      return res.status(400).json({
        isValid: false,
        errors: [reset.error],
      });
    }

    result.data.password = reset.passwordHash;

    return res.json({
      message: "Password aggiornata con successo",
      dato_x_sicuro: result.data,
    });
  } catch (error) {
    console.error("--- Errore durante l'elaborazione ---");
    console.error(error);
    return res.status(500).json({
      error: "Errore interno del server",
      details: error.message,
    });
  }
};

module.exports = {
  register,
  login,
  recoveryUsername,
  recoveryPassword,
};
