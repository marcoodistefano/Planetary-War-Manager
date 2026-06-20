const base64 = require("base-64");
//============AUTOMATIC DETECTIVE=============

function automatic_detective(input) {
  if (typeof input !== "string") return { format: "Unknown", decoded: input };
  let decoded = "";
  let lastFormat = "";

  while (true) {
    const match =
      JSON_detective(input) ||
      URL_detective(input) ||
      HEX_detective(input) ||
      B64_detective(input) ||
      BIN_detective(input);
    if (match === false) {
      console.log(
        `Nessuna codifica rilevata per l'input: "${input}". Trattamento come testo semplice.`,
      );
      return { format: "Plain input", decoded: input, isEncoded: lastFormat !== "" };
    }
    console.log(
      `Formato rilevato: ${match} per l'input: "${input}". Applicazione della decodifica ricorsiva.`,
    );
    switch (match) {
      case "JSON":
        decoded = JSON_recoursed_decode(input);
        break;
      case "URL":
        decoded = URL_recursive_decode(input);
        break;
      case "HEX":
        decoded = HEX_recursive_decode(input);
        break;
      case "B64":
        decoded = B64_recursive_decode(input);
        break;
      case "BIN":
        decoded = BIN_recursive_decode(input);
        break;
      default:
        console.log(
          `Formato sconosciuto rilevato per l'input: "${input}". Input eliminato per sicurezza.`,
        );
        return { format: "Plain input", decoded: null, isEncoded: false };
    }
    if (decoded === false) return { format: "Plain input", decoded: input, isEncoded: false };
    lastFormat = match;
    input = decoded; // Aggiorna input per la prossima iterazione
  }
}

// =============DETECTIVE=============

function URL_detective(input) {
  if (!input.includes("%")) return false;
  try {
    const decoded = decodeURIComponent(input);
    // Se la decodifica ha cambiato il testo, era effettivamente codificato
    if (decoded !== input) {
      return "URL";
    }
  } catch (e) {
    console.error("Errore durante la decodifica URL:", e);
    return false;
  }
  return false;
}

function B64_detective(input) {
  const cleanInput = input.replace(/\s+/g, ""); // FONDAMENTALE: togliere gli spazi prima del calcolo

  if (cleanInput.length % 4 !== 0 || cleanInput.length === 0) return false;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(cleanInput)) return false;

  try {
    const decoded = Buffer.from(cleanInput, "base64").toString("utf8");
    
    // EURISTICA ROUND-TRIP: La prova matematica che impedisce di convertire nomi utente (es. "User")
    const reencoded = Buffer.from(decoded, "utf8").toString("base64");
    if (reencoded !== cleanInput) {
      return false; // Era testo normale!
    }
    
    // EURISTICA: Il risultato decodificato deve essere testo valido stampabile
    if (/^[\x20-\x7E\u00A0-\uFFFF\n\r\t]*$/.test(decoded) && decoded.trim() !== "") {
      // Evita falsi positivi su stringhe corte (es. username) che casualmente decodificano in testo innocuo
      if (cleanInput.length < 32 && !/[<>()"']/.test(decoded)) {
        return false;
      }
      return "B64";
    }
  } catch (e) {
    console.error("Errore durante la decodifica Base64:", e);
    return false;
  }
  return false;
}

function HEX_detective(input) {
  const cleanInput = input.replace(/\s+/g, ""); // Rimozione spazi
  if (cleanInput.length % 2 !== 0 || !/^[0-9A-Fa-f]+$/.test(cleanInput))
    return false;
  try {
    const decoded = Buffer.from(cleanInput, "hex").toString("utf8");
    // Se la decodifica produce caratteri non validi, non è vero testo UTF-8 codificato
    if (decoded.includes('\uFFFD')) {
      return false;
    }
    // Verifica che il risultato sia testo stampabile (evita falsi positivi su codici seriali)
    if (/^[\x20-\x7E\u00A0-\uFFFF\n\r\t]+$/.test(decoded)) {
      // Evita falsi positivi su stringhe corte
      if (cleanInput.length < 32 && !/[<>()"']/.test(decoded)) {
        return false;
      }
      return "HEX";
    }
  } catch (e) {
    console.error("Errore durante la decodifica HEX:", e);
    return false;
  }
  return false;
}

function BIN_detective(input) {
  // Rimuoviamo eventuali spazi (spesso usati per separare i byte visivamente)
  const cleaninput = input.replace(/\s+/g, "");
  // REGOLA 1: Deve contenere solo 0 e 1, lunghezza multipla di 8, e non deve essere vuoto
  if (cleaninput.length === 0 || cleaninput.length % 8 !== 0 || !/^[01]+$/.test(cleaninput)) {
    return false;
  }
  try {
    const decoded = cleaninput
      .match(/.{1,8}/g)
      .map((byte) => String.fromCharCode(parseInt(byte, 2)))
      .join("");
    // Verifica che il risultato sia testo stampabile (come nelle altre detective)
    if (/^[\x20-\x7E\u00A0-\uFFFF\n\r\t]+$/.test(decoded)) {
      // Evita falsi positivi su stringhe corte
      if (cleaninput.length < 64 && !/[<>()"']/.test(decoded)) {
        return false;
      }
      return "BIN";
    }
  } catch (e) {
    console.error("Errore durante la decodifica BIN:", e);
    return false;
  }
  return false;
}

function JSON_detective(input) {
  const trimmed = input.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return false;
  try {
    const parsed = JSON.parse(trimmed);
    return "JSON";
  } catch (e) {
    console.error("Errore durante la decodifica JSON:", e);
    return false;
  }
  return false;
}

// =============DECODE=============
function B64_recursive_decode(input) {
  let current = input;
  let decoded = "";
  const b64Regex = /^(?:[A-Za-z0-9+\/]{4})*(?:[A-Za-z0-9+\/]{2}==|[A-Za-z0-9+\/]{3}=)?$/;

  try {
    while (current !== decoded) {
      decoded = base64.decode(current);
      current = decoded;
    }
    if (b64Regex.test(current) && current.length > 4) {
      const b64Decoded = base64.decode(current).toString("utf-8");
      if (/^[\x20-\x7E\u00A0-\uFFFF]*$/.test(b64Decoded)) {
        current = b64Decoded;
      }
    }
  } catch (error) {
    console.error("Errore durante la riconversione del base64:", error);
    return false;
  }
  console.log(`Riconversione Base64 completata. Risultato: "${current}"`);

  return current;
}

function URL_recursive_decode(input) {
    let current = input.replace(/\s+/g, "");

  try {
    while (URL_detective(current)) {
      current = decodeURIComponent(current);
    }
  } catch (error) {
    console.error("Errore durante la riconversione URL:", error);
    return false;
  }
  console.log(`Riconversione URL completata. Risultato: "${current}"`);

  return current;
}

function HEX_recursive_decode(input) {
  let current = input.replace(/\s+/g, "");
  try {
    while (HEX_detective(current)) {
      if (current.length % 2 !== 0) {
        current = "0" + current; // Aggiunta di uno zero iniziale se la lunghezza è dispari
      }
      current = Buffer.from(current, "hex").toString("utf-8");
    }
  } catch (error) {
    console.error("Errore durante la riconversione HEX:", error);
    return false;
  }
  console.log(`Riconversione HEX completata. Risultato: "${current}"`);

  return current;
}

function BIN_recursive_decode(input) {
    let current = input.replace(/\s+/g, "");
  try {
    while (BIN_detective(current)) {
      const matches = current.match(/.{1,8}/g);
      if (!matches) break; // Sicurezza: esce se non ci sono matches
      current = matches
        .map((byte) => String.fromCharCode(parseInt(byte, 2)))
        .join("");
    }
  } catch (error) {
    console.error("Errore durante la riconversione BIN:", error);
    return false;
  }
  console.log(`Riconversione BIN completata. Risultato: "${current}"`);
  return current;
}

function JSON_recoursed_decode(input) {
  if (typeof input === "object" && input !== null) {
    for (let key in input) {
      if (Object.prototype.hasOwnProperty.call(input, key)) {
        input[key] = JSON_recoursed_decode(input[key]);
      }
    }
    console.log(`Riconversione JSON completata. Risultato: "${JSON.stringify(input)}"`);
    return input;
  } else return false;
}

module.exports = {
  automatic_detective,
  URL_detective,
  B64_detective,
  HEX_detective,
  BIN_detective,
  B64_recursive_decode,
  URL_recursive_decode,
  HEX_recursive_decode,
  BIN_recursive_decode,
  JSON_recoursed_decode,
};
