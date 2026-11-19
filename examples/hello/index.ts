import { run } from 'typemaid';
import * as tools from './tools.ts';

const result = await run(new URL('./hello.mmd', import.meta.url), tools, { name: 'Ada' });
console.log(result);
