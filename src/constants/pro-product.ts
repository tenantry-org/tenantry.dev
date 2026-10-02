import 'server-only';

/**
 * The Paddle product that is Tenantry Pro, from the `PADDLE_PRO_PRODUCT_ID` env var (`pro_…`). There is
 * one Pro offer (D10), so a subscription to this product entitles its customer to Pro and any other
 * product entitles to nothing. Each environment has its own Paddle products, so there is no default; the
 * server does not start without a valid id (see `server-config.ts`).
 */

/** Checks a Pro product id; throws a message naming what is wrong. */
export function parseProProductId(raw: string | undefined): string {
  const productId = raw?.trim();

  if (!productId) {
    throw new Error('PADDLE_PRO_PRODUCT_ID is not set: no purchase could be recognised as Tenantry Pro.');
  }
  if (!/^pro_[a-z0-9]+$/.test(productId)) {
    throw new Error(`PADDLE_PRO_PRODUCT_ID must be a Paddle product id ("pro_…"); it is "${productId}".`);
  }

  return productId;
}

/** Whether a Paddle product id is Tenantry Pro. */
export function isProProduct(productId: string | null | undefined): boolean {
  const proProductId = parseProProductId(process.env.PADDLE_PRO_PRODUCT_ID);

  return !!productId && productId === proProductId;
}
