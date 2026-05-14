const argon2 = require("argon2");

const PEPPER = process.env.PEPPER || "default_pepper_value";

const Aslan = {
  hash_password: async (password) => {
    const pepperPassword = `${password}${PEPPER}`;
    const hashedPassword = await argon2.hash(pepperPassword, {
      type: argon2.argon2id,
      memoryCost: 2 ** 16,
      timeCost: 3,
      parallelism: 4,
    });

    return hashedPassword;
  },

  verify_password: async (password, hashedPassword) => {
    const pepperPassword = `${password}${PEPPER}`;
    return argon2.verify(hashedPassword, pepperPassword);
  },

  generate_secure_token: async (length) => {
    const charset = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    let token = "";

    for (let i = 0; i < length; i += 1) {
      const randomIndex = Math.floor(Math.random() * charset.length);
      token += charset[randomIndex];
    }

    return token;
  },

  generateSecureToken: async (length) => Aslan.generate_secure_token(length),
};

module.exports = Aslan;
