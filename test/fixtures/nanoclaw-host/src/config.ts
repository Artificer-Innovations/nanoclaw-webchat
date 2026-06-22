import path from 'path';

/** Minimal config for integration fixture — only DATA_DIR is required by webchat-store. */
export const DATA_DIR = path.resolve(process.cwd(), 'data');
