const Sauron = require("./middleware/Sauron.js");

const AUTH_ROUTE_RULES = [
	{
		pattern: /^\/auth\/register$/,
		method: "process_register",
	},
	{
		pattern: /^\/auth\/login$/,
		method: "process_login",
	},
	{
		pattern: /^\/auth\/login\/recovery\/username$/,
		method: "process_recovery_username",
	},
	{
		pattern: /^\/auth\/login\/recovery\/password(?:\/[^/]+)?$/,
		method: "process_recovery_password",
	},
];

const PASSWORD_RESET_TOKEN_PATTERN = /^\/auth\/login\/recovery\/password\/([A-Za-z0-9]{32})$/;
const MIN_PASSWORD_LENGTH = 12;

const ROUTE_GROUPS = [
	{
		pattern: /^\/auth(?:\/|$)/,
		target: "auth",
	},
	{
		pattern: /^\/match(?:\/|$)/,
		target: "match",
	},
];

const isPlainObject = (value) =>
	Object.prototype.toString.call(value) === "[object Object]";

const sanitizeValue = (value) => {
	if (Array.isArray(value)) {
		return value.map((item) => sanitizeValue(item));
	}

	if (isPlainObject(value)) {
		return Object.fromEntries(
			Object.entries(value).map(([key, item]) => [key, sanitizeValue(item)]),
		);
	}

	if (typeof value !== "string") {
		return value;
	}

	return Sauron.sanitize(Sauron.checker(value));
};

const resolveRouteContext = (originalUrl) => {
	const pathname = new URL(originalUrl, "http://localhost").pathname;

	const routeGroup =
		ROUTE_GROUPS.find((rule) => rule.pattern.test(pathname))?.target ?? null;

	const authRule =
		AUTH_ROUTE_RULES.find((rule) => rule.pattern.test(pathname)) ?? null;

	return {
		pathname,
		routeGroup,
		sauronMethod: authRule?.method ?? null,
	};
};

const normalizePayload = async (req) => {
	const context = resolveRouteContext(req.originalUrl);
	const safeBody = sanitizeValue(req.body ?? {});
	const safeQuery = sanitizeValue(req.query ?? {});
	const safeParams = sanitizeValue(req.params ?? {});
	const passwordResetTokenMatch = context.pathname.match(PASSWORD_RESET_TOKEN_PATTERN);

	if (passwordResetTokenMatch) {
		const token = passwordResetTokenMatch[1];
		const newPassword = sanitizeValue(req.body?.newPassword ?? "");

		if (typeof newPassword !== "string" || newPassword.length < MIN_PASSWORD_LENGTH) {
			return {
				isValid: false,
				...context,
				body: {
					isValid: false,
					errors: [
						`newPassword troppo corta (minimo ${MIN_PASSWORD_LENGTH} caratteri)`,
					],
				},
				query: safeQuery,
				params: safeParams,
			};
		}

		return {
			isValid: true,
			...context,
			body: {
				newPassword,
			},
			query: safeQuery,
			params: {
				...safeParams,
				token,
			},
		};
	}

	if (!context.sauronMethod) {
		return {
			isValid: true,
			...context,
			body: safeBody,
			query: safeQuery,
			params: safeParams,
		};
	}

	const validator = Sauron[context.sauronMethod];

	if (typeof validator !== "function") {
		throw new Error(`Metodo Sauron non disponibile: ${context.sauronMethod}`);
	}

	const result = await validator(req.body ?? {});

	if (!result.isValid) {
		return {
			isValid: false,
			...context,
			body: result,
			query: safeQuery,
			params: safeParams,
		};
	}

	return {
		isValid: true,
		...context,
		body: {
			...safeBody,
			...sanitizeValue(result.data ?? {}),
		},
		query: safeQuery,
		params: safeParams,
	};
};

module.exports = {
	normalizePayload,
	resolveRouteContext,
};
