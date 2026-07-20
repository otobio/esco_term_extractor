import dotenv from 'dotenv';

dotenv.config();

type EnvKey = 'DB_HOST' | 'DB_PORT' | 'DB_DATABASE' | 'DB_USERNAME' | 'DB_PASSWORD';

const LOCAL_DB_DEFAULTS: Record<EnvKey, string> = {
  DB_HOST: '127.0.0.1',
  DB_PORT: '3306',
  DB_DATABASE: 'occupation_search_engine',
  DB_USERNAME: 'root',
  DB_PASSWORD: 'root'
};

export function readOptionalEnv(key: string): string | undefined {
  const value = process.env[key]?.trim();
  return value ? value : undefined;
}

function readPort(value: string): number {
  const port = Number.parseInt(value, 10);

  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`DB_PORT must be a positive integer. Received: ${value}`);
  }

  return port;
}

export function readOptionalPort(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  return readPort(value);
}

function readEnvWithDefault(key: EnvKey): string {
  const value = process.env[key]?.trim();
  return value ? value : LOCAL_DB_DEFAULTS[key];
}

export type DbConfig = {
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
};

export function getDbConfig(): DbConfig {
  return {
    host: readEnvWithDefault('DB_HOST'),
    port: readPort(readEnvWithDefault('DB_PORT')),
    database: readEnvWithDefault('DB_DATABASE'),
    username: readEnvWithDefault('DB_USERNAME'),
    password: readEnvWithDefault('DB_PASSWORD')
  };
}
