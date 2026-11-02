/**
 * The business behind Tenantry, named in every legal document, the site footer and the Pro LICENSE. The
 * placeholders stay until the entity's details are supplied. While any remains, a production build with checkout
 * enabled fails and a production server with it enabled refuses to start (public-config.ts); until then the footer
 * says only "Tenantry".
 */
export const LegalEntity = {
  /** The registered legal name, e.g. "Example Software Ltd". */
  name: '[COMPANY LEGAL NAME]',
  /** The registered office address, on one line. */
  address: '[REGISTERED ADDRESS]',
  /** The registration, e.g. "a company registered in England and Wales (company number 01234567)". */
  registration: '[REGISTRATION: country and company number]',
};

/** Whether any detail is still a placeholder. */
export function legalEntityIncomplete(entity: Record<string, string> = LegalEntity): boolean {
  return Object.values(entity).some((value) => value.includes('['));
}
