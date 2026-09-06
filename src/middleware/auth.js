const authMiddleware = (req, res, next) => {
    if (req.headers.cookie && req.headers.cookie.includes('auth=true')) {
        next();
    } else {
        res.status(401).send('Unauthorized');
    }
};

export { authMiddleware };
