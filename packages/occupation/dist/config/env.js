import dotenv from 'dotenv';
dotenv.config();
const LOCAL_DB_DEFAULTS = {
    DB_HOST: '127.0.0.1',
    DB_PORT: '3306',
    DB_DATABASE: 'occupation_search_engine',
    DB_USERNAME: 'root',
    DB_PASSWORD: 'root'
};
export function readOptionalEnv(key) {
    const value = process.env[key]?.trim();
    return value ? value : undefined;
}
function readPort(value) {
    const port = Number.parseInt(value, 10);
    if (!Number.isInteger(port) || port <= 0) {
        throw new Error(`DB_PORT must be a positive integer. Received: ${value}`);
    }
    return port;
}
export function readOptionalPort(value, fallback) {
    if (!value) {
        return fallback;
    }
    return readPort(value);
}
function readEnvWithDefault(key) {
    const value = process.env[key]?.trim();
    return value ? value : LOCAL_DB_DEFAULTS[key];
}
export function getDbConfig() {
    return {
        host: readEnvWithDefault('DB_HOST'),
        port: readPort(readEnvWithDefault('DB_PORT')),
        database: readEnvWithDefault('DB_DATABASE'),
        username: readEnvWithDefault('DB_USERNAME'),
        password: readEnvWithDefault('DB_PASSWORD')
    };
}
