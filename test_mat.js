import fs from 'fs';
import { readMat } from 'mat-for-js';
const buf = fs.readFileSync('/tmp/mat_cir/frame_0.mat');
const mat = readMat(buf);
console.log(mat);
