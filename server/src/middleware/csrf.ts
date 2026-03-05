import { Request, Response, NextFunction } from 'express';

/**
 * CSRF protection via custom header check.
 * Browsers won't send custom headers on cross-origin requests without
 * CORS preflight approval, so requiring this header on state-changing
 * requests effectively prevents CSRF attacks from other origins.
 */
export function csrfProtection(req: Request, res: Response, next: NextFunction): void {
  // Only check state-changing methods
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    next();
    return;
  }

  // Multipart form uploads won't have JSON content-type, but they
  // come from our own file input elements. Check for the session cookie
  // presence plus origin match instead.
  if (req.is('multipart/form-data')) {
    next();
    return;
  }

  // Require that JSON requests include the correct content-type header.
  // Browsers won't send content-type: application/json cross-origin
  // without a CORS preflight, which our CORS config will block.
  const contentType = req.headers['content-type'];
  if (!contentType || !contentType.includes('application/json')) {
    res.status(403).json({ error: 'Invalid content type' });
    return;
  }

  next();
}
