const conan = require("./Conan.js");
const odin = require("./Odino.js");
const aslan = require("./Aslan.js");
let SECRETE ="";
// --- LOGICA DI SICUREZZA PWM (Cap. 14) ---

const PWMSecurity = {
  // Sanitizzazione ricorsiva (Cap 14.1)
  checker: (input) => {
    if (typeof input !== "string") return input;
    let conan_res = conan.automatic_detective(input);
    if (conan_res.isEncoded) {
      console.log(
        `Input sospetto rilevato: "${input}". TIPO: ${conan_res.encoding}. Applicazione della sanitizzazione ricorsiva.`,
      );
      return conan_res.decoded;
    } else {
      console.log(
        `Input non codificato rilevato: "${input}". Applicazione della sanitizzazione standard.`,
      );
    }
    return input;
  },

  sanitize: (input) => {
    if (typeof input !== "string") return input;
    let sanitized = input.normalize("NFC"); // Gestione Non-ASCII
    const dangerousChars = /[<>()"']/g; // Caratteri vietati dal doc
    console.log(`Sanitizzazione in corso. Input originale: "${input}"`);
    let previous;
    do {
      previous = sanitized;
      sanitized = sanitized.replace(dangerousChars, "");
    } while (sanitized !== previous);

    return sanitized;
  },

  // Parsing e Validazione (Cap 14.2)
  process_register: async (body) => {
    const schema = {
      username: { required: true },
      email: { required: true },
      password: { required: true, minLength: 12 },
    };

    let result = { isValid: true, data: {}, errors: [] };

    for (let field in schema) {
      // Sanitizzazione di ogni campo in ingresso
      let rawValue = body[field] || "";
      let conanValue = PWMSecurity.checker(rawValue);
      let safeValue = PWMSecurity.sanitize(conanValue);
      let odinResult = odin.odino_manager(safeValue);

      if (odinResult === false) {
        result.isValid = false;
        result.errors.push(`Input bloccato da Odino: "${safeValue}"`);
        safeValue = null; // Elimina il dato per sicurezza
        continue; // Salta ulteriori controlli per questo campo
      } else {
        console.log(
          `Input passato attraverso Odino: "${safeValue}". Risultato: ${odinResult ? "Confermato" : "Bloccato"}.`,
        );
      }
      // Controllo integrità strutturale dopo la pulizia
      if (schema[field].required && !safeValue) {
        result.isValid = false;
        result.errors.push(
          `Campo ${field} mancante o svuotato dalla sanitizzazione`,
        );
      } else if (
        schema[field].minLength &&
        safeValue.length < schema[field].minLength
      ) {
        result.isValid = false;
        result.errors.push(
          `${field} troppo corta (minimo ${schema[field].minLength} caratteri)`,
        );
      }

      // Hash della password se il field è password
      if (field === "password" && safeValue.length >= schema[field].minLength && result.isValid) {
        console.log("SAFE VALUE prima dell'hash:", safeValue);  
        try {
          const hashedPassword = await aslan.hash_password(safeValue);
          console.log("Hash salvato nel DB:", hashedPassword);
          result.data[field] = hashedPassword; // Salva l'hash, non la password
          SECRETE = hashedPassword; // Simulazione salvataggio hash per il test
        } catch (error) {
          console.error("Errore nel hashing della password:", error);
          result.isValid = false;
          result.errors.push("Errore durante l'hashing della password");
        }
      } else {
        result.data[field] = safeValue; // Il "Dato X sicuro"
      }
    }
    return result;
  },

  // Logica di Login
  process_login: async (body) => {
    const schema = {
      username: { required: true },
      password: { required: true, minLength: 12 },
    };
      let result = { isValid: true, data: {}, errors: [] };

    for (let field in schema) {
      // Sanitizzazione di ogni campo in ingresso
      let rawValue = body[field] || "";
      let conanValue = PWMSecurity.checker(rawValue);
      let safeValue = PWMSecurity.sanitize(conanValue);
      let odinResult = odin.odino_manager(safeValue);

      if (odinResult === false) {
        result.isValid = false;
        result.errors.push(`Input bloccato da Odino: "${safeValue}"`);
        safeValue = null; // Elimina il dato per sicurezza
        continue; // Salta ulteriori controlli per questo campo
      } else {
        console.log(
          `Input passato attraverso Odino: "${safeValue}". Risultato: ${odinResult ? "Confermato" : "Bloccato"}.`,
        );
      }
      // Controllo integrità strutturale dopo la pulizia
      if (schema[field].required && !safeValue) {
        result.isValid = false;
        result.errors.push(
          `Campo ${field} mancante o svuotato dalla sanitizzazione`,
        );
      } else if (
        schema[field].minLength &&
        safeValue.length < schema[field].minLength
      ) {
        result.isValid = false;
        result.errors.push(
          `${field} troppo corta (minimo ${schema[field].minLength} caratteri)`,
        );
      }//123456789012345 
      storedHash = SECRETE; // Simulazione hash memorizzato per il test
      // Hash della password se il field è password
      if (field === "password" && safeValue.length >= schema[field].minLength && result.isValid) {
        console.log("SAFE VALUE prima dell'hash:", safeValue);  
        try {
          const isMatch = await aslan.verify_password(safeValue, storedHash);
          if (!isMatch) {
            result.isValid = false;
            result.errors.push("Credenziali non valide");
          }else{
            result.isValid = true;
          }
        } catch (error) {
          console.error("Errore nella verifica della password:", error);
          result.isValid = false;
          result.errors.push("Errore durante la verifica della password");
        }
      } else {
        result.data[field] = safeValue; // Il "Dato X sicuro"
      }
    }
    return result;
  }

  
};

module.exports = PWMSecurity;
