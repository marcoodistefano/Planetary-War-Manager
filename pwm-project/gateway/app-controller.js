const Sauron = require("./middleware/Sauron.js");

// 1. REGOLE DI AUTENTICAZIONE E ROUTING
const AUTH_ROUTE_RULES = [
    { pattern: /^\/auth\/register$/, method: "process_register" },
    { pattern: /^\/auth\/login$/, method: "process_login" },
    { pattern: /^\/auth\/login\/recovery\/username$/, method: "process_recovery_username" },
    { pattern: /^\/auth\/login\/recovery\/password(?:\/[^/]+)?$/, method: "process_recovery_password" },
];

const PASSWORD_RESET_TOKEN_PATTERN = /^\/auth\/login\/recovery\/password\/([A-Za-z0-9]{32})$/;
const MIN_PASSWORD_LENGTH = 12;

const ROUTE_GROUPS = [
    { pattern: /^\/auth(?:\/|$)/, target: "user" },     // Gestito da user-service
    { pattern: /^\/home(?:\/|$)/, target: "user" },     // Gestito da user-service
    { pattern: /^\/friends(?:\/|$)/, target: "user" },  // Rotte amici -> user-service
    { pattern: /^\/elo(?:\/|$)/, target: "user" },      // NUOVO: Rotte per i calcoli ELO
    { pattern: /^\/player(?:\/|$)/, target: "user" },   // NUOVO: Rotte per info profilo/statistiche
    { pattern: /^\/match(?:\/|$)/, target: "match" },
    { pattern: /^\/chat(?:\/|$)/, target: "chat" },
];

// 3. FUNZIONI DI ISPEZIONE E SANITIZZAZIONE
const isPlainObject = (value) => {
    return Object.prototype.toString.call(value) === "[object Object]";
};

// PATCH HARDWARE: Scansione dell'Albero in Parallelo (Evita il CPU Locking)
const sanitizeValue = async (value) => {
    if (value === null || value === undefined) return value;

    // Ispezione Array in Parallelo
    if (Array.isArray(value)) {
        // Promise.all lancia tutte le sanitizzazioni simultaneamente sul processore
        return await Promise.all(value.map((item) => sanitizeValue(item)));
    }

    // Ispezione Oggetti in Parallelo
    if (isPlainObject(value)) {
        const newObj = {};
        const keys = Object.keys(value);
        await Promise.all(
            keys.map(async (key) => {
                newObj[key] = await sanitizeValue(value[key]);
            })
        );
        return newObj;
    }

    // Pass through per numeri e booleani
    if (typeof value !== "string") return value;

    // Ispezione profonda solo per le stringhe foglia
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

    for (let i = 0; i < ROUTE_GROUPS.length; i++) {
        if (ROUTE_GROUPS[i].pattern.test(pathname)) {
            routeGroup = ROUTE_GROUPS[i].target;
            break;
        }
    }

    for (let i = 0; i < AUTH_ROUTE_RULES.length; i++) {
        if (AUTH_ROUTE_RULES[i].pattern.test(pathname)) {
            sauronMethod = AUTH_ROUTE_RULES[i].method;
            break;
        }
    }

    return { pathname, routeGroup, sauronMethod };
};

// 5. MOTORE PRINCIPALE DI NORMALIZZAZIONE
const normalizePayload = async (req) => {
    const originalUrl = req.originalUrl || req.url || "/";
    const context = resolveRouteContext(originalUrl);

    // PATCH SICUREZZA: Gli Header NON devono subire mutazioni di stringa da Sauron.
    // Conterrebbero JWT, Firme, Boundary Multipart. Li passiamo as-is.
    // L'app-route.js fa già whitelisting delle chiavi sicure.
    const safeHeaders = req.headers || {}; 

    // Esecuzione sanitizzazione MASSIVA in Parallelo su Body, Query e Params
    const [safeBody, safeQuery, safeParams] = await Promise.all([
        sanitizeValue(req.body || {}),
        sanitizeValue(req.query || {}),
        sanitizeValue(req.params || {})
    ]);

    // --- LOGICA CUSTOM: RESET PASSWORD ---
    const passwordResetTokenMatch = context.pathname.match(PASSWORD_RESET_TOKEN_PATTERN);
    
    if (passwordResetTokenMatch) {
        const token = passwordResetTokenMatch[1];
        const rawNewPassword = req.body?.newPassword || "";
        const newPassword = await sanitizeValue(rawNewPassword);

        if (typeof newPassword !== "string" || newPassword.length < MIN_PASSWORD_LENGTH) {
            return {
                isValid: false,
                pathname: context.pathname,
                routeGroup: context.routeGroup,
                sauronMethod: context.sauronMethod,
                headers: safeHeaders,
                body: { isValid: false, errors: [`newPassword troppo corta (minimo ${MIN_PASSWORD_LENGTH} caratteri)`] },
                query: safeQuery,
                params: safeParams,
            };
        }

        const finalParams = { ...safeParams, token: token };
        return {
            isValid: true,
            pathname: context.pathname,
            routeGroup: context.routeGroup,
            sauronMethod: context.sauronMethod,
            headers: safeHeaders,
            body: { newPassword },
            query: safeQuery,
            params: finalParams,
        };
    }

    // --- ROUTING GENERICO SENZA METODO SAURON SPECIFICO ---
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

    // --- ESECUZIONE DINAMICA SAURON (Es. auth) ---
    const validator = Sauron[context.sauronMethod];
    if (typeof validator !== "function") {
        throw new Error(`Metodo Sauron assente nel middleware: ${context.sauronMethod}`);
    }

    const rawBody = req.body || {};
    //bypass dell'ID dell'avatar, se presente, per evitare problemi di validazione in Sauron, che lo rileverebbe come HEX
    //l'avatar arriva come: avatar_id
    console.log("Raw body prima di Sauron:", rawBody);
    const result = await validator(rawBody);

    if (result.isValid === false) {
        return {
            isValid: false,
            pathname: context.pathname,
            routeGroup: context.routeGroup,
            sauronMethod: context.sauronMethod,
            headers: safeHeaders,
            body: result,
            query: safeQuery,
            params: safeParams,
        };
    }

    // Fusione finale: i dati sanitizzati base sovrascritti dai dati formattati da Sauron
    const specificData = await sanitizeValue(result.data || {});
    const finalBody = { ...safeBody, ...specificData };

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
    sanitizeValue 
};