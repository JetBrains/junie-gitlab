import {logger} from "./logging.js";

function isNetworkError(e: unknown): boolean {
    return e instanceof TypeError && (e as any).cause?.code?.startsWith('UND_ERR');
}

export async function withRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
    const delays = [2000, 5000];
    for (let attempt = 0; attempt <= delays.length; attempt++) {
        try {
            return await fn();
        } catch (e) {
            if (attempt < delays.length && isNetworkError(e)) {
                logger.warn(`Network error on ${label}, retrying in ${delays[attempt]}ms...`);
                await new Promise(resolve => setTimeout(resolve, delays[attempt]));
            } else {
                throw e;
            }
        }
    }
    throw new Error('unreachable');
}
