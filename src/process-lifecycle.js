export function installProcessHandlers() {
    // --- PROCESS ERROR HANDLERS: Prevent silent crashes ---
    const processStartTime = Date.now();

    process.on('uncaughtException', (err) => {
        console.error('[FATAL] Uncaught Exception:', err.message, err.stack);
        // Give time for the log to flush, then exit so systemd can restart us
        setTimeout(() => process.exit(1), 1000);
    });

    process.on('unhandledRejection', (reason, promise) => {
        console.error('[FATAL] Unhandled Promise Rejection:', reason);
    });

    return {
        processStartTime
    };
}
