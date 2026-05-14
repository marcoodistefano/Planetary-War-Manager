const argon2 = require('argon2');
const PEPPER = process.env.PEPPER || "default_pepper_value";

const Aslan = {
    
    hash_password: async (password) => {
        try {
            const pepperPassword = password + PEPPER;
            const hashedPassword = await argon2.hash(pepperPassword, {
                type: argon2.argon2id,
                memoryCost: 2 ** 16, // 64 MB
                timeCost: 3,
                parallelism: 4,
            });
            console.log("Password hashata con successo." + `Hash: ${hashedPassword}`);
            return hashedPassword;
        } catch (err) {
            console.error("Errore durante l'hashing della password:", err);
            throw new Error("Hashing fallito");
        }
    },

    verify_password: async (password, hashedPassword) => {
        try {
            const pepperPassword = password + PEPPER;
            const isMatch = await argon2.verify(hashedPassword, pepperPassword);
            return isMatch;
        } catch (err) {
            console.error("Errore durante la verifica della password:", err);
            throw new Error("Verifica fallita");
        }
    },

    generate_secure_token: async (length) => {
        const charset = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
        let token = "";
        for (let i = 0; i < length; i++) {
            const randomIndex = Math.floor(Math.random() * charset.length);
            token += charset[randomIndex];
        }
        return token;
    },

    normalizeRegion: (region) => {
        if (!region) return null;
        return region.trim().toLowerCase();
    }
};

module.exports = Aslan;