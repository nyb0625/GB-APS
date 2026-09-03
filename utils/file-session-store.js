const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const session = require('express-session');

class FileSessionStore extends session.Store {
    constructor(options = {}) {
        super();
        this.dir = options.dir || path.join(process.cwd(), 'data', 'sessions');
        this.ttlMs = options.ttlMs || 24 * 60 * 60 * 1000;
        this.cleanupIntervalMs = options.cleanupIntervalMs || 60 * 60 * 1000;

        fs.mkdirSync(this.dir, { recursive: true });

        this.cleanupTimer = setInterval(() => {
            this.cleanupExpiredSessions();
        }, this.cleanupIntervalMs);
        if (typeof this.cleanupTimer.unref === 'function') {
            this.cleanupTimer.unref();
        }
    }

    get(sid, callback) {
        fs.readFile(this.sessionPath(sid), 'utf8', (err, raw) => {
            if (err) {
                if (err.code === 'ENOENT') return callback(null, null);
                return callback(err);
            }

            let record;
            try {
                record = JSON.parse(raw);
            } catch (parseErr) {
                return callback(parseErr);
            }

            if (this.isExpired(record)) {
                return this.destroy(sid, (destroyErr) => callback(destroyErr, null));
            }

            callback(null, record.session);
        });
    }

    set(sid, sess, callback = () => {}) {
        const filePath = this.sessionPath(sid);
        const record = {
            expiresAt: this.getExpiresAt(sess),
            session: sess
        };
        const data = JSON.stringify(record);

        fs.mkdir(this.dir, { recursive: true }, (mkdirErr) => {
            if (mkdirErr) return callback(mkdirErr);

            const tmpPath = `${filePath}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
            fs.writeFile(tmpPath, data, 'utf8', (writeErr) => {
                if (writeErr) {
                    // Fallback to direct write
                    return fs.writeFile(filePath, data, 'utf8', callback);
                }

                const tryRename = (attemptsLeft) => {
                    fs.rename(tmpPath, filePath, (renameErr) => {
                        if (!renameErr) return callback(null);
                        if (attemptsLeft > 0 && (renameErr.code === 'EPERM' || renameErr.code === 'EBUSY')) {
                            setTimeout(() => tryRename(attemptsLeft - 1), 25);
                            return;
                        }
                        // Fallback: direct write and remove temp file
                        fs.writeFile(filePath, data, 'utf8', (fallbackErr) => {
                            fs.unlink(tmpPath, () => {});
                            callback(fallbackErr);
                        });
                    });
                };

                tryRename(3);
            });
        });
    }

    destroy(sid, callback = () => {}) {
        fs.unlink(this.sessionPath(sid), (err) => {
            if (err && err.code !== 'ENOENT') return callback(err);
            callback(null);
        });
    }

    touch(sid, sess, callback = () => {}) {
        this.get(sid, (getErr, storedSession) => {
            if (getErr) return callback(getErr);
            if (!storedSession) return callback(null);
            storedSession.cookie = sess.cookie;
            this.set(sid, storedSession, callback);
        });
    }

    sessionPath(sid) {
        const hash = crypto.createHash('sha256').update(String(sid)).digest('hex');
        return path.join(this.dir, `${hash}.json`);
    }

    getExpiresAt(sess) {
        const cookieExpires = sess && sess.cookie && sess.cookie.expires;
        const expiresAt = cookieExpires ? new Date(cookieExpires).getTime() : Date.now() + this.ttlMs;
        return Number.isFinite(expiresAt) ? expiresAt : Date.now() + this.ttlMs;
    }

    isExpired(record) {
        return record && record.expiresAt && record.expiresAt <= Date.now();
    }

    cleanupExpiredSessions() {
        fs.readdir(this.dir, (readErr, entries) => {
            if (readErr) return;
            entries
                .filter((entry) => entry.endsWith('.json'))
                .forEach((entry) => {
                    const filePath = path.join(this.dir, entry);
                    fs.readFile(filePath, 'utf8', (fileErr, raw) => {
                        if (fileErr) return;
                        try {
                            if (this.isExpired(JSON.parse(raw))) {
                                fs.unlink(filePath, () => {});
                            }
                        } catch (_err) {
                            fs.unlink(filePath, () => {});
                        }
                    });
                });
        });
    }
}

module.exports = FileSessionStore;
