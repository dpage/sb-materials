import { describe, it, expect, vi } from 'vitest';
import { requireAuth, requireSuperuser } from '../middleware/auth';
import type { Request, Response, NextFunction } from 'express';

function createMockReqRes(session: any = {}): { req: Request; res: Response; next: NextFunction } {
  const req = { session } as any;
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as any;
  const next = vi.fn();
  return { req, res, next };
}

describe('Auth Middleware', () => {
  describe('requireAuth', () => {
    it('should call next() when authenticated', () => {
      const { req, res, next } = createMockReqRes({ userId: 1 });
      requireAuth(req, res, next);
      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('should return 401 when not authenticated', () => {
      const { req, res, next } = createMockReqRes({});
      requireAuth(req, res, next);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: 'Not authenticated' });
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe('requireSuperuser', () => {
    it('should call next() for superuser', () => {
      const { req, res, next } = createMockReqRes({ userId: 1, isSuperuser: true });
      requireSuperuser(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    it('should return 401 when not authenticated', () => {
      const { req, res, next } = createMockReqRes({});
      requireSuperuser(req, res, next);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });

    it('should return 403 for non-superuser', () => {
      const { req, res, next } = createMockReqRes({ userId: 1, isSuperuser: false });
      requireSuperuser(req, res, next);
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({ error: 'Superuser access required' });
      expect(next).not.toHaveBeenCalled();
    });
  });
});
