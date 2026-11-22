// Bounded linear email validation shared by the browser and authoritative server.
export function validEmail(value) {
  if (typeof value !== 'string' || value.length > 254 || /\s/.test(value)) return false;
  const at = value.indexOf('@');
  if (at < 1 || at !== value.lastIndexOf('@')) return false;
  const domain = value.slice(at + 1), dot = domain.indexOf('.');
  return dot > 0 && dot < domain.length - 1;
}
