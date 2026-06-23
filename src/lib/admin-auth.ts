export function validateAdminAuth(request: Request): boolean {
  const header = request.headers.get('x-admin-auth') ?? '';
  const expected = `${process.env.ADMIN_USERNAME}:${process.env.ADMIN_PASSWORD}`;
  return header === expected;
}

export function unauthorized() {
  return Response.json({ error: 'Unauthorized' }, { status: 401 });
}
