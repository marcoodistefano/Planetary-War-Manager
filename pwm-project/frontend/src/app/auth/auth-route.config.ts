export const PUBLIC_AUTH_ROUTES = [
  '/login',
  '/register',
  '/login/recovery/username',
  '/login/recovery/password',
  '/auth/login',
  '/auth/register',
  '/auth/login/recovery/username',
  '/auth/login/recovery/password',
];

export function isPublicAuthRoute(url: string): boolean {
  return PUBLIC_AUTH_ROUTES.some((route) => url.startsWith(route));
}