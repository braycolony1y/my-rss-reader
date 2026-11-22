import { authMiddleware } from '../../middleware/auth.js';
import { filterLog } from './log.js';

// Read-only list of the system's deterministic editorial exclusions (Monitor > Filtered).
export function registerFilterLogRoutes({ app, db }) {
    app.get('/api/smart-feedback/log', authMiddleware, async (req, res) => {
        try {
            res.json(await filterLog(db, {
                origin: req.query.origin,
                search: String(req.query.search || '').slice(0, 200),
                offset: Math.max(0, Number(req.query.offset) || 0),
                limit: 100,
            }));
        } catch (error) {
            if (!res.destroyed) res.status(400).json({ error: error.message });
        }
    });
}
