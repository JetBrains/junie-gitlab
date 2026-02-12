import * as fs from 'fs';
import * as path from 'path';

export function writeToFile(filepath: string, text: string): void {
    const dir = path.dirname(filepath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filepath, text, 'utf-8');
}
