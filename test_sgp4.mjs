import * as satellite from 'satellite.js';

function calculateDynamicOrbit(tleLine1, tleLine2, observerLat, observerLon, observerAlt, date = new Date()) {
    try {
        const satrec = satellite.twoline2satrec(tleLine1, tleLine2);
        const positionAndVelocity = satellite.propagate(satrec, date);
        const positionEci = positionAndVelocity.position;

        if (!positionEci) {
            console.log("No position (satellite decayed or invalid object)");
            return null;
        }

        const gmst = satellite.gstime(date);
        const observerGd = {
            longitude: satellite.degreesToRadians(observerLon),
            latitude: satellite.degreesToRadians(observerLat),
            height: observerAlt / 1000.0 // required in km
        };

        const positionEcf = satellite.eciToEcf(positionEci, gmst);
        const lookAngles = satellite.ecfToLookAngles(observerGd, positionEcf);

        return {
            azimuth: satellite.radiansToDegrees(lookAngles.azimuth),
            elevation: satellite.radiansToDegrees(lookAngles.elevation),
            slantRange: lookAngles.rangeSat // km
        };
    } catch (e) {
        console.error("Orbit Calculation Error:", e);
        return null;
    }
}

const ISS_TLE1 = '1 25544U 98067A   23249.52157811  .00018042  00000-0  32479-3 0  9997';
const ISS_TLE2 = '2 25544  51.6420 330.1245 0005273  19.5398  65.7335 15.49841804414341';

console.log(calculateDynamicOrbit(ISS_TLE1, ISS_TLE2, 22.54, 114.05, 0));
