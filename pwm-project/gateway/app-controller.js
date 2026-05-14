const Sauron = require("./middleware/Sauron.js");

// 1. REGOLE DI AUTENTICAZIONE
const AUTH_ROUTE_RULES = [
    { pattern: /^\/auth\/register$/, method: "process_register" },
    { pattern: /^\/auth\/login$/, method: "process_login" },
    { pattern: /^\/auth\/login\/recovery\/username$/, method: "process_recovery_username" },
    { pattern: /^\/auth\/login\/recovery\/password(?:\/[^/]+)?$/, method: "process_recovery_password" },
];

const PASSWORD_RESET_TOKEN_PATTERN = /^\/auth\/login\/recovery\/password\/([A-Za-z0-9]{32})$/;
const MIN_PASSWORD_LENGTH = 12;

// 2. GRUPPI DI ROTTE (Aggiornato con i nuovi servizi WebSocket)
const ROUTE_GROUPS = [
    { pattern: /^\/auth(?:\/|$)/, target: "auth" },
    { pattern: /^\/match(?:\/|$)/, target: "match" },
    { pattern: /^\/chat(?:\/|$)/, target: "chat" },
    { pattern: /^\/movement(?:\/|$)/, target: "movement" },
    { pattern: /^\/combat(?:\/|$)/, target: "combat" },
];

// 3. FUNZIONI DI ISPEZIONE E SANITIZZAZIONE

const isPlainObject = (value) => {
    return Object.prototype.toString.call(value) === "[object Object]";
};

// Funzione ricorsiva srotolata per massima ispezionabilità
const sanitizeValue = async (value) => {
    // Gestione dei valori nulli o indefiniti
    if (value === null || value === undefined) {
        return value;
    }

    // Ispezione Array
    if (Array.isArray(value)) {
        const newArray = [];
        for (let i = 0; i < value.length; i++) {
            newArray.push(await sanitizeValue(value[i]));
        }
        return newArray;
    }

    // Ispezione Oggetti (Es. JSON body)
    if (isPlainObject(value)) {
        const newObj = {};
        const keys = Object.keys(value);
        for (let i = 0; i < keys.length; i++) {
            const key = keys[i];
            newObj[key] = await sanitizeValue(value[key]);
        }
        return newObj;
    }

    // Se non è una stringa (es. numero, booleano), lo facciamo passare intatto
    if (typeof value !== "string") {
        return value;
    }

    const result = { isValid: true, data: {}, errors: [] };
    const schema = { value: { required: false } };
    const processed = await Sauron.process({ value }, schema, result);
    return processed.data.value;
};

// 4. RISOLUZIONE DEL CONTESTO DI ROTTA
const resolveRouteContext = (originalUrl) => {
    const rawUrlString = originalUrl || "/";
    const parsedUrl = new URL(rawUrlString, "http://localhost");
    const pathname = parsedUrl.pathname;

    let routeGroup = null;
    let sauronMethod = null;

    // Ricerca del target di routing
    for (let i = 0; i < ROUTE_GROUPS.length; i++) {
        if (ROUTE_GROUPS[i].pattern.test(pathname)) {
            routeGroup = ROUTE_GROUPS[i].target;
            break; // Trovato, interrompiamo il loop
        }
    }

    // Ricerca del metodo Sauron specifico per l'autenticazione
    for (let i = 0; i < AUTH_ROUTE_RULES.length; i++) {
        if (AUTH_ROUTE_RULES[i].pattern.test(pathname)) {
            sauronMethod = AUTH_ROUTE_RULES[i].method;
            break; // Trovato, interrompiamo il loop
        }
    }

    return {
        pathname: pathname,
        routeGroup: routeGroup,
        sauronMethod: sauronMethod,
    };
};

// 5. MOTORE PRINCIPALE DI NORMALIZZAZIONE
const normalizePayload = async (req) => {
    const originalUrl = req.originalUrl || req.url || "/";
    const context = resolveRouteContext(originalUrl);

    // Esecuzione della sanitizzazione massiva su tutti i vettori di ingresso
    // PATCH APPLICATA: Ora sanitizziamo anche gli Header
    const safeHeaders = await sanitizeValue(req.headers || {});
    const safeBody = await sanitizeValue(req.body || {});
    const safeQuery = await sanitizeValue(req.query || {});
    const safeParams = await sanitizeValue(req.params || {});

    // Controllo specifico: Logica di Reset Password
    const passwordResetTokenMatch = context.pathname.match(PASSWORD_RESET_TOKEN_PATTERN);
    
    if (passwordResetTokenMatch) {
        const token = passwordResetTokenMatch[1];
        
        let rawNewPassword = "";
        if (req.body && req.body.newPassword) {
            rawNewPassword = req.body.newPassword;
        }
        
        const newPassword = await sanitizeValue(rawNewPassword);

        // Validazione lunghezza password
        if (typeof newPassword !== "string" || newPassword.length < MIN_PASSWORD_LENGTH) {
            return {
                isValid: false,
                pathname: context.pathname,
                routeGroup: context.routeGroup,
                sauronMethod: context.sauronMethod,
                headers: safeHeaders,
                body: {
                    isValid: false,
                    errors: ["newPassword troppo corta (minimo " + MIN_PASSWORD_LENGTH + " caratteri)"],
                },
                query: safeQuery,
                params: safeParams,
            };
        }

        // Iniezione del token nei parametri sicuri
        const finalParams = Object.assign({}, safeParams);
        finalParams.token = token;

        return {
            isValid: true,
            pathname: context.pathname,
            routeGroup: context.routeGroup,
            sauronMethod: context.sauronMethod,
            headers: safeHeaders,
            body: { newPassword: newPassword },
            query: safeQuery,
            params: finalParams,
        };
    }

    // Se non c'è una logica custom Sauron da applicare, restituiamo i dati sanitizzati base
    if (!context.sauronMethod) {
        return {
            isValid: true,
            pathname: context.pathname,
            routeGroup: context.routeGroup,
            sauronMethod: context.sauronMethod,
            headers: safeHeaders,
            body: safeBody,
            query: safeQuery,
            params: safeParams,
        };
    }

    // Esecuzione dinamica del metodo Sauron (Es. process_login)
    const validator = Sauron[context.sauronMethod];

    if (typeof validator !== "function") {
        throw new Error("Metodo Sauron non disponibile nel middleware: " + context.sauronMethod);
    }

    // Passiamo il body originale al validatore. Sauron farà i suoi controlli di business
    const rawBody = req.body || {};
    const result = await validator(rawBody);

    if (result.isValid === false) {
        return {
            isValid: false,
            pathname: context.pathname,
            routeGroup: context.routeGroup,
            sauronMethod: context.sauronMethod,
            headers: safeHeaders,
            body: result, // Passiamo l'oggetto di errore generato da Sauron
            query: safeQuery,
            params: safeParams,
        };
    }

    // Fusione controllata dei dati: Uniamo il body sanitizzato con i dati parsati specificatamente da Sauron
    const finalBody = Object.assign({}, safeBody);
    const specificData = await sanitizeValue(result.data || {});
    
    const specificKeys = Object.keys(specificData);
    for (let i = 0; i < specificKeys.length; i++) {
        const key = specificKeys[i];
        finalBody[key] = specificData[key];
    }

    return {
        isValid: true,
        pathname: context.pathname,
        routeGroup: context.routeGroup,
        sauronMethod: context.sauronMethod,
        headers: safeHeaders,
        body: finalBody,
        query: safeQuery,
        params: safeParams,
    };
};

module.exports = {
    normalizePayload,
    resolveRouteContext,
    sanitizeValue // Esportato per permettere al Gateway di sanitizzare gli handshake WebSocket
};