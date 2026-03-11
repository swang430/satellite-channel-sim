import { read as readMat } from 'mat-for-js';
import * as fs from 'fs';
import JSZip from 'jszip';

const buf = fs.readFileSync('/Users/swang430/.openclaw/media/inbound/result---2294ae1c-e41d-4c2d-800e-050bda5a3f83.zip');
JSZip.loadAsync(buf).then(zip => {
    zip.file('result/result_frame_1.mat').async('uint8array').then(u8 => {
        const ab = u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
        const matFile = readMat(ab);
        const mat = matFile.data || matFile;
        console.log("ReceivedPower_COH:", mat.ReceivedPower_COH);
        console.log("ReceivedPower_NONCOH:", mat.ReceivedPower_NONCOH);
    });
});
