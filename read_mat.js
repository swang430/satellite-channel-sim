import { read as readMat } from 'mat-for-js';
import * as fs from 'fs';
import JSZip from 'jszip';
const buf = fs.readFileSync('/Users/swang430/.openclaw/media/inbound/result---2294ae1c-e41d-4c2d-800e-050bda5a3f83.zip');
JSZip.loadAsync(buf).then(zip => {
    zip.file('result/result_frame_1.mat').async('uint8array').then(u8 => {
        const ab = u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
        const matFile = readMat(ab);
        const mat = matFile.data || matFile;
        const rays = mat.RaysProperties;
        const numberRays = Number(mat.NumberRays ? mat.NumberRays[0] : 0);
        console.log("NumberRays:", numberRays);
        
        let parsedRays = rays;
        if (Array.isArray(rays) && Array.isArray(rays[0]) && typeof rays[0][0] === 'number') {
        } else if (Array.isArray(rays) && typeof rays[0] === 'number') {
            parsedRays = [rays];
        } else {
            parsedRays = [];
        }

        if (numberRays > 1 && parsedRays.length === 1 && parsedRays[0].length === numberRays * 19) {
            const flat = parsedRays[0];
            parsedRays = [];
            for (let r = 0; r < numberRays; r++) parsedRays.push(flat.slice(r * 19, (r + 1) * 19));
        }

        for (let i = 0; i < Math.min(numberRays, 10); i++) {
            console.log("Ray", i, "delay_s=", Number(parsedRays[i]?.[2]), "amp_dB=", Number(parsedRays[i]?.[8]));
        }
    });
});
