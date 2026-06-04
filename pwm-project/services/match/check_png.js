const fs = require('fs');
const buffer = Buffer.alloc(24);
const fd = fs.openSync('/app/public/assets/2Dmodels/Land_troops/Soldier/soldier_front.png', 'r');
fs.readSync(fd, buffer, 0, 24, 0);
fs.closeSync(fd);
const width = buffer.readUInt32BE(16);
const height = buffer.readUInt32BE(20);
console.log('Width:', width, 'Height:', height);
